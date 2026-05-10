import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { OrdersService } from '../orders/orders.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private webhooksService: WebhooksService,
    private ordersService: OrdersService,
  ) {}

  @Post('test')
  @HttpCode(HttpStatus.OK)
  async testWebhook(@Body() body: { webhookUrl: string }) {
    const result = await this.webhooksService.sendWebhook(body.webhookUrl, {
      status: 'test',
      orderId: 'TEST-001',
      amount: 0,
      currency: 'TRY',
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
      return {
        success: false,
        message: 'Order is not completed yet',
      };
    }

    if (!order.webhookUrl) {
      return {
        success: false,
        message: 'No webhook URL configured for this order',
      };
    }

    const payload = this.webhooksService.buildWebhookPayload(order, '0m 0s');
    const result = await this.webhooksService.sendWebhook(order.webhookUrl, payload);

    // Save webhook response to order
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
