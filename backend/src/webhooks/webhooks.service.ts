import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class WebhooksService {
  /**
   * Send webhook notification to seller
   */
  async sendWebhook(webhookUrl: string, payload: {
    status: string;
    orderId: string;
    amount: number;
    currency: string;
    vbucksDelivered: number;
    transactionId?: string;
    timestamp: string;
    automation?: {
      browser: string;
      stepsCompleted: number;
      totalTime: string;
    };
  }): Promise<{
    success: boolean;
    responseCode?: number;
    error?: string;
  }> {
    try {
      const response = await axios.post(webhookUrl, payload, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Bag1V-Bucks/1.0',
        },
      });

      return {
        success: response.status >= 200 && response.status < 300,
        responseCode: response.status,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Webhook delivery failed',
      };
    }
  }

  /**
   * Build webhook payload for completed order
   */
  buildWebhookPayload(order: any, processingTime: string): any {
    return {
      status: 'success',
      order_id: order.orderId,
      amount: order.priceTRY,
      currency: order.currency,
      vbucks_delivered: order.vbucksAmount,
      transaction_id: order.transactionId,
      timestamp: new Date().toISOString(),
      automation: {
        browser: 'playwright-chromium',
        steps_completed: 5,
        total_time: processingTime,
      },
    };
  }
}
