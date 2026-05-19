import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { OrdersService } from '../orders/orders.service';
import { LogLevel } from '../database/entities';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly ordersService: OrdersService,
  ) {}

  /**
   * POST /api/payments/create-invoice
   * Создаёт платёж в AntilopaPay и возвращает payment_url для редиректа.
   *
   * Согласно документации AntilopaPay (раздел 5.1):
   * - Обязательные поля: project_identificator, amount, order_id, currency (RUB),
   *   product_name, product_type, description, customer (email или phone)
   * - Ответ: { code: 0, payment_id, payment_url }
   */
  @Post('create-invoice')
  @HttpCode(HttpStatus.CREATED)
  async createInvoice(
    @Body() dto: {
      orderId: string;
      amount: number;
      currency?: string;
      customerEmail?: string;
    },
  ) {
    const invoice = await this.paymentsService.createInvoice({
      orderId: dto.orderId,
      amount: dto.amount,
      currency: dto.currency || 'RUB',
      description: `V-Bucks Order ${dto.orderId}`,
      customerEmail: dto.customerEmail,
    });

    // Сохраняем payment_id в заказе
    try {
      const order = await this.ordersService.findByOrderId(dto.orderId);
      await this.ordersService.updateOrder(order.id, { invoiceId: invoice.id });
      await this.ordersService.addTimelineLog(order.id, {
        tag: '[payment]',
        message: `Инвойс создан: ${invoice.id}`,
        level: LogLevel.INFO,
      });
    } catch (err: any) {
      this.logger.warn(`Failed to update order with invoice: ${err.message}`);
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

  /**
   * GET /api/payments/invoice/:orderId
   * Проверяет статус платежа по нашему orderId.
   * Согласно документации AntilopaPay (раздел 5.2): payment/check
   */
  @Get('invoice/:orderId')
  async getInvoice(@Param('orderId') orderId: string) {
    const invoice = await this.paymentsService.checkInvoice(orderId);

    if (!invoice) {
      return { success: false, error: 'Invoice not found' };
    }

    return {
      success: true,
      data: {
        invoiceId: invoice.id,
        orderId: invoice.orderId,
        status: invoice.status,
        amount: invoice.amount,
        currency: invoice.currency,
        paymentUrl: invoice.paymentUrl,
      },
    };
  }

  /**
   * GET /api/payments/methods
   */
  @Get('methods')
  getPaymentMethods() {
    return {
      success: true,
      data: [
        {
          id: 'antilopapay',
          name: 'АнтилопаPay',
          nameEn: 'AntilopaPay',
          commission: 0,
          minAmount: 10,
          maxAmount: 1_000_000,
          currency: 'RUB',
        },
      ],
    };
  }
}
