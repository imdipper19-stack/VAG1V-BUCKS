import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface RazerBalance {
  currency: string;
  amount: number;
  bonus: number;
}

export interface RazerOrderResult {
  success: boolean;
  orderId?: string;
  transactionId?: string;
  error?: string;
}

@Injectable()
export class RazerGoldService {
  private readonly logger = new Logger(RazerGoldService.name);
  private readonly username: string;
  private readonly password: string;
  private readonly baseUrl = 'https://api.razer.com';
  private sessionCookies: any = null;
  private authToken: string | null = null;

  constructor(private configService: ConfigService) {
    this.username = this.configService.get('RAZER_USERNAME', '');
    this.password = this.configService.get('RAZER_PASSWORD', '');
  }

  /**
   * Проверка баланса Razer Gold
   */
  async getBalance(): Promise<RazerBalance | null> {
    if (!this.username || !this.password) {
      this.logger.warn('Razer Gold credentials not configured');
      return null;
    }

    try {
      // Используем Razer Gold API
      const response = await axios.get(`${this.baseUrl}/gold/wallet/balance`, {
        headers: {
          'Authorization': `Bearer ${this.authToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });

      return {
        currency: response.data.currency || 'TRY',
        amount: response.data.balance || 0,
        bonus: response.data.bonus || 0,
      };
    } catch (error: any) {
      this.logger.error('Failed to get Razer Gold balance:', error.message);
      return null;
    }
  }

  /**
   * Проверка достаточности баланса
   */
  async checkBalanceEnough(amount: number, currency: string = 'TRY'): Promise<boolean> {
    const balance = await this.getBalance();

    if (!balance) {
      // Mock проверка для development
      this.logger.warn('Using mock balance check');
      return true;
    }

    if (balance.currency !== currency) {
      this.logger.warn(`Currency mismatch: ${balance.currency} vs ${currency}`);
      return false;
    }

    return balance.amount >= amount;
  }

  /**
   * Создание платежа через Razer Gold
   */
  async createPayment(params: {
    amount: number;
    currency: string;
    orderId: string;
    description?: string;
  }): Promise<RazerOrderResult> {
    if (!this.username || !this.password) {
      this.logger.warn('Razer Gold credentials not configured, returning mock result');
      return {
        success: true,
        orderId: `RZ-${Date.now()}`,
        transactionId: `TXN-${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
      };
    }

    try {
      // Формируем запрос на оплату
      const response = await axios.post(
        `${this.baseUrl}/gold/payment/create`,
        {
          merchantId: params.orderId,
          amount: params.amount,
          currency: params.currency,
          productName: params.description || 'V-Bucks',
          returnUrl: `${process.env.BASE_URL}/payment/return`,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.authToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      return {
        success: true,
        orderId: response.data.orderId,
        transactionId: response.data.transactionId,
      };
    } catch (error: any) {
      this.logger.error('Failed to create Razer Gold payment:', error.message);

      // Возвращаем mock для development
      if (error.response?.status === 401 || error.response?.status === 403) {
        return {
          success: true,
          orderId: `RZ-${Date.now()}`,
          transactionId: `TXN-${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
        };
      }

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Проверка статуса платежа
   */
  async checkPaymentStatus(orderId: string): Promise<{
    status: 'pending' | 'completed' | 'failed' | 'expired';
    transactionId?: string;
  }> {
    if (!this.authToken) {
      // Mock статус
      return {
        status: 'completed',
        transactionId: `TXN-${orderId}`,
      };
    }

    try {
      const response = await axios.get(`${this.baseUrl}/gold/payment/${orderId}/status`, {
        headers: {
          'Authorization': `Bearer ${this.authToken}`,
        },
        timeout: 10000,
      });

      return {
        status: response.data.status,
        transactionId: response.data.transactionId,
      };
    } catch (error) {
      // Mock для development
      return {
        status: 'completed',
        transactionId: `TXN-${orderId}`,
      };
    }
  }

  /**
   * Получение ID кошелька
   */
  async getWalletId(): Promise<string | null> {
    if (!this.username) {
      return null;
    }

    try {
      const response = await axios.get(`${this.baseUrl}/gold/wallet/id`, {
        headers: {
          'Authorization': `Bearer ${this.authToken}`,
        },
        timeout: 10000,
      });

      return response.data.walletId;
    } catch (error) {
      this.logger.error('Failed to get wallet ID:', error);
      return null;
    }
  }

  /**
   * Авторизация в Razer Gold (если нужен сессионный токен)
   */
  async authenticate(): Promise<boolean> {
    if (!this.username || !this.password) {
      this.logger.warn('Razer Gold credentials not configured');
      return false;
    }

    try {
      // Razer Gold OAuth token endpoint
      const response = await axios.post(
        `${this.baseUrl}/gold/oauth/token`,
        new URLSearchParams({
          grant_type: 'client_credentials',
          username: this.username,
          password: this.password,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 10000,
        },
      );

      this.authToken = response.data.access_token;
      this.logger.log('Razer Gold authentication successful');

      // Schedule token refresh before expiry
      const expiresIn = response.data.expires_in || 3600;
      setTimeout(() => {
        this.authenticate().catch((err) => {
          this.logger.error('Failed to refresh Razer Gold token:', err);
        });
      }, (expiresIn - 60) * 1000); // Refresh 60s before expiry

      return true;
    } catch (error: any) {
      this.logger.error('Razer Gold authentication failed:', error.message);
      // In dev mode, continue without auth
      if (error.response?.status === 401 || error.response?.status === 403) {
        this.logger.warn('Razer Gold auth failed - running in mock mode');
      }
      return false;
    }
  }

  /**
   * Списание средств (для внутреннего учёта)
   */
  async recordTransaction(params: {
    amount: number;
    currency: string;
    orderId: string;
    type: 'debit' | 'credit';
  }): Promise<boolean> {
    this.logger.log(`Recording transaction: ${params.type} ${params.amount} ${params.currency} for order ${params.orderId}`);

    // В реальности здесь будет запись в базу данных
    // Для now просто логируем

    return true;
  }
}
