import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { OrdersService } from '../orders/orders.service';
import { NotificationService } from '../common/notification.service';
import { ProxyService } from '../proxy/proxy.service';
import { RazerAccountService } from '../razer/razer-account.service';
import { PricingService } from '../orders/pricing.service';
import { OrderStatusEnum, LogLevel, Order, RazerAccount, ProxyType } from '../database/entities';
import { OrderEventBus } from './order-event-bus.service';
import { OrderStep, StepStatus } from './interfaces/step-event.interface';
import { STEP_PROGRESS_MAP, STEP_MESSAGES_RU } from './constants/step-progress';
import { EpicApiPurchaseService, EpicPurchaseProxy } from '../api-purchase/epic-api-purchase.service';
import { CommissionService } from '../partner/commission.service';

/** Минимальный shape для handleSuccess/handleFailure — не зависит от старого EpicBrowserService */
interface PurchaseSummary {
  success: boolean;
  errorReason?: string;
  errorMessage?: string;
  screenshotPath?: string;
}

/**
 * Главный конвейер обработки заказа (быстрый API flow ~50 сек/заказ).
 *
 * Шаги:
 * 1. Берём Razer-аккаунт из пула
 * 2. Берём LRU-прокси из пула
 * 3. Вызываем EpicApiPurchaseService.purchase (делает Epic→Razer покупку через API+browser pool)
 * 4. На успехе — обновляем баланс, сохраняем свежие Razer cookies
 * 5. На ошибке — markCaptchaEvent / markFailure
 */
@Injectable()
export class OrderProcessingService {
  private readonly logger = new Logger(OrderProcessingService.name);

  constructor(
    private readonly ordersService: OrdersService,
    private readonly notificationService: NotificationService,
    private readonly proxyService: ProxyService,
    private readonly razerAccountService: RazerAccountService,
    private readonly pricingService: PricingService,
    private readonly orderEventBus: OrderEventBus,
    private readonly apiPurchaseService: EpicApiPurchaseService,
    // Partner program: drives commission lifecycle on order
    // success/failure transitions (Requirement 10.2, 10.3).
    private readonly commissionService: CommissionService,
  ) {}

  private emitStep(orderId: string, step: OrderStep, status: StepStatus, message?: string): void {
    this.orderEventBus.emit({
      orderId,
      step,
      status,
      message: message ?? STEP_MESSAGES_RU[step],
      timestamp: new Date().toISOString(),
      progress: STEP_PROGRESS_MAP[step],
    });
  }

  async processOrder(orderId: string): Promise<void> {
    const order = await this.ordersService.findByOrderId(orderId);

    this.emitStep(order.orderId, 'validating', 'started');

    if (!order.epicAccessToken) {
      await this.markFailed(order, 'No Epic access token attached to order');
      return;
    }

    await this.ordersService.updateStatus(order.id, OrderStatusEnum.PROCESSING);
    this.emitStep(order.orderId, 'validating', 'completed');
    await this.log(order, '[system]', 'Started processing', LogLevel.INFO);

    // Все заказы идут через быстрый API flow (~50 сек / заказ).
    // Старый Playwright flow удалён — см. git history если нужен fallback.
    await this.processOrderViaApi(order);
  }

  /**
   * Новый flow через EpicApiPurchaseService.
   * Занимает ~45-55 сек вместо 10 минут. Использует тот же пул прокси и Razer-аккаунтов.
   */
  private async processOrderViaApi(order: Order): Promise<void> {
    let selectedAccount: RazerAccount | null = null;

    try {
      // 1. Razer-аккаунт из пула
      const pkg = this.pricingService.findByAmount(order.vbucksAmount);
      const requiredTRY = pkg?.wholesaleTRY ?? 0;

      this.emitStep(order.orderId, 'account_selection', 'started');
      selectedAccount = await this.razerAccountService.selectAccountForPurchase(requiredTRY);
      if (!selectedAccount) {
        await this.markFailed(order, `No available Razer account with balance >= ${requiredTRY} TRY`);
        return;
      }
      await this.log(
        order,
        '[razer]',
        `Selected: ${selectedAccount.username} (balance ${selectedAccount.balanceTRY} TRY)`,
        LogLevel.INFO,
      );
      this.emitStep(order.orderId, 'account_selection', 'completed');

      // 2. Прокси (LRU rotation для concurrent заказов)
      this.emitStep(order.orderId, 'proxy_setup', 'started');
      const proxy = await this.proxyService.rotateProxy().catch(() => null);
      let apiProxy: EpicPurchaseProxy | undefined;
      if (proxy) {
        const scheme = proxy.type === ProxyType.SOCKS5 ? 'socks5' : 'http';
        apiProxy = {
          server: `${scheme}://${proxy.host}:${proxy.port}`,
          username: proxy.username || undefined,
          password: proxy.password || undefined,
        };
        await this.log(order, '[proxy]', `Using ${proxy.host}:${proxy.port}`, LogLevel.INFO);
      } else {
        await this.log(order, '[proxy]', 'No proxy — using direct connection', LogLevel.WARNING);
      }
      this.emitStep(order.orderId, 'proxy_setup', 'completed');

      // 3. Покупка через быстрый API flow
      this.emitStep(order.orderId, 'purchasing', 'started');
      await this.log(
        order,
        '[purchase]',
        `Fast API flow: ${order.vbucksAmount} V-Bucks via Razer Gold`,
        LogLevel.INFO,
      );

      const result = await this.apiPurchaseService.purchase({
        epicAccessToken: order.epicAccessToken!,
        vbucksAmount: order.vbucksAmount,
        country: 'TR',
        proxy: apiProxy,
        razerSessionCookies: selectedAccount.sessionCookies || undefined,
        razerCredentials: {
          email: selectedAccount.email,
          password: selectedAccount.password,
          totpSecret: (selectedAccount as any).totpSecret,
        },
      });
      this.emitStep(order.orderId, 'purchasing', 'completed');

      if (result.success) {
        await this.razerAccountService.markSuccess(selectedAccount.id, requiredTRY);

        // Сохраняем обновлённые Razer cookies — следующий заказ с этим аккаунтом
        // скипнет login form (-7 сек).
        if (result.refreshedRazerCookies) {
          await this.razerAccountService.updateAccount(selectedAccount.id, {
            sessionCookies: result.refreshedRazerCookies,
          } as any).catch((err) => {
            this.logger.warn(`Failed to persist Razer cookies for ${selectedAccount?.username}: ${err.message}`);
          });
          await this.log(order, '[razer]', 'Session cookies refreshed', LogLevel.INFO);
        }

        await this.log(
          order,
          '[purchase]',
          `Done in ${((result.durationMs || 0) / 1000).toFixed(1)}s, orderId: ${result.orderId}`,
          LogLevel.SUCCESS,
        );
        await this.handleSuccess(order, {
          success: true,
          screenshotPath: undefined,
        });
      } else {
        if ((result.errorReason || '').includes('captcha')) {
          await this.razerAccountService.markCaptchaEvent(selectedAccount.id);
        } else {
          await this.razerAccountService.markFailure(selectedAccount.id);
        }
        await this.handleFailure(order, {
          success: false,
          errorReason: result.errorReason as any,
          errorMessage: result.errorMessage,
        });
      }
    } catch (err: any) {
      this.logger.error(`[API-flow] Order ${order.orderId} failed: ${err.message}`, err.stack);
      this.emitStep(order.orderId, 'failed', 'failed', err.message);
      if (selectedAccount) {
        await this.razerAccountService.markFailure(selectedAccount.id).catch(() => {});
      }
      await this.markFailed(order, err.message);
    }
  }

  /**
   * Ждёт пока покупатель введёт код подтверждения смены региона.
   * @deprecated не используется в API-flow, но controller submitRegionCode оставлен на случай ручной ситуации
   */
  private async waitForRegionConfirmationCode(orderId: string, timeoutMs: number): Promise<string | null> {
    const startTime = Date.now();
    const pollInterval = 3000;

    while (Date.now() - startTime < timeoutMs) {
      const order = await this.ordersService.findByOrderId(orderId);
      if (order.epicUserCode && order.epicUserCode.startsWith('REGION:')) {
        const code = order.epicUserCode.replace('REGION:', '');
        await this.ordersService.updateOrder(order.id, { epicUserCode: null as any });
        return code;
      }
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    return null;
  }

  // ---------- private ----------

  private async handleSuccess(order: Order, result: PurchaseSummary): Promise<void> {
    this.emitStep(order.orderId, 'completed', 'completed');
    await this.ordersService.updateStatus(order.id, OrderStatusEnum.COMPLETED, {
      completedAt: new Date(),
      screenshotUrl: result.screenshotPath ?? undefined,
    });
    await this.log(order, '[purchase]', 'V-Bucks delivered successfully', LogLevel.SUCCESS);

    // Partner program: flip the matching commission entry from pending
    // to approved so its amount becomes spendable in `getBalance`
    // (Requirement 10.2). Idempotent — repeated calls are no-ops on the
    // CommissionService side. We swallow errors so a partner-side hiccup
    // never blocks the customer's success notification or webhook.
    if (order.partnerId) {
      await this.commissionService.approve(order.id).catch((err) =>
        this.logger.warn(
          `Failed to approve commission for order ${order.orderId}: ${err.message}`,
        ),
      );
    }

    await this.notificationService
      .notifyOrderCompleted(order.orderId, order.epicDisplayName ?? 'unknown', order.vbucksAmount)
      .catch((err) => this.logger.warn(`Telegram notify failed: ${err.message}`));

    if (order.webhookUrl) {
      await this.sendWebhook(order.webhookUrl, {
        orderId: order.orderId,
        status: 'completed',
        vbucksAmount: order.vbucksAmount,
        completedAt: new Date().toISOString(),
      });
    }
  }

  private async handleFailure(order: Order, result: PurchaseSummary): Promise<void> {
    const reason = result.errorReason ?? 'unknown';
    const message = result.errorMessage ?? 'Purchase failed';
    this.emitStep(order.orderId, 'failed', 'failed', `${reason}: ${message}`);
    await this.log(order, '[purchase]', `Failed: ${reason} — ${message}`, LogLevel.ERROR);
    await this.ordersService.updateStatus(order.id, OrderStatusEnum.FAILED, {
      errorMessage: `${reason}: ${message}`,
      screenshotUrl: result.screenshotPath ?? undefined,
    });

    // Partner program: cancel any pending commission for this order
    // (Requirement 10.3). Idempotent — if the entry is missing or
    // already in a terminal state it's a silent no-op.
    if (order.partnerId) {
      await this.commissionService.cancel(order.id).catch((err) =>
        this.logger.warn(
          `Failed to cancel commission for order ${order.orderId}: ${err.message}`,
        ),
      );
    }

    await this.notificationService
      .notifyOrderFailed(order.orderId, `${reason}: ${message}`)
      .catch((err) => this.logger.warn(`Telegram notify failed: ${err.message}`));
  }

  private async markFailed(order: Order, message: string): Promise<void> {
    await this.log(order, '[system]', message, LogLevel.ERROR);
    await this.ordersService.updateStatus(order.id, OrderStatusEnum.FAILED, {
      errorMessage: message,
    });

    // Partner program: same cancel hook as handleFailure — markFailed
    // is the early-exit path before purchase even starts (e.g. missing
    // Epic access token). Without this hook the commission entry would
    // be stranded in `pending` forever (Requirement 10.3, 16.6).
    if (order.partnerId) {
      await this.commissionService.cancel(order.id).catch((err) =>
        this.logger.warn(
          `Failed to cancel commission for order ${order.orderId}: ${err.message}`,
        ),
      );
    }
  }

  private async log(order: Order, tag: string, message: string, level: LogLevel): Promise<void> {
    await this.ordersService.addTimelineLog(order.id, { tag, message, level });
  }

  private async sendWebhook(url: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await axios.post(url, payload, {
        timeout: 5000,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err: any) {
      this.logger.warn(`Webhook delivery failed (${url}): ${err.message}`);
    }
  }
}
