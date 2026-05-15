import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly epicClientId = process.env.EPIC_CLIENT_ID;
  private readonly epicClientSecret = process.env.EPIC_CLIENT_SECRET;

  // Epic Games API endpoints
  private readonly epicTokenUrl = 'https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token';
  private readonly epicAccountsUrl = 'https://account-public-service-prod03.ol.epicgames.com/account/api/public/account';
  private readonly epicExchangeUrl = 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/exchange';

  /** Basic Auth header: base64(clientId:clientSecret) */
  private get basicAuthHeader(): string {
    const credentials = `${this.epicClientId}:${this.epicClientSecret}`;
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
  }

  /**
   * Build login URL for user to visit in browser.
   * After login, Epic will show a page with authorizationCode in JSON response.
   */
  getAuthorizationUrl(): string {
    return `https://www.epicgames.com/id/login?redirectUrl=https%3A%2F%2Fwww.epicgames.com%2Fid%2Fapi%2Fredirect%3FclientId%3D${this.epicClientId}%26responseType%3Dcode`;
  }

  /**
   * Direct URL to authorization code page (if user is already logged in).
   */
  getAuthorizationCodeUrl(): string {
    return `https://www.epicgames.com/id/api/redirect?clientId=${this.epicClientId}&responseType=code`;
  }

  /**
   * Exchange one-time authorization code for access/refresh tokens.
   * This is the main auth method — user pastes code from Epic page, we get tokens.
   */
  async exchangeAuthorizationCode(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    accountId: string;
    displayName: string;
    expiresIn: number;
  }> {
    if (!this.epicClientId) throw new Error('EPIC_CLIENT_ID is not configured');

    try {
      const response = await axios.post(
        this.epicTokenUrl,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: code.trim(),
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': this.basicAuthHeader,
          },
          timeout: 15000,
        },
      );

      this.logger.log(`Authorization code exchanged successfully for account: ${response.data.displayName}`);

      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        accountId: response.data.account_id,
        displayName: response.data.displayName || 'unknown',
        expiresIn: response.data.expires_in,
      };
    } catch (err: any) {
      const errData = err.response?.data;
      this.logger.error(`Auth code exchange failed: ${err.response?.status} — ${JSON.stringify(errData)}`);

      // Специализированные ошибки
      if (errData?.errorCode?.includes('authentication_failed') ||
          errData?.error === 'invalid_grant') {
        throw new Error('Код недействителен или уже использован. Получите новый код.');
      }
      throw new Error('Ошибка обмена кода. Проверьте что код введён правильно.');
    }
  }

  /**
   * Проверяет регион аккаунта и меняет на Турцию если нужно.
   * Возвращает true если регион уже был TR или успешно изменён.
   */
  async ensureTurkishRegion(accessToken: string): Promise<{
    changed: boolean;
    previousCountry?: string;
  }> {
    const accountInfoUrl = 'https://account-public-service-prod03.ol.epicgames.com/account/api/public/account/me';
    const updateCountryUrl = 'https://account-public-service-prod03.ol.epicgames.com/account/api/public/account/me';

    try {
      // Получаем текущий регион аккаунта
      const infoResponse = await axios.get(accountInfoUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000,
      });

      const currentCountry = infoResponse.data?.country;
      this.logger.log(`Account country: ${currentCountry}`);

      if (currentCountry === 'TR') {
        return { changed: false, previousCountry: 'TR' };
      }

      // Меняем регион на Турцию
      await axios.patch(
        updateCountryUrl,
        { country: 'TR' },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        },
      );

      this.logger.log(`Region changed from ${currentCountry} to TR`);
      return { changed: true, previousCountry: currentCountry };
    } catch (error: any) {
      this.logger.warn(`Failed to change region: ${error.message}`);
      // Не бросаем ошибку — продолжаем даже если смена региона не удалась
      return { changed: false };
    }
  }

  /**
   * Get Epic account info using access token.
   */
  async getEpicAccount(token: string): Promise<{
    id: string;
    displayName: string;
    email?: string;
  }> {
    try {
      const response = await axios.get(this.epicAccountsUrl, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000,
      });

      return {
        id: response.data.id,
        displayName: response.data.displayName,
        email: response.data.email,
      };
    } catch (error) {
      throw new Error('Failed to get Epic account');
    }
  }

  /**
   * Get fresh exchange_code from access_token.
   * exchange_code is short-lived (~5 min) for one-time browser login.
   */
  async getExchangeCode(accessToken: string): Promise<string> {
    try {
      const response = await axios.get(this.epicExchangeUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000,
      });

      const code = response.data?.code;
      if (!code) throw new Error('Exchange code missing in response');
      return code;
    } catch (error: any) {
      this.logger.error(`Failed to get exchange code: ${error.message}`);
      throw new Error('Failed to obtain Epic exchange code');
    }
  }

  /**
   * Refresh access token using refresh token.
   */
  async refreshToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    if (!this.epicClientId) throw new Error('EPIC_CLIENT_ID is not configured');

    const response = await axios.post(
      this.epicTokenUrl,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': this.basicAuthHeader,
        },
        timeout: 15000,
      },
    );

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
    };
  }
}
