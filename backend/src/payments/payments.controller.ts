import { Controller, Post, Body, Get, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { PaymentsService, CreateInvoiceDto } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  @Post('create-invoice')
  @HttpCode(HttpStatus.CREATED)
  async createInvoice(@Body() dto: CreateInvoiceDto) {
    const invoice = await this.paymentsService.createInvoice(dto);

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

    return {
      success: result,
      message: result ? 'Invoice cancelled' : 'Failed to cancel invoice',
    };
  }

  // Webhook endpoint for AntiLav callbacks
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Body() body: any) {
    // Verify webhook signature
    const signature = body.signature;

    // Process webhook based on event type
    switch (body.event) {
      case 'invoice.paid':
        // Handle successful payment
        console.log(`Invoice ${body.invoice_id} paid`);
        return { received: true };

      case 'invoice.expired':
        // Handle expired invoice
        console.log(`Invoice ${body.invoice_id} expired`);
        return { received: true };

      case 'invoice.cancelled':
        // Handle cancelled invoice
        console.log(`Invoice ${body.invoice_id} cancelled`);
        return { received: true };

      default:
        return { received: true };
    }
  }
}
