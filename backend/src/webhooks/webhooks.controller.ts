import {
  Controller,
  Post,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
  Headers,
} from '@nestjs/common';
import { Request } from 'express';
import { WebhooksService } from './webhooks.service';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';
import {
  OrderStatusEnum,
  PaymentStatusEnum,
  LogLevel,
} from '../database/entities';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly ordersService: OrdersService,
    private readonly paymentsService: PaymentsService,
  ) {}

  // ─────────────────────────────────────────────────────────────
  // AntilopaPay callback
  // POST /api/webhooks/antilopapay
  //
  // Согласно документации раздел 10:
  // - Заголовок подписи: X-Apay-Callback
  // - Версия алгоритма: X-Apay-Callback-Version
  // - Подпись вычисляется по полному телу запроса
  // - Ответить HTTP 200 OK в течение 10 секунд
  // - Повторные попытки: каждые 3 минуты в течение 1 часа
  // ─────────────────────────────────────────────────────────────

  @Post('antilopapay')
  @HttpCode(HttpStatus.OK)
  async handleAntilopaPay(
    @Req() req: Request,
    @Body() body: any,
    @Headers('x-apay-callback') signature: string,
    @Headers('x-apay-callback-version') signVersion: string,
  ) {
    // Получаем rawBody для верификации подписи
    const rawBody: Buffer = (req as any).rawBody ?? Buffer.from(JSON.stringify(body));

    // Верифицируем подпись публичным ключом AntilopaPay
    const valid = this.paymentsService.verifyCallbackSignature(rawBody, signature ?? '');

    if (!valid) {
      this.logger.warn(`[AntilopaPay] Invalid callback signature (version=${signVersion}) — rejected`);
      // Возвращаем 200 чтобы AntilopaPay не ретраил бесконечно,
      // но ничего не обрабатываем
      return { received: false, error: 'invalid_signature' };
    }

    const payload = this.paymentsService.parseCallbackPayload(body);
    if (!payload) {
      this.logger.warn('[AntilopaPay] Cannot parse callback payload');
      return { received: false, error: 'invalid_payload' };
    }

    this.logger.log(
      `[AntilopaPay] Callback: type=${payload.type} orderId=${payload.orderId} status=${payload.status}`,
    );

    // Обрабатываем только платёжные callback'и (type='payment')
    // Согласно документации раздел 10.6: возможные статусы SUCCESS, FAIL
    if (payload.type !== 'payment') {
      this.logger.log(`[AntilopaPay] Skipping non-payment callback type=${payload.type}`);
      return { received: true };
    }

    try {
      if (payload.status === 'SUCCESS') {
        await this.handlePaymentSuccess(payload);
      } else if (payload.status === 'FAIL' || payload.status === 'CANCEL' || payload.status === 'EXPIRED') {
        await this.handlePaymentFailed(payload);
      } else {
        this.logger.log(`[AntilopaPay] Unhandled payment status: ${payload.status}`);
      }
    } catch (err: any) {
      this.logger.error(`[AntilopaPay] Callback processing error: ${err.message}`);
      // Всё равно возвращаем 200 — иначе AntilopaPay будет ретраить
    }

    return { received: true };
  }

  // ─────────────────────────────────────────────────────────────
  // Обработчики статусов
  // ─────────────────────────────────────────────────────────────

  private async handlePaymentSuccess(payload: {
    orderId: string;
    paymentId: string;
    amount?: number;
    originalAmount?: number;
    currency?: string;
  }): Promise<void> {
    const order = await this.ordersService.findByOrderId(payload.orderId);

    // Идемпотентность — не обрабатываем повторно
    if (order.paymentStatus === PaymentStatusEnum.PAID) {
      this.logger.log(`[AntilopaPay] Order ${payload.orderId} already paid — skipping`);
      return;
    }

    // ВАЖНО: согласно документации (раздел 10.6) необходимо проверять original_amount
    // При расхождении нужно отправить запрос на отмену платежа
    if (payload.originalAmount !== undefined) {
      const expectedAmount = Number(order.priceTRY);
      const receivedAmount = payload.originalAmount;
      // Допускаем погрешность 0.01 из-за float
      if (Math.abs(expectedAmount - receivedAmount) > 0.01) {
        this.logger.error(
          `[AntilopaPay] Amount mismatch for order ${payload.orderId}: ` +
          `expected=${expectedAmount}, received=${receivedAmount}. Skipping.`,
        );
        await this.ordersService.addTimelineLog(order.id, {
          tag: '[payment]',
          message: `⚠️ Расхождение суммы: ожидалось ${expectedAmount}, получено ${receivedAmount}`,
          level: LogLevel.ERROR,
        });
        return;
      }
    }

    await this.ordersService.updateOrder(order.id, {
      paymentStatus: PaymentStatusEnum.PAID,
      invoiceId: payload.paymentId || order.invoiceId,
    });

    await this.ordersService.updateStatus(order.id, OrderStatusEnum.AWAITING_AUTH);

    await this.ordersService.addTimelineLog(order.id, {
      tag: '[payment]',
      message: `✅ Оплата подтверждена: ${payload.amount ?? ''} ${payload.currency ?? 'RUB'}`.trim(),
      level: LogLevel.SUCCESS,
    });

    this.logger.log(`[AntilopaPay] ✅ Order ${order.orderId} paid — awaiting Epic auth`);
  }

  private async handlePaymentFailed(payload: {
    orderId: string;
    status: string;
  }): Promise<void> {
    let order: any;
    try {
      order = await this.ordersService.findByOrderId(payload.orderId);
    } catch {
      this.logger.warn(`[AntilopaPay] Order not found for failed payment: ${payload.orderId}`);
      return;
    }

    if (order.status === OrderStatusEnum.FAILED) return;

    const statusMessages: Record<string, string> = {
      FAIL: 'Оплата не прошла',
      CANCEL: 'Покупатель отменил оплату',
      EXPIRED: 'Время оплаты истекло',
    };

    await this.ordersService.updateStatus(order.id, OrderStatusEnum.FAILED);
    await this.ordersService.addTimelineLog(order.id, {
      tag: '[payment]',
      message: statusMessages[payload.status] ?? 'Оплата не выполнена',
      level: LogLevel.ERROR,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Dev/test helpers
  // ─────────────────────────────────────────────────────────────

  @Post('test')
  @HttpCode(HttpStatus.OK)
  async testWebhook(@Body() body: { webhookUrl: string }) {
    const result = await this.webhooksService.sendWebhook(body.webhookUrl, {
      status: 'test',
      orderId: 'TEST-001',
      amount: 0,
      currency: 'RUB',
      vbucksDelivered: 0,
      timestamp: new Date().toISOString(),
    });

    return {
      success: result.success,
      message: result.success ? 'Webhook test successful' : 'Webhook test failed',
      error: result.error,
    };
  }

  @Post('trigger')
  @HttpCode(HttpStatus.OK)
  async triggerOrderWebhook(@Body() body: { orderId: string }) {
    const order = await this.ordersService.findByOrderId(body.orderId);

    if (order.status !== 'completed') {
      return { success: false, message: 'Order is not completed yet' };
    }

    if (!order.webhookUrl) {
      return { success: false, message: 'No webhook URL configured for this order' };
    }

    const payload = this.webhooksService.buildWebhookPayload(order, '0m 0s');
    const result = await this.webhooksService.sendWebhook(order.webhookUrl, payload);

    await this.ordersService.updateStatus(order.id, order.status, {
      webhookResponse: JSON.stringify({ code: result.responseCode, error: result.error }),
    });

    return {
      success: result.success,
      message: result.success ? 'Webhook sent successfully' : 'Webhook delivery failed',
      error: result.error,
    };
  }
}
