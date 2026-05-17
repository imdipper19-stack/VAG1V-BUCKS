import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { OrdersService } from '../orders/orders.service';
import { QueueService } from '../queue/queue.service';
import { Order, OrderStatusEnum, LogLevel } from '../database/entities';
import { EpicAuthService } from '../api-purchase/epic-auth.service';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private ordersService: OrdersService,
    private queueService: QueueService,
    private epicAuthService: EpicAuthService,
  ) {}

  /**
   * GET /api/auth/login-url
   * Возвращает URL на который нужно отправить покупателя для логина в Epic.
   * После логина Epic покажет JSON с полем authorizationCode, которое покупатель копирует и вставляет.
   */
  @Get('login-url')
  getLoginUrl() {
    return {
      success: true,
      data: {
        loginUrl: this.authService.getAuthorizationUrl(),
        codeUrl: this.authService.getAuthorizationCodeUrl(),
      },
    };
  }

  /**
   * POST /api/auth/submit-code
   * Покупатель прислал authorization code — обмениваем на токены и продолжаем обработку.
   */
  @Post('submit-code')
  @HttpCode(HttpStatus.OK)
  async submitCode(@Body() body: { orderId: string; code: string }) {
    const { orderId, code } = body;

    if (!code || code.trim().length < 10) {
      throw new HttpException('Invalid code', HttpStatus.BAD_REQUEST);
    }

    let order: Order;
    try {
      order = await this.ordersService.findByOrderId(orderId);
    } catch {
      throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    }

    // Принимаем заказы в статусе PENDING или AWAITING_AUTH
    if (
      order.status !== OrderStatusEnum.PENDING &&
      order.status !== OrderStatusEnum.AWAITING_AUTH
    ) {
      throw new HttpException(
        `Invalid order status: ${order.status}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      // Обмениваем код на токены
      const auth = await this.authService.exchangeAuthorizationCode(code);

      // Сохраняем токены в заказе
      await this.ordersService.updateStatus(
        order.id,
        OrderStatusEnum.AUTH_COMPLETED,
        {
          epicAccessToken: auth.accessToken,
          epicRefreshToken: auth.refreshToken,
          epicAccountId: auth.accountId,
          epicDisplayName: auth.displayName,
        },
      );

      await this.ordersService.addTimelineLog(order.id, {
        tag: '[auth]',
        message: `Authorized as ${auth.displayName}`,
        level: LogLevel.SUCCESS,
      });

      // Добавляем в очередь обработки
      await this.queueService.queueOrderForProcessing(order.orderId);

      await this.ordersService.addTimelineLog(order.id, {
        tag: '[system]',
        message: 'Order queued for processing',
        level: LogLevel.INFO,
      });

      return {
        success: true,
        data: {
          displayName: auth.displayName,
          accountId: auth.accountId,
        },
      };
    } catch (err: any) {
      await this.ordersService.addTimelineLog(order.id, {
        tag: '[auth]',
        message: `Auth failed: ${err.message}`,
        level: LogLevel.ERROR,
      });

      throw new HttpException(
        err.message || 'Authorization failed',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * POST /api/auth/region-code
   * Покупатель прислал код подтверждения смены региона из email.
   * OrderProcessingService ждёт этот код чтобы завершить смену региона.
   */
  @Post('region-code')
  @HttpCode(HttpStatus.OK)
  async submitRegionCode(@Body() body: { orderId: string; code: string }) {
    const { orderId, code } = body;

    if (!code || code.trim().length < 4) {
      throw new HttpException('Invalid code', HttpStatus.BAD_REQUEST);
    }

    let order: Order;
    try {
      order = await this.ordersService.findByOrderId(orderId);
    } catch {
      throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    }

    // Сохраняем код с префиксом REGION: — OrderProcessingService его подхватит
    await this.ordersService.updateOrder(order.id, {
      epicUserCode: `REGION:${code.trim()}`,
    });

    return {
      success: true,
      data: { message: 'Region confirmation code received' },
    };
  }

  /**
   * POST /api/auth/device/start
   * Начинает Epic OAuth Device Authorization Flow.
   * Возвращает userCode (типа JXQ7R8I) и ссылку на epicgames.com/activate.
   * Покупатель вбивает код у Epic — фронт поллит /device/poll до подтверждения.
   *
   * Body: { orderId }
   * Response: { userCode, verificationUriComplete, deviceCode, expiresIn, pollIntervalMs }
   *
   * NOTE: deviceCode возвращаем фронту, чтобы он сам поллил статус — у нас нет состояния
   * между запросами. deviceCode — одноразовый, после авторизации становится невалидным.
   */
  @Post('device/start')
  @HttpCode(HttpStatus.OK)
  async deviceStart(@Body() body: { orderId: string }) {
    const { orderId } = body;
    if (!orderId) {
      throw new HttpException('orderId required', HttpStatus.BAD_REQUEST);
    }

    let order: Order;
    try {
      order = await this.ordersService.findByOrderId(orderId);
    } catch {
      throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    }

    if (
      order.status !== OrderStatusEnum.PENDING &&
      order.status !== OrderStatusEnum.AWAITING_AUTH
    ) {
      throw new HttpException(
        `Invalid order status: ${order.status}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const result = await this.epicAuthService.startDeviceCodeFlow();

    // Сохраняем deviceCode и userCode в заказе (на случай рефреша страницы)
    await this.ordersService.updateOrder(order.id, {
      epicUserCode: result.userCode,
    });

    await this.ordersService.addTimelineLog(order.id, {
      tag: '[auth]',
      message: `Device code issued: ${result.userCode}`,
      level: LogLevel.INFO,
    });

    return {
      success: true,
      data: {
        userCode: result.userCode,
        verificationUri: result.verificationUri,
        verificationUriComplete: result.verificationUriComplete,
        deviceCode: result.deviceCode,
        expiresIn: result.expiresIn,
        pollIntervalMs: Math.max(result.interval * 1000, 3000),
      },
    };
  }

  /**
   * POST /api/auth/device/poll
   * Поллится фронтом каждые ~5 сек. Возвращает status: 'pending' | 'authorized' | 'expired'.
   * При authorized — токены сохраняются в заказе и заказ ставится в очередь.
   *
   * Body: { orderId, deviceCode }
   */
  @Post('device/poll')
  @HttpCode(HttpStatus.OK)
  async devicePoll(@Body() body: { orderId: string; deviceCode: string }) {
    const { orderId, deviceCode } = body;
    if (!orderId || !deviceCode) {
      throw new HttpException('orderId and deviceCode required', HttpStatus.BAD_REQUEST);
    }

    let order: Order;
    try {
      order = await this.ordersService.findByOrderId(orderId);
    } catch {
      throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    }

    const result = await this.epicAuthService.pollDeviceCode(deviceCode);

    if (result.status === 'pending') {
      return { success: true, data: { status: 'pending' } };
    }

    if (result.status !== 'authorized') {
      // expired / error
      await this.ordersService.addTimelineLog(order.id, {
        tag: '[auth]',
        message: `Device flow ${result.status}: ${(result as any).error || 'unknown'}`,
        level: LogLevel.ERROR,
      });
      throw new HttpException(
        `Device flow ${result.status}: ${(result as any).error || 'unknown'}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Сохраняем токены и ставим в очередь — ровно как submitCode
    await this.ordersService.updateStatus(
      order.id,
      OrderStatusEnum.AUTH_COMPLETED,
      {
        epicAccessToken: result.accessToken,
        epicRefreshToken: result.refreshToken,
        epicAccountId: result.accountId,
        epicDisplayName: result.displayName,
      },
    );

    await this.ordersService.addTimelineLog(order.id, {
      tag: '[auth]',
      message: `Authorized as ${result.displayName} via device flow`,
      level: LogLevel.SUCCESS,
    });

    await this.queueService.queueOrderForProcessing(order.orderId);

    await this.ordersService.addTimelineLog(order.id, {
      tag: '[system]',
      message: 'Order queued for processing (fast API flow)',
      level: LogLevel.INFO,
    });

    return {
      success: true,
      data: {
        status: 'authorized',
        displayName: result.displayName,
        accountId: result.accountId,
      },
    };
  }
}
