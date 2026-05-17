/**
 * EpicAuthService — OAuth 2.0 Device Authorization Grant flow для Epic Games.
 *
 * Использует публично известные credentials мобильного Fortnite-клиента
 * (зашиты в приложение Fortnite, документированы в EpicResearch).
 * Это позволяет авторизовать пользователей без собственного зарегистрированного
 * Epic OAuth-приложения.
 *
 * Flow:
 *   1. POST /auth/start    → backend hits deviceAuthorization → возвращает user_code (e.g. "JXQ7R8I")
 *   2. Frontend показывает user_code + ссылку на epicgames.com/activate
 *   3. POST /auth/poll     → backend hits token endpoint → возвращает access_token когда юзер подтвердил
 *
 * Stateless: device_code хранится у фронтенда, не у нас.
 */

import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';

const EPIC_OAUTH_BASE = 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth';

// Switch client — единственный публичный клиент с правом device_code grant.
// Используется только для шага юзер-авторизации; для дальнейших API-вызовов
// мы переобмениваем токен на Fortnite Mobile клиент через grant_type=exchange_code.
const SWITCH_CLIENT_ID = '98f7e42c2e3a4f86a74eb43fbb41ed39';
const SWITCH_CLIENT_SECRET = '0a2449a2-001a-451e-afec-3e812901c4d7';

// Fortnite Mobile client — даёт сессию на store.epicgames.com при /id/exchange.
// Switch-клиент 403 на /id/exchange, поэтому переобмениваем токен.
const FORTNITE_CLIENT_ID = '3f69e56c7649492c8cc29f1af08a8a12';
const FORTNITE_CLIENT_SECRET = 'b51ee9cb12234f50a69efa67ef53812e';

export interface DeviceCodeStartResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export type DeviceCodePollResponse =
  | { status: 'pending' }
  | { status: 'expired'; error: string }
  | { status: 'error'; error: string }
  | {
      status: 'authorized';
      accessToken: string;
      refreshToken: string;
      accessTokenExpiresAt: number;
      refreshTokenExpiresAt: number;
      accountId: string;
      displayName: string;
    };

@Injectable()
export class EpicAuthService {
  private readonly logger = new Logger(EpicAuthService.name);

  private get basicAuth(): string {
    return Buffer.from(`${SWITCH_CLIENT_ID}:${SWITCH_CLIENT_SECRET}`).toString('base64');
  }

  private get fortniteBasicAuth(): string {
    return Buffer.from(`${FORTNITE_CLIENT_ID}:${FORTNITE_CLIENT_SECRET}`).toString('base64');
  }

  /**
   * Переобмен Switch access_token на Fortnite Mobile access_token.
   *
   * Switch-клиент имеет право device_code, но НЕ даёт сессию на store.epicgames.com
   * (`/id/exchange?exchangeCode=...` → 403). Fortnite Mobile наоборот — без device_code,
   * но даёт нормальную сессию.
   *
   * Делаем мост: Switch token → /exchange → exchange_code (привязан к юзеру) →
   * grant_type=exchange_code с Fortnite-creds → новый access_token уже Fortnite Mobile клиента.
   */
  private async exchangeSwitchTokenToFortnite(switchAccessToken: string): Promise<string> {
    // 1. Получаем exchange_code (он привязан к юзеру, не к клиенту)
    const exResp = await axios.get(`${EPIC_OAUTH_BASE}/exchange`, {
      headers: { Authorization: `Bearer ${switchAccessToken}` },
      timeout: 10000,
    });
    const exchangeCode: string | undefined = exResp.data?.code;
    if (!exchangeCode) {
      throw new Error('Switch token did not yield exchange code');
    }

    // 2. Обменяем на Fortnite Mobile access_token
    const tokResp = await axios.post(
      `${EPIC_OAUTH_BASE}/token`,
      `grant_type=exchange_code&exchange_code=${exchangeCode}`,
      {
        headers: {
          Authorization: `Basic ${this.fortniteBasicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        timeout: 10000,
      },
    );

    if (!tokResp.data?.access_token) {
      throw new Error(`Fortnite token swap failed: ${JSON.stringify(tokResp.data).substring(0, 200)}`);
    }
    this.logger.log(`[EpicAuth] Switch → Fortnite Mobile token bridged for ${tokResp.data.displayName}`);
    return tokResp.data.access_token;
  }

  /**
   * Получает client_credentials access_token — это серверный токен самого нашего клиента,
   * не привязанный к юзеру. Нужен только для вызова deviceAuthorization (Epic требует
   * Bearer + client_id, а не Basic + secret для этого эндпоинта).
   */
  private async getClientCredentialsToken(): Promise<string> {
    const resp = await axios.post(
      `${EPIC_OAUTH_BASE}/token`,
      'grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${this.basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        timeout: 10000,
      },
    );
    return resp.data.access_token;
  }

  /**
   * Шаг 1: Инициируем device authorization у Epic.
   * Юзер увидит userCode (7 символов) и пойдёт на epicgames.com/activate.
   */
  async startDeviceCodeFlow(): Promise<DeviceCodeStartResponse> {
    // Epic требует client_credentials Bearer для этого endpoint, не Basic
    const clientToken = await this.getClientCredentialsToken();

    const resp = await axios.post(
      `${EPIC_OAUTH_BASE}/deviceAuthorization`,
      '',
      {
        headers: {
          Authorization: `Bearer ${clientToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        timeout: 10000,
        validateStatus: () => true,
      },
    );

    if (resp.status >= 400) {
      this.logger.error(`[EpicAuth] deviceAuthorization ${resp.status}: ${JSON.stringify(resp.data)}`);
      throw new Error(`deviceAuthorization failed: ${resp.status} ${JSON.stringify(resp.data)}`);
    }

    const data = resp.data;
    this.logger.log(`[EpicAuth] Device code issued: user_code=${data.user_code}`);

    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      verificationUriComplete: data.verification_uri_complete,
      expiresIn: data.expires_in,
      interval: data.interval || 5,
    };
  }

  /**
   * Шаг 2: Поллим Epic с device_code.
   * До тех пор пока юзер не активировал — Epic возвращает 400 с errorCode "authorization_pending".
   * После активации — 200 с access_token + refresh_token.
   */
  async pollDeviceCode(deviceCode: string): Promise<DeviceCodePollResponse> {
    try {
      const resp = await axios.post(
        `${EPIC_OAUTH_BASE}/token`,
        `grant_type=device_code&device_code=${encodeURIComponent(deviceCode)}`,
        {
          headers: {
            Authorization: `Basic ${this.basicAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          timeout: 10000,
        },
      );

      const d = resp.data;
      const now = Date.now();

      this.logger.log(`[EpicAuth] Device code authorized: ${d.displayName} (${d.account_id})`);

      // Switch-токен не даёт сессию на store.epicgames.com — переобмениваем на Fortnite Mobile
      const fortniteAccessToken = await this.exchangeSwitchTokenToFortnite(d.access_token);

      return {
        status: 'authorized',
        accessToken: fortniteAccessToken,
        refreshToken: d.refresh_token, // Switch refresh — на случай повторной авторизации
        accessTokenExpiresAt: now + (d.expires_in || 7200) * 1000,
        refreshTokenExpiresAt: now + (d.refresh_expires || 86400 * 30) * 1000,
        accountId: d.account_id,
        displayName: d.displayName,
      };
    } catch (err) {
      const ax = err as AxiosError<any>;
      const errorCode: string = ax?.response?.data?.errorCode || '';

      if (errorCode.includes('authorization_pending')) {
        return { status: 'pending' };
      }
      if (errorCode.includes('expired') || errorCode.includes('slow_down')) {
        return { status: 'expired', error: errorCode };
      }
      const msg = ax?.response?.data?.errorMessage || ax?.message || 'unknown';
      this.logger.warn(`[EpicAuth] Poll error: ${errorCode || msg}`);
      return { status: 'error', error: errorCode || msg };
    }
  }

  /**
   * Шаг 3 (на будущее): обновить access_token через refresh_token.
   * refresh_token живёт ~30 дней, access_token ~2 часа.
   */
  async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: number;
    refreshTokenExpiresAt: number;
  }> {
    const resp = await axios.post(
      `${EPIC_OAUTH_BASE}/token`,
      `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
      {
        headers: {
          Authorization: `Basic ${this.basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        timeout: 10000,
      },
    );

    const d = resp.data;
    const now = Date.now();
    return {
      accessToken: d.access_token,
      refreshToken: d.refresh_token,
      accessTokenExpiresAt: now + (d.expires_in || 7200) * 1000,
      refreshTokenExpiresAt: now + (d.refresh_expires || 86400 * 30) * 1000,
    };
  }
}
