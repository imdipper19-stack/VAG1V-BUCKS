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
  Logger,
  MessageEvent,
} from '@nestjs/common';
import { Observable, map, takeWhile } from 'rxjs';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderStatusEnum } from '../database/entities';
import { OrderEventBus } from '../queue/order-event-bus.service';
import { QueueService } from '../queue/queue.service';
import { StepEvent } from '../queue/interfaces/step-event.interface';
import { PromoCodeService } from '../partner/promo-code.service';
import { CommissionService } from '../partner/commission.service';
import { ValidatePromoCodeDto } from '../partner/dto/validate-promo-code.dto';

@Controller('orders')
export class OrdersController {
  private readonly logger = new Logger(OrdersController.name);

  constructor(
    private readonly ordersService: OrdersService,
    private readonly orderEventBus: OrderEventBus,
    private readonly queueService: QueueService,
    private readonly promoCodeService: PromoCodeService,
    private readonly commissionService: CommissionService,
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

  /**
   * POST /api/orders/validate-promo
   *
   * Pre-checkout promo-code validator (Requirement 9.2). Lets the
   * payment page show the discounted total before any order row is
   * created, so the buyer can confirm the price they will actually
   * pay.
   *
   * On success returns the partner's public-facing fields plus the
   * computed `discountAmount = priceTRY * discountRate`. We DO include
   * `commissionRate` in the response: it isn't sensitive (it's the
   * partner's own rate and the buyer doesn't see it on the cabinet
   * UI), and exposing it keeps a single shape between this endpoint
   * and what the order-creation flow already echoes back.
   *
   * Errors:
   *   - 404 (NotFoundException, `Промокод не найден`) — code is unknown
   *     or has been rotated to a non-current row.
   *   - 400 (BadRequestException, `Промокод неактивен`) — owning
   *     partner is `disabled` (Requirement 9.4).
   *   - 400 (validation pipe) — payload shape failed
   *     {@link ValidatePromoCodeDto}.
   *
   * Frontend contract: read the message off `response.error` /
   * thrown body and surface it directly — all messages are already
   * Russian-localised at the source.
   */
  @Post('validate-promo')
  @HttpCode(HttpStatus.OK)
  async validatePromo(@Body() dto: ValidatePromoCodeDto) {
    const validation = await this.promoCodeService.validate(dto.promoCode);
    const discountAmount = Number(
      (dto.priceTRY * validation.discountRate).toFixed(2),
    );
    return {
      success: true,
      data: {
        valid: true,
        discountRate: validation.discountRate,
        commissionRate: validation.commissionRate,
        partnerName: validation.partner.displayName,
        discountAmount,
      },
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
    // ------------------------------------------------------------------
    // Partner promo code: validate up-front so an invalid code rejects
    // the order before any DB row is created. PromoCodeService throws
    // NotFoundException / BadRequestException, which Nest surfaces as
    // 404 / 400 to the caller (Requirement 9.3, 9.4).
    //
    // Snapshot semantics (Requirement 9.6, 16.1, 16.2): we lock in the
    // partner's current rates onto the order so subsequent admin edits
    // do not retroactively change this order's discount or commission.
    // ------------------------------------------------------------------
    let partnerSnapshot:
      | {
          partnerId: string;
          promoCodeSnapshot: string;
          discountRateSnapshot: number;
          commissionRateSnapshot: number;
          discountAmount: number;
        }
      | undefined;

    if (createOrderDto.promoCode) {
      const validation = await this.promoCodeService.validate(
        createOrderDto.promoCode,
      );
      // Discount amount is computed against `priceTRY` for now. The
      // partner-program design (design.md §2.3 + Requirement 16.2)
      // describes commission/discount math in RUB terms, but the order
      // entity currently stores only `priceTRY`. We treat priceTRY as
      // the order's nominal amount and store any RUB conversion at the
      // pricing layer (`PricingService.tryToRub`). When the order
      // schema gains an explicit `priceRUB` column this multiplication
      // should switch to that field.
      // TODO(partner-program): switch to `priceRUB` once Order entity exposes it.
      const discountAmount = Number(
        (createOrderDto.priceTRY * validation.discountRate).toFixed(2),
      );
      partnerSnapshot = {
        partnerId: validation.partner.id,
        promoCodeSnapshot: createOrderDto.promoCode,
        discountRateSnapshot: validation.discountRate,
        commissionRateSnapshot: validation.commissionRate,
        discountAmount,
      };
    }

    const order = await this.ordersService.createOrder({
      vbucksAmount: createOrderDto.vbucksAmount,
      priceTRY: createOrderDto.priceTRY,
      sellerId: createOrderDto.sellerId,
      webhookUrl: createOrderDto.webhookUrl,
      ...(partnerSnapshot ?? {}),
    });

    // ------------------------------------------------------------------
    // Stamp a `pending` commission entry once the order exists. This
    // happens AFTER ordersService.createOrder so the FK
    // commission_entries.order_id → orders.id is satisfied.
    //
    // CommissionService.createPending uses INSERT ... ON CONFLICT DO
    // NOTHING, so a retried request with the same orderId is a safe
    // no-op (Requirement 10.5, 16.6). We also wrap in .catch() so a
    // commission-side failure does not roll back order creation —
    // the order itself is already persisted and the customer can pay.
    // The audit trail will surface any missing commission entry.
    // ------------------------------------------------------------------
    if (partnerSnapshot) {
      // TODO(partner-program): see priceRUB note above.
      const commissionAmount = Number(
        (
          createOrderDto.priceTRY * partnerSnapshot.commissionRateSnapshot
        ).toFixed(2),
      );
      await this.commissionService
        .createPending(order.id, partnerSnapshot.partnerId, commissionAmount)
        .catch((err) =>
          this.logger.warn(
            `Failed to create pending commission for order ${order.orderId}: ${err.message}`,
          ),
        );
    }

    const baseUrl = process.env.BASE_URL || 'http://localhost:3002';

    return {
      success: true,
      data: {
        orderId: order.orderId,
        shortUrl: `${baseUrl}/buyer?slug=${order.shortUrlSlug}`,
        expiresAt: order.expiresAt,
        // Include discount info in the response so the client can
        // confirm the applied promo code if it sent one.
        discountAmount: partnerSnapshot?.discountAmount,
        promoCodeApplied: partnerSnapshot ? createOrderDto.promoCode : undefined,
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
        vbucksAmount: order.vbucksAmount,
        priceTRY: order.priceTRY,
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
