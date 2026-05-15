import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Sse,
  HttpCode,
  HttpStatus,
  MessageEvent,
} from '@nestjs/common';
import { Observable, map, takeWhile } from 'rxjs';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderStatusEnum } from '../database/entities';
import { OrderEventBus } from '../queue/order-event-bus.service';
import { QueueService } from '../queue/queue.service';
import { StepEvent } from '../queue/interfaces/step-event.interface';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly orderEventBus: OrderEventBus,
    private readonly queueService: QueueService,
  ) {}

  /**
   * GET /api/orders/queue-info
   * Получить информацию об очереди (общее количество)
   */
  @Get('queue-info')
  async getQueueInfo() {
    const size = await this.queueService.getQueueSize();
    return { success: true, data: { queueSize: size } };
  }

  /**
   * GET /api/orders/stats
   * Получить статистику заказов (для админки)
   * ВАЖНО: Этот маршрут ПЕРЕД динамическими :orderId
   */
  @Get('stats')
  async getStats() {
    const stats = await this.ordersService.getStats();

    return {
      success: true,
      data: stats,
    };
  }

  @Post('test')
  @HttpCode(HttpStatus.CREATED)
  async createTestOrder(@Body() body: { vbucksAmount?: number }) {
    const vbucksAmount = body.vbucksAmount || 1000;

    // Находим цену из пакетов (примерный расчёт)
    const priceTRY = Number((vbucksAmount * 0.006).toFixed(2));

    const order = await this.ordersService.createOrder({
      vbucksAmount,
      priceTRY,
      sellerId: 'admin-test',
    });

    // Сразу переводим в awaiting_auth — оплата пропущена
    await this.ordersService.updateOrder(order.id, {
      paymentStatus: require('../database/entities').PaymentStatusEnum.PAID,
    });
    await this.ordersService.updateStatus(order.id, OrderStatusEnum.AWAITING_AUTH);
    await this.ordersService.addTimelineLog(order.id, {
      tag: '[test]',
      message: 'Test order — payment skipped by admin',
      level: require('../database/entities').LogLevel.WARNING,
    });

    const baseUrl = process.env.BASE_URL || 'http://localhost:3002';

    return {
      success: true,
      data: {
        orderId: order.orderId,
        vbucksAmount,
        buyerUrl: `${baseUrl}/buyer?slug=${order.shortUrlSlug}`,
        note: 'Тестовый заказ — оплата пропущена, сразу доступна Epic Auth',
      },
    };
  }

  @Post(':orderId/retry')
  @HttpCode(HttpStatus.OK)
  async retryOrder(@Param('orderId') orderId: string) {
    const order = await this.ordersService.findByOrderId(orderId);
    
    if (!order) {
      return {
        success: false,
        error: 'Order not found',
      };
    }

    if (order.status !== OrderStatusEnum.FAILED) {
      return {
        success: false,
        error: 'Only failed orders can be retried',
      };
    }

    // Reset order to pending and requeue
    await this.ordersService.updateOrder(orderId, {
      status: OrderStatusEnum.PENDING,
      errorMessage: undefined,
    });

    // Requeue for processing (using the same queue service as initial order)
    // This will be handled by the queue service automatically when status changes to pending

    return {
      success: true,
      data: { message: 'Order requeued for processing' },
    };
  }

  @Get('by-slug/:slug')
  async getOrderBySlug(@Param('slug') slug: string) {
    const order = await this.ordersService.findBySlug(slug);

    return {
      success: true,
      data: {
        orderId: order.orderId,
        vbucksAmount: order.vbucksAmount,
        priceTRY: order.priceTRY,
        currency: order.currency,
        status: order.status,
        expiresAt: order.expiresAt,
        timelineLogs: order.timelineLogs,
        epicDeviceCode: order.epicDeviceCode,
        epicDeviceCodeExpiresAt: order.epicDeviceCodeExpiresAt,
      },
    };
  }

  @Get('by-id/:orderId')
  async getOrderById(@Param('orderId') orderId: string) {
    const order = await this.ordersService.findByOrderId(orderId);

    return {
      success: true,
      data: order,
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createOrder(@Body() createOrderDto: CreateOrderDto) {
    const order = await this.ordersService.createOrder({
      vbucksAmount: createOrderDto.vbucksAmount,
      priceTRY: createOrderDto.priceTRY,
      sellerId: createOrderDto.sellerId,
      webhookUrl: createOrderDto.webhookUrl,
    });

    const baseUrl = process.env.BASE_URL || 'http://localhost:3002';

    return {
      success: true,
      data: {
        orderId: order.orderId,
        shortUrl: `${baseUrl}/buyer?slug=${order.shortUrlSlug}`,
        expiresAt: order.expiresAt,
      },
    };
  }

  /**
   * GET /api/orders/:orderId/queue-position
   * Получить позицию конкретного заказа в очереди
   */
  @Get(':orderId/queue-position')
  async getQueuePosition(@Param('orderId') orderId: string) {
    const size = await this.queueService.getQueueSize();
    const position = await this.queueService.getQueuePosition(orderId);
    return { success: true, data: { queueSize: size, position } };
  }

  /**
   * SSE endpoint для real-time обновлений статуса заказа
   * Клиент подключается через EventSource и получает мгновенные обновления от Event Bus
   */
  @Sse(':orderId/stream')
  streamOrderStatus(@Param('orderId') orderId: string): Observable<MessageEvent> {
    return this.orderEventBus.subscribe(orderId).pipe(
      map((event: StepEvent) => ({
        data: JSON.stringify(event),
      } as MessageEvent)),
      takeWhile(
        (msg) => {
          const data = JSON.parse((msg as any).data);
          return !(
            (data.step === 'completed' || data.step === 'failed') &&
            data.status === 'completed'
          );
        },
        true, // inclusive — send the terminal event before closing
      ),
    );
  }

  @Get(':orderId/status')
  async getOrderStatus(@Param('orderId') orderId: string) {
    const order = await this.ordersService.findByOrderId(orderId);

    return {
      success: true,
      data: {
        orderId: order.orderId,
        status: order.status,
        paymentStatus: order.paymentStatus,
        timelineLogs: order.timelineLogs,
        completedAt: order.completedAt,
        errorMessage: order.errorMessage,
        epicDisplayName: order.epicDisplayName,
        screenshotUrl: order.screenshotUrl,
      },
    };
  }

  @Get()
  async listOrders(
    @Query('limit') limitRaw?: string,
    @Query('status') status?: string,
    @Query('offset') offsetRaw?: string,
    @Query('sellerId') sellerId?: string,
  ) {
    // Парсим и валидируем числа
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 50;
    const offset = offsetRaw ? Number.parseInt(offsetRaw, 10) : 0;

    // Валидация status — пускаем только реальные значения enum
    let statusFilter: OrderStatusEnum | undefined;
    if (status && Object.values(OrderStatusEnum).includes(status as OrderStatusEnum)) {
      statusFilter = status as OrderStatusEnum;
    }

    const result = await this.ordersService.findOrders({
      status: statusFilter,
      sellerId,
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
    });

    return {
      success: true,
      data: result.orders,
      total: result.total,
      offset: result.offset,
      limit: result.limit,
    };
  }
}
