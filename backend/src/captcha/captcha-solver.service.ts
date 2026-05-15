import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

/**
 * Сервис решения hCaptcha через 2Captcha API.
 *
 * Документация: https://2captcha.com/api-docs/hcaptcha
 *
 * Флоу:
 * 1. POST /in.php — отправляем задачу, получаем taskId
 * 2. Polling GET /res.php?action=get&id=taskId — ждём решения (обычно 10-30 сек)
 * 3. Возвращаем токен — вставляем в форму как h-captcha-response
 */
@Injectable()
export class CaptchaSolverService {
  private readonly logger = new Logger(CaptchaSolverService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://2captcha.com';

  // sitekey hCaptcha на Epic Games checkout (из HAR-анализа)
  static readonly EPIC_HCAPTCHA_SITEKEY = 'ac9ac202-910c-4a3c-bf0c-b6a637587360';

  constructor() {
    this.apiKey = process.env.TWOCAPTCHA_API_KEY || '';
    if (!this.apiKey) {
      this.logger.warn('TWOCAPTCHA_API_KEY not set — captcha solving will fail');
    }
  }

  /**
   * Решить hCaptcha и вернуть токен.
   * @param sitekey  — sitekey с целевой страницы
   * @param pageUrl  — URL страницы где стоит капча
   * @param userAgent — User-Agent браузера (важно для Enterprise hCaptcha)
   * @returns токен для вставки в h-captcha-response
   */
  async solveHCaptcha(
    sitekey: string,
    pageUrl: string,
    userAgent?: string,
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error('2Captcha API key not configured (TWOCAPTCHA_API_KEY)');
    }

    this.logger.log(`Submitting hCaptcha task: sitekey=${sitekey}, url=${pageUrl}`);

    // 1. Отправляем задачу
    const submitParams: Record<string, string> = {
      key: this.apiKey,
      method: 'hcaptcha',
      sitekey,
      pageurl: pageUrl,
      json: '1',
    };

    if (userAgent) {
      submitParams.userAgent = userAgent;
    }

    const submitResponse = await axios.post(
      `${this.baseUrl}/in.php`,
      new URLSearchParams(submitParams),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15_000,
      },
    );

    if (submitResponse.data.status !== 1) {
      throw new Error(`2Captcha submit failed: ${submitResponse.data.error_text || JSON.stringify(submitResponse.data)}`);
    }

    const taskId = submitResponse.data.request;
    this.logger.log(`hCaptcha task submitted, id=${taskId}. Waiting for solution...`);

    // 2. Polling — ждём решения
    const token = await this.pollForResult(taskId);
    this.logger.log(`hCaptcha solved successfully (id=${taskId})`);
    return token;
  }

  /**
   * Проверить баланс 2Captcha аккаунта.
   */
  async getBalance(): Promise<number> {
    if (!this.apiKey) return 0;

    try {
      const response = await axios.get(`${this.baseUrl}/res.php`, {
        params: {
          key: this.apiKey,
          action: 'getbalance',
          json: '1',
        },
        timeout: 10_000,
      });

      if (response.data.status === 1) {
        return parseFloat(response.data.request);
      }
      return 0;
    } catch {
      return 0;
    }
  }

  /**
   * Проверить что API ключ валиден.
   */
  async isConfigured(): Promise<boolean> {
    if (!this.apiKey) return false;
    const balance = await this.getBalance();
    return balance > 0;
  }

  // ---------- private ----------

  private async pollForResult(
    taskId: string,
    maxAttempts = 40,
    intervalMs = 5_000,
  ): Promise<string> {
    // Первый запрос не раньше чем через 10 сек (2Captcha рекомендует)
    await this.sleep(10_000);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await axios.get(`${this.baseUrl}/res.php`, {
          params: {
            key: this.apiKey,
            action: 'get',
            id: taskId,
            json: '1',
          },
          timeout: 10_000,
        });

        if (response.data.status === 1) {
          return response.data.request;
        }

        if (response.data.request === 'CAPCHA_NOT_READY') {
          this.logger.debug(`hCaptcha not ready yet (attempt ${attempt + 1}/${maxAttempts})`);
          await this.sleep(intervalMs);
          continue;
        }

        // Ошибка от 2Captcha
        throw new Error(`2Captcha error: ${response.data.error_text || response.data.request}`);
      } catch (err: any) {
        if (err.message.startsWith('2Captcha error:')) throw err;
        this.logger.warn(`Poll attempt ${attempt + 1} failed: ${err.message}`);
        await this.sleep(intervalMs);
      }
    }

    throw new Error(`2Captcha: timeout after ${maxAttempts} polling attempts`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
