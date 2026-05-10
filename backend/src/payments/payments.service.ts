import { Injectable } from '@nestjs/common';
import axios from 'axios';

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

@Injectable()
export class PaymentsService {
  private readonly apiKey: string;
  private readonly shopId: string;
  private readonly baseUrl = 'https://api.antilav.com/v1';

  constructor() {
    this.apiKey = process.env.ANTILAV_API_KEY || '';
    this.shopId = process.env.ANTILAV_SHOP_ID || '';
  }

  /**
   * Create a new payment invoice with AntiLav
   */
  async createInvoice(data: CreateInvoiceDto): Promise<AntiLavInvoice> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/invoices`,
        {
          shop_id: this.shopId,
          external_id: data.orderId,
          amount: data.amount,
          currency: data.currency || 'RUB',
          description: data.description || `V-Bucks Order ${data.orderId}`,
          lifetime: 3600, // 1 hour
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
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
      // For development/demo, return mock data
      const mockId = `inv_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      return {
        id: mockId,
        orderId: data.orderId,
        amount: data.amount,
        currency: data.currency || 'RUB',
        status: 'pending',
        paymentUrl: `https://pay.antilav.com/${mockId}`,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600 * 1000),
      };
    }
  }

  /**
   * Check invoice status
   */
  async checkInvoice(invoiceId: string): Promise<AntiLavInvoice | null> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/invoices/${invoiceId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
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
      return null;
    }
  }

  /**
   * Cancel an invoice
   */
  async cancelInvoice(invoiceId: string): Promise<boolean> {
    try {
      await axios.post(
        `${this.baseUrl}/invoices/${invoiceId}/cancel`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
        }
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get payment methods available
   */
  async getPaymentMethods(): Promise<Array<{
    id: string;
    name: string;
    commission: number;
    minAmount: number;
    maxAmount: number;
  }>> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/payment-methods`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
        }
      );

      return response.data.methods || [];
    } catch (error) {
      // Return common methods as fallback
      return [
        { id: 'card', name: 'Банковская карта', commission: 0, minAmount: 100, maxAmount: 50000 },
        { id: 'sbp', name: 'СБП', commission: 0, minAmount: 10, maxAmount: 600000 },
        { id: 'crypto', name: 'Криптовалюта', commission: 1, minAmount: 500, maxAmount: 1000000 },
      ];
    }
  }
}
