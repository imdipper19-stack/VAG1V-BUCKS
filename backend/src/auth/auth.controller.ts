import { Controller, Post, Body, HttpCode, HttpStatus, HttpException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { OrdersService, Order } from '../orders/orders.service';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private ordersService: OrdersService,
  ) {}

  /**
   * POST /api/auth/initiate
   * Начинает процесс авторизации Epic Games Device Flow
   * Возвращает 8-символьный код подтверждения
   */
  @Post('initiate')
  @HttpCode(HttpStatus.OK)
  async initiateAuth(@Body() body: { orderId: string }) {
    const { orderId } = body;

    let order: Order | undefined;
    try {
      order = await this.ordersService.findById(orderId);
    } catch {
      throw new HttpException('Order not found', 404);
    }

    // Проверяем, есть ли уже активный код
    if (order.epicDeviceCode && order.epicDeviceCodeExpiresAt) {
      const expiresAt = new Date(order.epicDeviceCodeExpiresAt);
      if (expiresAt > new Date()) {
        return {
          success: true,
          data: {
            deviceCode: order.epicDeviceCode,
            userCode: order.epicUserCode || order.epicDeviceCode,
            verificationUri: 'https://www.epicgames.com/activate',
            interval: 5,
            expiresAt: expiresAt,
          },
        };
      }
    }

    // Создаём новый код авторизации через Epic Games API
    const authData = await this.authService.initiateDeviceAuth();

    // Сохраняем в заказ
    await this.ordersService.updateStatus(orderId, order.status, {
      epicDeviceCode: authData.deviceCode,
      epicUserCode: authData.userCode,
      epicDeviceCodeExpiresAt: new Date(Date.now() + authData.expiresIn * 1000),
    });

    return {
      success: true,
      data: {
        deviceCode: authData.deviceCode,
        userCode: authData.userCode,
        verificationUri: authData.verificationUriComplete || authData.verificationUri,
        interval: authData.interval,
        expiresAt: new Date(Date.now() + authData.expiresIn * 1000),
      },
    };
  }

  /**
   * POST /api/auth/poll
   * Проверяет, подтвердил ли пользователь авторизацию
   * Нужно вызывать каждые interval секунд
   */
  @Post('poll')
  @HttpCode(HttpStatus.OK)
  async pollAuth(@Body() body: { orderId: string }) {
    const { orderId } = body;

    let order: Order | undefined;
    try {
      order = await this.ordersService.findById(orderId);
    } catch {
      throw new HttpException('Order not found', 404);
    }

    if (!order.epicDeviceCode) {
      throw new HttpException('No device code found for this order', 400);
    }

    // Проверяем, не истёк ли код
    if (order.epicDeviceCodeExpiresAt && new Date() > new Date(order.epicDeviceCodeExpiresAt)) {
      return {
        success: false,
        error: 'Code expired',
        expired: true,
      };
    }

    const authResult = await this.authService.pollForAuth(order.epicDeviceCode);

    if (authResult.authenticated) {
      // Успех! Сохраняем токены
      await this.ordersService.updateStatus(orderId, order.status, {
        epicAccessToken: authResult.accessToken,
        epicRefreshToken: authResult.refreshToken,
        epicExchangeCode: authResult.exchangeCode,
      });

      await this.ordersService.addTimelineLog(orderId, {
        tag: '[auth]',
        message: 'Device code verified',
        status: 'success',
      });

      await this.ordersService.addTimelineLog(orderId, {
        tag: '[auth]',
        message: 'Session established',
        status: 'success',
      });
    }

    return {
      success: true,
      data: {
        authenticated: authResult.authenticated,
        exchangeCode: authResult.exchangeCode,
        error: authResult.error,
      },
    };
  }

  /**
   * POST /api/auth/verify
   * Получает информацию об аккаунте Epic
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verifyAccount(@Body() body: { exchangeCode: string }) {
    const account = await this.authService.getEpicAccount(body.exchangeCode);

    return {
      success: true,
      data: {
        accountId: account.id,
        displayName: account.displayName,
      },
    };
  }
}
