import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class AuthService {
  private readonly epicClientId = process.env.EPIC_CLIENT_ID;
  
  // Epic Games Device Authorization URLs
  private readonly epicDeviceAuthUrl = 'https://graph.epicgames.com/device/authorization/authorize';
  private readonly epicTokenUrl = 'https://graph.epicgames.com/device/authorization/token';
  private readonly epicAccountsUrl = 'https://api.epicgames.com/epic-oauth/v1/accounts';

  /**
   * Initiate Epic Games Device Authorization Flow
   * https://dev.epicgames.com/docs/api-ref/device-authorization-flow
   * 
   * Returns a user_code (8 characters) that user enters at epicgames.com/activate
   */
  async initiateDeviceAuth(): Promise<{
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete: string;
    interval: number;
    expiresIn: number;
  }> {
    if (!this.epicClientId) {
      throw new Error('EPIC_CLIENT_ID is not configured');
    }

    const response = await axios.post(
      this.epicDeviceAuthUrl,
      new URLSearchParams({
        client_id: this.epicClientId,
        scope: 'basic_profile friends_list openid',
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    return {
      deviceCode: response.data.device_code,
      userCode: response.data.user_code,
      verificationUri: response.data.verification_uri,
      verificationUriComplete: response.data.verification_uri_complete,
      interval: response.data.interval,
      expiresIn: response.data.expires_in,
    };
  }

  /**
   * Poll Epic Games to check if device authorization is complete
   * Should be called every `interval` seconds
   */
  async pollForAuth(deviceCode: string): Promise<{
    authenticated: boolean;
    accessToken?: string;
    refreshToken?: string;
    exchangeCode?: string;
    error?: string;
  }> {
    if (!this.epicClientId) {
      return { authenticated: false, error: 'not_configured' };
    }

    try {
      const response = await axios.post(
        this.epicTokenUrl,
        new URLSearchParams({
          client_id: this.epicClientId,
          grant_type: 'device_code',
          device_code: deviceCode,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      return {
        authenticated: true,
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        exchangeCode: response.data.exchange_code,
      };
    } catch (error: any) {
      const errorCode = error.response?.data?.error;
      
      // authorization_pending = пользователь ещё не подтвердил
      if (errorCode === 'authorization_pending') {
        return { authenticated: false, error: 'pending' };
      }
      
      // slow_down = слишком частые запросы
      if (errorCode === 'slow_down') {
        return { authenticated: false, error: 'slow_down' };
      }

      // expired_token = код истёк
      if (errorCode === 'expired_token') {
        return { authenticated: false, error: 'expired' };
      }

      // access_denied = пользователь отклонил
      if (errorCode === 'access_denied') {
        return { authenticated: false, error: 'denied' };
      }

      throw error;
    }
  }

  /**
   * Get Epic account info using access token
   */
  async getEpicAccount(token: string): Promise<{
    id: string;
    displayName: string;
    email?: string;
  }> {
    try {
      const response = await axios.get(this.epicAccountsUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
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
   * Refresh access token using refresh token
   */
  async refreshToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    if (!this.epicClientId) {
      throw new Error('EPIC_CLIENT_ID is not configured');
    }

    const response = await axios.post(
      this.epicTokenUrl,
      new URLSearchParams({
        client_id: this.epicClientId,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
    };
  }
}
