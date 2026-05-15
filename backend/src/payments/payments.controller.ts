import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { OrdersService } from '../orders/orders.service';
import {
  OrderStatusEnum,
  PaymentStatusEnum,
  LogLevel,
} from '../database/entities';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private paymentsService: PaymentsService,
    private ordersService: OrdersService,
  ) {}

  @Post('create-invoice')
  @HttpCode(HttpStatus.CREATED)
  async createInvoice(@Body() dto: { orderId: string; amount: number; currency?: string }) {
    const invoice = await this.paymentsService.createInvoice({
      orderId: dto.orderId,
      amount: dto.amount,
      currency: dto.currency || 'TRY',
      description: `V-Bucks Order ${dto.orderId}`,
    });

    // Сохраняем invoice ID в заказе
    try {
      const order = await this.ordersService.findByOrderId(dto.orderId);
      await this.ordersService.updateOrder(order.id, {
        invoiceId: invoice.id,
      });
      await this.ordersService.addTimelineLog(order.id, {
        tag: '[payment]',
        message: `Invoice created: ${invoice.id}`,
        level: LogLevel.INFO,
      });
    } catch (error) {
      this.logger.warn(`Failed to update order with invoice: ${error}`);
    }

    return {
      success: true,
      data: {
        invoiceId: invoice.id,
        paymentUrl: invoice.paymentUrl,
        amount: invoice.amount,
        currency: invoice.currency,
        expiresAt: invoice.expiresAt,
      },
    };
  }

  @Get('invoice/:invoiceId')
  async getInvoice(@Param('invoiceId') invoiceId: string) {
    const invoice = await this.paymentsService.checkInvoice(invoiceId);

    if (!invoice) {
      return {
        success: false,
        error: 'Invoice not found',
      };
    }

    return {
      success: true,
      data: {
        invoiceId: invoice.id,
        orderId: invoice.orderId,
        status: invoice.status,
        amount: invoice.amount,
        currency: invoice.currency,
      },
    };
  }

  @Get('methods')
  async getPaymentMethods() {
    const methods = await this.paymentsService.getPaymentMethods();

    return {
      success: true,
      data: methods,
    };
  }

  @Post('invoice/:invoiceId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelInvoice(@Param('invoiceId') invoiceId: string) {
    const result = await this.paymentsService.cancelInvoice(invoiceId);

    if (result) {
      // Обновляем статус заказа
      try {
        const invoice = await this.paymentsService.checkInvoice(invoiceId);
        if (invoice?.orderId) {
          const order = await this.ordersService.findByOrderId(invoice.orderId);
          await this.ordersService.updateStatus(order.id, OrderStatusEnum.FAILED);
          await this.ordersService.addTimelineLog(order.id, {
            tag: '[payment]',
            message: `Invoice cancelled`,
            level: LogLevel.WARNING,
          });
        }
      } catch (error) {
        this.logger.warn(`Failed to update cancelled order: ${error}`);
      }
    }

    return {
      success: result,
      message: result ? 'Invoice cancelled' : 'Failed to cancel invoice',
    };
  }

  // Webhook endpoint for AntiLav callbacks
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() body: any,
    @Headers('x-webhook-signature') signature: string,
  ) {
    this.logger.log(`Received webhook: ${JSON.stringify(body)}`);

    // Verify webhook signature
    const rawPayload = JSON.stringify(body);
    if (!this.paymentsService.verifyWebhookSignature(rawPayload, signature || '')) {
      this.logger.warn('Invalid webhook signature');
      return { received: false, error: 'Invalid signature' };
    }

    const payload = this.paymentsService.parseWebhookPayload(body);
    if (!payload) {
      this.logger.warn('Invalid webhook payload');
      return { received: false, error: 'Invalid payload' };
    }

    this.logger.log(`Processing webhook: event=${payload.event}, invoice=${payload.invoiceId}`);

    try {
      switch (payload.event) {
        case 'invoice.paid':
        case 'payment.success':
          await this.handlePaymentSuccess(payload);
          break;

        case 'invoice.expired':
          await this.handlePaymentExpired(payload);
          break;

        case 'invoice.cancelled':
        case 'payment.failed':
          await this.handlePaymentFailed(payload);
          break;

        default:
          this.logger.log(`Unhandled webhook event: ${payload.event}`);
      }
    } catch (error) {
      this.logger.error(`Webhook processing error: ${error}`);
    }

    return { received: true };
  }

  /**
   * Обработка успешной оплаты
   */
  private async handlePaymentSuccess(payload: any): Promise<void> {
    this.logger.log(`Payment success for invoice: ${payload.invoiceId}`);

    try {
      // Найти заказ по invoice ID
      const order = await this.ordersService.findByOrderId(payload.orderId);

      // Обновляем статус оплаты и переводим заказ в awaiting_auth
      // чтобы покупатель мог авторизоваться через Epic Games
      await this.ordersService.updateOrder(order.id, {
        paymentStatus: PaymentStatusEnum.PAID,
      });

      await this.ordersService.updateStatus(order.id, OrderStatusEnum.AWAITING_AUTH);

      await this.ordersService.addTimelineLog(order.id, {
        tag: '[payment]',
        message: `Payment confirmed: ${payload.amount} ${payload.currency}`,
        level: LogLevel.SUCCESS,
      });

      this.logger.log(`Order ${order.orderId} payment confirmed, awaiting Epic auth`);

    } catch (error) {
      this.logger.error(`Failed to process payment success: ${error}`);
    }
  }

  /**
   * Обработка истёкшего счёта
   */
  private async handlePaymentExpired(payload: any): Promise<void> {
    this.logger.log(`Payment expired for invoice: ${payload.invoiceId}`);

    try {
      const order = await this.ordersService.findByOrderId(payload.orderId);

      await this.ordersService.updateStatus(order.id, OrderStatusEnum.FAILED);

      await this.ordersService.addTimelineLog(order.id, {
        tag: '[payment]',
        message: 'Payment expired',
        level: LogLevel.WARNING,
      });

    } catch (error) {
      this.logger.error(`Failed to process payment expiry: ${error}`);
    }
  }

  /**
   * Обработка неуспешной оплаты
   */
  private async handlePaymentFailed(payload: any): Promise<void> {
    this.logger.log(`Payment failed for invoice: ${payload.invoiceId}`);

    try {
      const order = await this.ordersService.findByOrderId(payload.orderId);

      await this.ordersService.updateStatus(order.id, OrderStatusEnum.FAILED);

      await this.ordersService.addTimelineLog(order.id, {
        tag: '[payment]',
        message: 'Payment failed',
        level: LogLevel.ERROR,
      });

    } catch (error) {
      this.logger.error(`Failed to process payment failure: ${error}`);
    }
  }
}
