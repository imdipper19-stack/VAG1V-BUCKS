import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { Browser, BrowserContext } from 'playwright';
import axios from 'axios';
import { OrdersService } from '../orders/orders.service';
import { EpicBrowserService, PurchaseResult } from '../epic/epic-browser.service';
import { AuthService } from '../auth/auth.service';
import { NotificationService } from '../common/notification.service';
import { ProxyService } from '../proxy/proxy.service';
import { RazerAccountService } from '../razer/razer-account.service';
import { PricingService } from '../orders/pricing.service';
import { OrderStatusEnum, LogLevel, Order, RazerAccount } from '../database/entities';
import { OrderEventBus } from './order-event-bus.service';
import { OrderStep, StepStatus } from './interfaces/step-event.interface';
import { STEP_PROGRESS_MAP, STEP_MESSAGES_RU } from './constants/step-progress';

/**
 * Главный конвейер обработки заказа.
 *
 * Шаги:
 * 1. Получить заказ, проверить epicAccessToken
 * 2. Получить свежий exchange_code
 * 3. Выбрать Razer-аккаунт из пула (с балансом и без cooldown)
 * 4. Запустить браузер (stealth + прокси + cookies Razer-аккаунта)
 * 5. Залогиниться в Epic через exchange_code
 * 6. Сменить регион на TR если нужно
 * 7. Купить V-Bucks (при капче — 2Captcha решает автоматически)
 * 8. Обновить статус заказа, уведомить
 */
@Injectable()
export class OrderProcessingService {
  private readonly logger = new Logger(OrderProcessingService.name);

  constructor(
    private readonly ordersService: OrdersService,
    private readonly epicBrowserService: EpicBrowserService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
    private readonly notificationService: NotificationService,
    private readonly proxyService: ProxyService,
    private readonly razerAccountService: RazerAccountService,
    private readonly pricingService: PricingService,
    private readonly orderEventBus: OrderEventBus,
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

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let selectedAccount: RazerAccount | null = null;

    try {
      // 1. Свежий exchange_code
      this.emitStep(order.orderId, 'auth', 'started');
      const exchangeCode = await this.authService.getExchangeCode(order.epicAccessToken);
      await this.log(order, '[auth]', 'Fresh exchange code obtained', LogLevel.INFO);
      this.emitStep(order.orderId, 'auth', 'completed');

      // 2. Определяем стоимость в TRY для выбора аккаунта
      const pkg = this.pricingService.findByAmount(order.vbucksAmount);
      const requiredTRY = pkg?.wholesaleTRY ?? 0;

      // 3. Выбираем Razer-аккаунт из пула
      this.emitStep(order.orderId, 'account_selection', 'started');
      selectedAccount = await this.razerAccountService.selectAccountForPurchase(requiredTRY);

      if (!selectedAccount) {
        await this.markFailed(order, `No available Razer account with balance ≥ ${requiredTRY} TRY`);
        await this.notificationService
          .notifySystemAlert(`⚠️ Нет доступных Razer-аккаунтов для заказа ${orderId} (нужно ${requiredTRY} TRY)`)
          .catch(() => {});
        return;
      }

      await this.log(
        order,
        '[razer]',
        `Selected account: ${selectedAccount.username} (trust: ${selectedAccount.trustLevel}, balance: ${selectedAccount.balanceTRY} TRY)`,
        LogLevel.INFO,
      );
      this.emitStep(order.orderId, 'account_selection', 'completed');

      // Обновляем баланс TRY с реального аккаунта Razer (best effort)
      this.emitStep(order.orderId, 'balance_check', 'started');
      try {
        const validation = await this.epicBrowserService.validateRazerCookies(
          selectedAccount.sessionCookies || '[]',
          {
            email: selectedAccount.email,
            password: selectedAccount.password,
            totpSecret: (selectedAccount as any).totpSecret,
          },
        );
        if (validation.valid && validation.balance !== undefined) {
          await this.razerAccountService.updateBalanceTRY(selectedAccount.id, validation.balance);
          selectedAccount.balanceTRY = validation.balance;
          await this.log(order, '[razer]', `Live balance: ${validation.balance} TRY`, LogLevel.INFO);

          // Если баланса не хватает — ошибка
          if (validation.balance < requiredTRY) {
            await this.markFailed(order, `Insufficient Razer balance: ${validation.balance} TRY < required ${requiredTRY} TRY`);
            return;
          }
        }
        // Сохраняем обновлённые куки если был перелогин
        if (validation.refreshedCookies) {
          await this.razerAccountService.updateAccount(selectedAccount.id, {
            sessionCookies: validation.refreshedCookies,
          } as any);
          selectedAccount.sessionCookies = validation.refreshedCookies;
        }
      } catch (err: any) {
        await this.log(order, '[razer]', `Balance check failed: ${err.message} — continuing anyway`, LogLevel.WARNING);
      }
      this.emitStep(order.orderId, 'balance_check', 'completed');

      // 4. Берём активный прокси из БД (если есть)
      this.emitStep(order.orderId, 'proxy_setup', 'started');
      const proxy = await this.proxyService.getActiveProxy();
      if (proxy) {
        await this.log(order, '[proxy]', `Using proxy: ${proxy.host}:${proxy.port}`, LogLevel.INFO);
      } else {
        await this.log(order, '[proxy]', 'No proxy configured — using direct connection', LogLevel.WARNING);
      }
      this.emitStep(order.orderId, 'proxy_setup', 'completed');

      // 5. Запускаем браузер с cookies Razer-аккаунта
      this.emitStep(order.orderId, 'browser_launch', 'started');
      browser = await this.epicBrowserService.launchBrowser();

      // Если у аккаунта есть куки — используем их (залогинены в Razer Gold)
      if (selectedAccount.sessionCookies) {
        context = await this.epicBrowserService.createContextWithCookies(
          browser,
          selectedAccount.sessionCookies,
          proxy ? {
            host: proxy.host,
            port: proxy.port,
            username: proxy.username,
            password: proxy.password,
            type: proxy.type,
          } : undefined,
        );
      } else {
        context = await this.epicBrowserService.createContext(
          browser,
          proxy ? {
            host: proxy.host,
            port: proxy.port,
            username: proxy.username,
            password: proxy.password,
            type: proxy.type,
          } : undefined,
        );
      }

      const page = await context.newPage();
      this.emitStep(order.orderId, 'browser_launch', 'completed');

      // 6. Логин в Epic через exchange_code клиента
      this.emitStep(order.orderId, 'epic_login', 'started');
      await this.epicBrowserService.loginWithExchangeCode(page, { exchangeCode });
      await this.log(order, '[browser]', 'Logged in via exchange code', LogLevel.SUCCESS);
      this.emitStep(order.orderId, 'epic_login', 'completed');

      // 7. Смена региона на TR
      this.emitStep(order.orderId, 'region_change', 'started');
      const regionResult = await this.epicBrowserService.initiateRegionChange(page);

      if (!regionResult.alreadyTR && regionResult.needsConfirmation) {
        await this.ordersService.updateStatus(order.id, OrderStatusEnum.AWAITING_AUTH, {
          errorMessage: 'region_confirmation_required',
        });
        await this.log(order, '[region]', 'Region change initiated — waiting for email code', LogLevel.INFO);

        const confirmationCode = await this.waitForRegionConfirmationCode(order.orderId, 600_000);

        if (confirmationCode) {
          const confirmed = await this.epicBrowserService.confirmRegionChange(page, confirmationCode);
          if (confirmed) {
            await this.log(order, '[region]', 'Region changed to TR', LogLevel.SUCCESS);
          } else {
            await this.log(order, '[region]', 'Region confirmation failed — proceeding anyway', LogLevel.WARNING);
          }
        } else {
          await this.log(order, '[region]', 'Region confirmation timeout — proceeding anyway', LogLevel.WARNING);
        }

        await this.ordersService.updateStatus(order.id, OrderStatusEnum.PROCESSING);
      } else if (regionResult.alreadyTR) {
        await this.log(order, '[region]', 'Region is already TR', LogLevel.INFO);
      }
      this.emitStep(order.orderId, 'region_change', 'completed');

      // 8. Покупка V-Bucks
      this.emitStep(order.orderId, 'purchasing', 'started');
      await this.log(order, '[purchase]', `Purchasing ${order.vbucksAmount} V-Bucks via Razer Gold`, LogLevel.INFO);

      const result = await this.epicBrowserService.purchaseVBucks(
        page,
        order.vbucksAmount,
        './screenshots',
        {
          email: selectedAccount.email,
          password: selectedAccount.password,
          totpSecret: (selectedAccount as any).totpSecret,
        },
      );
      this.emitStep(order.orderId, 'purchasing', 'completed');

      if (result.success) {
        // Помечаем успех в пуле аккаунтов
        await this.razerAccountService.markSuccess(selectedAccount.id, requiredTRY);
        await this.handleSuccess(order, result);
      } else {
        // Если была капча — помечаем событие (cooldown на аккаунт)
        if (result.errorReason === 'requires_captcha') {
          await this.razerAccountService.markCaptchaEvent(selectedAccount.id);
          await this.log(order, '[captcha]', 'hCaptcha event recorded — account on cooldown', LogLevel.WARNING);
        } else {
          await this.razerAccountService.markFailure(selectedAccount.id);
        }
        await this.handleFailure(order, result);
      }

    } catch (error: any) {
      this.logger.error(`Order ${orderId} failed: ${error.message}`, error.stack);
      this.emitStep(order.orderId, 'failed', 'failed', error.message ?? 'Unknown error');

      // Если ошибка связана с капчей — помечаем аккаунт
      if (selectedAccount && error.message?.includes('captcha')) {
        await this.razerAccountService.markCaptchaEvent(selectedAccount.id).catch(() => {});
      } else if (selectedAccount) {
        await this.razerAccountService.markFailure(selectedAccount.id).catch(() => {});
      }

      await this.markFailed(order, error.message ?? 'Unknown error');
    } finally {
      await this.epicBrowserService.cleanup(browser, context);
    }
  }

  /**
   * Ждёт пока покупатель введёт код подтверждения смены региона.
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

  private async handleSuccess(order: Order, result: PurchaseResult): Promise<void> {
    this.emitStep(order.orderId, 'completed', 'completed');
    await this.ordersService.updateStatus(order.id, OrderStatusEnum.COMPLETED, {
      completedAt: new Date(),
      screenshotUrl: result.screenshotPath ?? undefined,
    });
    await this.log(order, '[purchase]', 'V-Bucks delivered successfully', LogLevel.SUCCESS);

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

  private async handleFailure(order: Order, result: PurchaseResult): Promise<void> {
    const reason = result.errorReason ?? 'unknown';
    const message = result.errorMessage ?? 'Purchase failed';
    this.emitStep(order.orderId, 'failed', 'failed', `${reason}: ${message}`);
    await this.log(order, '[purchase]', `Failed: ${reason} — ${message}`, LogLevel.ERROR);
    await this.ordersService.updateStatus(order.id, OrderStatusEnum.FAILED, {
      errorMessage: `${reason}: ${message}`,
      screenshotUrl: result.screenshotPath ?? undefined,
    });

    await this.notificationService
      .notifyOrderFailed(order.orderId, `${reason}: ${message}`)
      .catch((err) => this.logger.warn(`Telegram notify failed: ${err.message}`));
  }

  private async markFailed(order: Order, message: string): Promise<void> {
    await this.log(order, '[system]', message, LogLevel.ERROR);
    await this.ordersService.updateStatus(order.id, OrderStatusEnum.FAILED, {
      errorMessage: message,
    });
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
