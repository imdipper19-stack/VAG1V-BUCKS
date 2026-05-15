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

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private ordersService: OrdersService,
    private queueService: QueueService,
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
}
