import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────────────
// Типы
// ─────────────────────────────────────────────────────────────

export interface AntilopaInvoice {
  id: string;           // payment_id из ответа
  orderId: string;      // наш order_id
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'expired' | 'cancelled' | 'failed';
  paymentUrl: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface CreateInvoiceDto {
  orderId: string;
  amount: number;
  currency?: string;
  description?: string;
  customerEmail?: string;
}

// ─────────────────────────────────────────────────────────────
// Сервис
// ─────────────────────────────────────────────────────────────

@Injectable()
export class PaymentsService implements OnModuleInit {
  private readonly logger = new Logger(PaymentsService.name);

  // Из кабинета AntilopaPay → Технические данные → Идентификатор проекта
  private readonly projectIdentificator: string;
  // Из кабинета → secret_id (X-Apay-Secret-Id)
  private readonly secretId: string;
  // Базовый URL API
  private readonly apiBase = 'https://lk.antilopay.com/api/v1';
  private readonly isProduction: boolean;

  /** Приватный RSA ключ магазина (PKCS#8 PEM) — для подписи исходящих запросов */
  private secretKeyPem: string | null = null;
  /** Публичный RSA ключ AntilopaPay — для верификации входящих callback'ов */
  private callbackPublicKeyPem: string | null = null;

  private readonly http: AxiosInstance;

  constructor(private readonly configService: ConfigService) {
    this.secretId = this.configService.get<string>('ANTILOPAPAY_SECRET_ID', '');
    this.projectIdentificator = this.configService.get<string>('ANTILOPAPAY_PROJECT_ID', '');
    this.isProduction = this.configService.get('NODE_ENV') === 'production';

    this.http = axios.create({
      baseURL: this.apiBase,
      timeout: 15_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  onModuleInit(): void {
    this.loadKeys();
  }

  // ─────────────────────────────────────────────────────────────
  // Загрузка ключей из файлов
  // ─────────────────────────────────────────────────────────────

  private loadKeys(): void {
    const secretKeyPath = this.configService.get<string>(
      'ANTILOPAPAY_SECRET_KEY_PEM_PATH',
      './secrets/antilopapay-secret.pem',
    );
    const callbackPubPath = this.configService.get<string>(
      'ANTILOPAPAY_SIGN_PUBLIC_KEY_PEM_PATH',
      './secrets/antilopapay-callback-pub.pem',
    );

    try {
      const resolved = path.resolve(process.cwd(), secretKeyPath);
      this.secretKeyPem = fs.readFileSync(resolved, 'utf8');
      this.logger.log('[AntilopaPay] Secret key loaded');
    } catch (err: any) {
      const msg = `[AntilopaPay] Cannot load secret key from ${secretKeyPath}: ${err.message}`;
      if (this.isProduction) throw new Error(msg);
      this.logger.warn(msg + ' — running in dev/mock mode');
    }

    try {
      const resolved = path.resolve(process.cwd(), callbackPubPath);
      this.callbackPublicKeyPem = fs.readFileSync(resolved, 'utf8');
      this.logger.log('[AntilopaPay] Callback public key loaded');
    } catch (err: any) {
      const msg = `[AntilopaPay] Cannot load callback public key from ${callbackPubPath}: ${err.message}`;
      if (this.isProduction) throw new Error(msg);
      this.logger.warn(msg + ' — signature verification will be skipped in dev');
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Подпись исходящих запросов (SHA256WithRSA)
  // Согласно документации: тело запроса как JSON-строка без лишних пробелов,
  // подпись передаётся в заголовке X-Apay-Sign
  // ─────────────────────────────────────────────────────────────

  private signBody(jsonString: string): string {
    if (!this.secretKeyPem) {
      throw new Error('[AntilopaPay] Secret key not loaded — cannot sign request');
    }
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(jsonString, 'utf8');
    return sign.sign(this.secretKeyPem, 'base64');
  }

  /**
   * Выполняет POST запрос к AntilopaPay API с правильными заголовками.
   * Согласно документации:
   * - Content-Type: application/json
   * - X-Apay-Secret-Id: идентификатор мерчанта
   * - X-Apay-Sign: подпись тела запроса
   * - X-Apay-Sign-Version: 1
   */
  private async apiPost<T = any>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    // JSON без лишних пробелов — именно так требует документация
    const jsonBody = JSON.stringify(body);
    const signature = this.signBody(jsonBody);

    const resp = await this.http.post<T>(endpoint, jsonBody, {
      headers: {
        'Content-Type': 'application/json',
        'X-Apay-Secret-Id': this.secretId,
        'X-Apay-Sign': signature,
        'X-Apay-Sign-Version': '1',
      },
    });

    return resp.data;
  }

  // ─────────────────────────────────────────────────────────────
  // Верификация подписи входящих callback'ов
  // Заголовок: X-Apay-Callback (подпись), X-Apay-Callback-Version (версия)
  // Подпись вычисляется по полному телу запроса
  // ─────────────────────────────────────────────────────────────

  verifyCallbackSignature(rawBody: string | Buffer, signature: string): boolean {
    if (!this.callbackPublicKeyPem) {
      if (this.isProduction) {
        this.logger.error('[AntilopaPay] Public key not loaded — rejecting callback');
        return false;
      }
      this.logger.warn('[AntilopaPay] Public key not loaded — skipping verification in dev');
      return true;
    }

    if (!signature) {
      this.logger.warn('[AntilopaPay] Missing X-Apay-Callback header');
      return false;
    }

    try {
      const verify = crypto.createVerify('RSA-SHA256');
      verify.update(rawBody);
      return verify.verify(this.callbackPublicKeyPem, signature, 'base64');
    } catch (err: any) {
      this.logger.error(`[AntilopaPay] Signature verification error: ${err.message}`);
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Создание платежа (payment/create)
  // Согласно документации раздел 5.1
  // ─────────────────────────────────────────────────────────────

  async createInvoice(data: CreateInvoiceDto): Promise<AntilopaInvoice> {
    if (!this.secretId || !this.secretKeyPem || !this.projectIdentificator) {
      this.logger.warn('[AntilopaPay] Not configured — returning mock invoice');
      return this.mockInvoice(data);
    }

    const baseUrl = this.configService.get<string>('BASE_URL', 'https://bag1v-bucks.shop');

    // Все обязательные поля согласно документации
    const body: Record<string, unknown> = {
      project_identificator: this.projectIdentificator,
      amount: data.amount,
      order_id: data.orderId,          // уникальный идентификатор на стороне мерчанта
      currency: 'RUB',                 // только RUB согласно документации
      product_name: 'V-Bucks Fortnite',
      product_type: 'goods',           // goods или services
      description: data.description || `Покупка V-Bucks — заказ ${data.orderId}`,
      success_url: `${baseUrl}/order/success?orderId=${data.orderId}`,
      fail_url: `${baseUrl}/order/cancel?orderId=${data.orderId}`,
      customer: {
        email: data.customerEmail || 'customer@bag1v-bucks.shop',
      },
    };

    try {
      const resp = await this.apiPost<{
        code: number;
        payment_id?: string;
        payment_url?: string;
        error?: string;
      }>('/payment/create', body);

      if (resp.code !== 0) {
        this.logger.error(`[AntilopaPay] createInvoice error code=${resp.code}: ${resp.error}`);
        if (!this.isProduction) return this.mockInvoice(data);
        throw new Error(`AntilopaPay error ${resp.code}: ${resp.error}`);
      }

      return {
        id: resp.payment_id!,
        orderId: data.orderId,
        amount: data.amount,
        currency: 'RUB',
        status: 'pending',
        paymentUrl: resp.payment_url!,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
      };
    } catch (err: any) {
      this.logger.error(`[AntilopaPay] createInvoice failed: ${err.message}`);
      if (!this.isProduction) return this.mockInvoice(data);
      throw err;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Проверка статуса платежа (payment/check)
  // Согласно документации раздел 5.2
  // ─────────────────────────────────────────────────────────────

  async checkInvoice(orderId: string): Promise<AntilopaInvoice | null> {
    if (!this.secretId || !this.secretKeyPem || !this.projectIdentificator) {
      return null;
    }

    try {
      const resp = await this.apiPost<{
        code: number;
        payment_id?: string;
        order_id?: string;
        payment_url?: string;
        status?: string;
        amount?: number;
        currency?: string;
        error?: string;
      }>('/payment/check', {
        project_identificator: this.projectIdentificator,
        order_id: orderId,
      });

      if (resp.code !== 0) {
        this.logger.warn(`[AntilopaPay] checkInvoice code=${resp.code}: ${resp.error}`);
        return null;
      }

      // Маппинг статусов AntilopaPay → наши статусы
      const statusMap: Record<string, AntilopaInvoice['status']> = {
        PENDING: 'pending',
        SUCCESS: 'paid',
        FAIL: 'failed',
        CANCEL: 'cancelled',
        EXPIRED: 'expired',
        CHARGEBACK: 'failed',
        REVERSED: 'cancelled',
      };

      return {
        id: resp.payment_id ?? '',
        orderId: resp.order_id ?? orderId,
        amount: resp.amount ?? 0,
        currency: resp.currency ?? 'RUB',
        status: statusMap[resp.status ?? ''] ?? 'pending',
        paymentUrl: resp.payment_url ?? '',
        createdAt: new Date(),
        expiresAt: new Date(),
      };
    } catch (err: any) {
      this.logger.error(`[AntilopaPay] checkInvoice failed: ${err.message}`);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Парсинг callback payload
  // Согласно документации раздел 10.6 — поле type='payment', order_id, status
  // ─────────────────────────────────────────────────────────────

  parseCallbackPayload(body: any): {
    type: string;
    paymentId: string;
    orderId: string;
    status: string;
    amount?: number;
    originalAmount?: number;
    currency?: string;
  } | null {
    try {
      if (!body || !body.type) return null;

      return {
        type: body.type,                          // 'payment', 'withdraw', 'refund', 'topup'
        paymentId: body.payment_id ?? '',
        orderId: body.order_id ?? '',             // наш orderId
        status: body.status ?? '',                // SUCCESS, FAIL, etc.
        amount: body.amount,
        originalAmount: body.original_amount,     // ВАЖНО: проверять совпадение с нашей суммой
        currency: body.currency,
      };
    } catch {
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Mock для dev-режима
  // ─────────────────────────────────────────────────────────────

  private mockInvoice(data: CreateInvoiceDto): AntilopaInvoice {
    const id = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const baseUrl = this.configService.get<string>('BASE_URL', 'http://localhost:3002');
    return {
      id,
      orderId: data.orderId,
      amount: data.amount,
      currency: 'RUB',
      status: 'pending',
      paymentUrl: `${baseUrl}/payment/mock?invoice=${id}&orderId=${data.orderId}`,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Legacy compat
  // ─────────────────────────────────────────────────────────────

  /** @deprecated use verifyCallbackSignature */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    return this.verifyCallbackSignature(payload, signature);
  }

  /** @deprecated use parseCallbackPayload */
  parseWebhookPayload(body: any) {
    return this.parseCallbackPayload(body);
  }
}
