import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';

export interface AntiLavInvoice {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'expired' | 'cancelled';
  paymentUrl: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface CreateInvoiceDto {
  orderId: string;
  amount: number;
  currency?: string;
  description?: string;
}

export enum PaymentMethod {
  CARD = 'card',
  SBP = 'sbp',
  CRYPTO = 'crypto',
  RAZER_GOLD = 'razer_gold',
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly apiKey: string;
  private readonly shopId: string;
  private readonly baseUrl = 'https://api.antilav.com/v1';
  private readonly isProduction: boolean;

  private readonly webhookSecret: string;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get('ANTILAV_API_KEY', '');
    this.shopId = this.configService.get('ANTILAV_SHOP_ID', '');
    this.webhookSecret = this.configService.get('WEBHOOK_SECRET', '');
    this.isProduction = this.configService.get('NODE_ENV') === 'production';
  }

  /**
   * Create a new payment invoice with AntiLav
   */
  async createInvoice(data: CreateInvoiceDto): Promise<AntiLavInvoice> {
    // Если нет API ключа (dev mode) - возвращаем mock
    if (!this.apiKey || !this.shopId) {
      this.logger.warn('AntiLav API not configured, returning mock invoice');
      return this.createMockInvoice(data);
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/invoices`,
        {
          shop_id: this.shopId,
          external_id: data.orderId,
          amount: data.amount,
          currency: data.currency || 'TRY',
          description: data.description || `V-Bucks Order ${data.orderId}`,
          lifetime: 3600, // 1 hour
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      return {
        id: response.data.id,
        orderId: data.orderId,
        amount: response.data.amount,
        currency: response.data.currency,
        status: response.data.status,
        paymentUrl: response.data.payment_url,
        createdAt: new Date(response.data.created_at),
        expiresAt: new Date(response.data.expires_at),
      };
    } catch (error: any) {
      this.logger.error('Failed to create AntiLav invoice:', error.message);
      // В dev режиме возвращаем mock
      if (!this.isProduction) {
        return this.createMockInvoice(data);
      }
      throw error;
    }
  }

  /**
   * Create mock invoice for development
   */
  private createMockInvoice(data: CreateInvoiceDto): AntiLavInvoice {
    const mockId = `inv_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    return {
      id: mockId,
      orderId: data.orderId,
      amount: data.amount,
      currency: data.currency || 'TRY',
      status: 'pending',
      paymentUrl: `https://pay.antilav.com/mock/${mockId}`,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600 * 1000),
    };
  }

  /**
   * Check invoice status
   */
  async checkInvoice(invoiceId: string): Promise<AntiLavInvoice | null> {
    // Mock invoice для development
    if (invoiceId.startsWith('inv_') || !this.apiKey) {
      return {
        id: invoiceId,
        orderId: 'unknown',
        amount: 0,
        currency: 'TRY',
        status: 'pending',
        paymentUrl: '',
        createdAt: new Date(),
        expiresAt: new Date(),
      };
    }

    try {
      const response = await axios.get(
        `${this.baseUrl}/invoices/${invoiceId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
          timeout: 10000,
        }
      );

      return {
        id: response.data.id,
        orderId: response.data.external_id,
        amount: response.data.amount,
        currency: response.data.currency,
        status: response.data.status,
        paymentUrl: response.data.payment_url,
        createdAt: new Date(response.data.created_at),
        expiresAt: new Date(response.data.expires_at),
      };
    } catch (error) {
      this.logger.error('Failed to check invoice:', error);
      return null;
    }
  }

  /**
   * Cancel an invoice
   */
  async cancelInvoice(invoiceId: string): Promise<boolean> {
    if (!this.apiKey) {
      this.logger.warn('AntiLav API not configured');
      return false;
    }

    try {
      await axios.post(
        `${this.baseUrl}/invoices/${invoiceId}/cancel`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
          timeout: 10000,
        }
      );
      return true;
    } catch (error) {
      this.logger.error('Failed to cancel invoice:', error);
      return false;
    }
  }

  /**
   * Get payment methods available
   */
  async getPaymentMethods(): Promise<Array<{
    id: string;
    name: string;
    nameEn: string;
    commission: number;
    minAmount: number;
    maxAmount: number;
    icon?: string;
  }>> {
    // Возвращаем реальные методы (для Турции)
    return [
      {
        id: PaymentMethod.CARD,
        name: 'Банковская карта',
        nameEn: 'Credit/Debit Card',
        commission: 0,
        minAmount: 50,
        maxAmount: 50000,
        icon: 'card',
      },
      {
        id: PaymentMethod.SBP,
        name: 'СБП (Россия)',
        nameEn: 'SBP (Russia)',
        commission: 0,
        minAmount: 10,
        maxAmount: 600000,
        icon: 'sbp',
      },
      {
        id: PaymentMethod.CRYPTO,
        name: 'Криптовалюта',
        nameEn: 'Cryptocurrency',
        commission: 1,
        minAmount: 100,
        maxAmount: 1000000,
        icon: 'crypto',
      },
    ];
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!this.webhookSecret) {
      this.logger.warn('WEBHOOK_SECRET not configured, skipping signature verification');
      return !this.isProduction; // Allow in dev, reject in production
    }

    try {
      const expectedSignature = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(payload)
        .digest('hex');

      // Timing-safe comparison to prevent timing attacks
      const sigBuf = Buffer.from(signature);
      const expectedBuf = Buffer.from(expectedSignature);

      if (sigBuf.length !== expectedBuf.length) return false;
      return crypto.timingSafeEqual(sigBuf, expectedBuf);
    } catch (error) {
      this.logger.error('Webhook signature verification failed:', error);
      return false;
    }
  }

  /**
   * Parse webhook payload
   */
  parseWebhookPayload(body: any): {
    event: string;
    invoiceId: string;
    orderId: string;
    status: string;
    amount?: number;
    currency?: string;
  } | null {
    try {
      return {
        event: body.event,
        invoiceId: body.invoice_id || body.id,
        orderId: body.external_id || body.order_id,
        status: body.status,
        amount: body.amount,
        currency: body.currency,
      };
    } catch {
      return null;
    }
  }
}
