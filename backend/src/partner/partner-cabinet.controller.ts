import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { PartnerAuthGuard } from './guards/partner-auth.guard';
import { CurrentPartner } from './decorators/current-partner.decorator';
import { Partner } from './entities/partner.entity';
import { CommissionEntry } from './entities/commission-entry.entity';
import { PartnerService } from './partner.service';
import { PayoutService } from './payout.service';
import { CreatePayoutRequestDto } from './dto/create-payout-request.dto';
import { Order } from '../database/entities';

/** Hard cap on `?limit=` so a malicious / curious caller cannot drain the DB. */
const MAX_ORDERS_PAGE_SIZE = 200;
/** Default page size when `?limit=` is omitted. */
const DEFAULT_ORDERS_PAGE_SIZE = 50;

/**
 * PartnerCabinetController
 *
 * Authenticated partner-side endpoints — every route is guarded by
 * {@link PartnerAuthGuard} which reads the `partner_token` cookie (or
 * `Authorization: Bearer …` header), verifies the JWT, and attaches
 * the resolved {@link Partner} to the request. The
 * {@link CurrentPartner} param decorator surfaces it to handlers.
 *
 * Endpoints:
 *   - GET  /api/partner/dashboard  — balances, totals, current promo
 *                                    code, rates (Requirement 12.1).
 *   - GET  /api/partner/orders     — paginated list of orders that
 *                                    used this partner's promo code,
 *                                    with their commission status
 *                                    (Requirement 12.2–12.3).
 *   - GET  /api/partner/payouts    — payout history (Requirement 12.4).
 *   - POST /api/partner/payouts    — create a new payout request
 *                                    (Requirement 13.1–13.5).
 *
 * The orders endpoint joins two tables — `orders` (filtered by
 * `partner_id`) and `commission_entries` (filtered by the resulting
 * order ids). Two queries total, no N+1.
 */
@Controller('partner')
@UseGuards(PartnerAuthGuard)
export class PartnerCabinetController {
  constructor(
    private readonly partnerService: PartnerService,
    private readonly payoutService: PayoutService,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(CommissionEntry)
    private readonly commissionRepo: Repository<CommissionEntry>,
  ) {}

  // ─── dashboard ───────────────────────────────────────────────────────

  /**
   * GET /api/partner/dashboard
   *
   * Combines numeric stats from {@link PartnerService.getStats} with
   * the rate / identity fields already loaded by the guard so the
   * cabinet home page can render in a single round-trip.
   */
  @Get('dashboard')
  async dashboard(@CurrentPartner() partner: Partner) {
    const stats = await this.partnerService.getStats(partner.id);
    return {
      success: true,
      data: {
        partnerBalance: stats.partnerBalance,
        pendingBalance: stats.pendingBalance,
        totalEarned: stats.totalEarned,
        totalPaid: stats.totalPaid,
        currentPromoCode: stats.currentPromoCode,
        // Rates come from the guard-loaded partner row, not from
        // `getStats` (which doesn't carry them) — pg returns DECIMAL
        // as strings, coerce to number so JSON output is clean.
        discountRate: Number(partner.discountRate),
        commissionRate: Number(partner.commissionRate),
        displayName: partner.displayName,
        username: partner.username,
        status: partner.status,
      },
    };
  }

  // ─── orders ──────────────────────────────────────────────────────────

  /**
   * GET /api/partner/orders?limit=50&offset=0
   *
   * Returns the partner's order history (orders where their promo
   * code was applied) with each order's commission entry attached so
   * the cabinet can render commission amount + status alongside the
   * order itself (Requirement 12.2–12.3).
   *
   * Pagination is bounded:
   *   - limit  ∈ [1, MAX_ORDERS_PAGE_SIZE], default DEFAULT_ORDERS_PAGE_SIZE
   *   - offset ∈ [0, ∞)
   *
   * Implementation note: we go through the `Order` repo directly
   * (exported by `OrdersModule.TypeOrmModule`) rather than
   * `OrdersService` because the service has no `findByPartnerId`
   * method and adding one solely for this consumer would couple a
   * generic service to partner concerns. Two queries:
   *   1. orders where partner_id = :id, paged, newest first;
   *   2. commission_entries where order_id IN (:orderIds), one round-trip.
   */
  @Get('orders')
  async listOrders(
    @CurrentPartner() partner: Partner,
    @Query('limit', new DefaultValuePipe(DEFAULT_ORDERS_PAGE_SIZE), ParseIntPipe)
    limitRaw: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offsetRaw: number,
  ) {
    const limit = Math.min(Math.max(limitRaw, 1), MAX_ORDERS_PAGE_SIZE);
    const offset = Math.max(offsetRaw, 0);

    const [orders, total] = await this.orderRepo.findAndCount({
      where: { partnerId: partner.id },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    if (orders.length === 0) {
      return {
        success: true,
        data: { items: [], total, limit, offset },
      };
    }

    // Batch-fetch matching commissions in one shot. Some orders may
    // not have a commission row yet (creation race with the catch()
    // path in OrdersController.createOrder) — those surface with
    // `commissionAmount = null` and `commissionStatus = null`, which
    // the cabinet renders as an inline placeholder.
    const orderIds = orders.map((o) => o.id);
    const commissions = await this.commissionRepo.find({
      where: { orderId: In(orderIds) },
    });
    const commissionByOrderId = new Map(
      commissions.map((c) => [c.orderId, c]),
    );

    const items = orders.map((order) => {
      const commission = commissionByOrderId.get(order.id);
      return {
        orderId: order.orderId,
        createdAt: order.createdAt,
        priceTRY: Number(order.priceTRY),
        vbucksAmount: order.vbucksAmount,
        status: order.status,
        commissionAmount: commission ? Number(commission.amount) : null,
        commissionStatus: commission?.status ?? null,
      };
    });

    return {
      success: true,
      data: { items, total, limit, offset },
    };
  }

  // ─── payouts ────────────────────────────────────────────────────────

  /**
   * GET /api/partner/payouts
   *
   * Returns this partner's payout history, newest first
   * (Requirement 12.4). The cabinet UI displays the same fields the
   * admin grid does, so we return the raw entity rather than a
   * controller-side projection.
   */
  @Get('payouts')
  async listPayouts(@CurrentPartner() partner: Partner) {
    const payouts = await this.payoutService.listForPartner(partner.id);
    return {
      success: true,
      data: payouts,
    };
  }

  /**
   * POST /api/partner/payouts
   *
   * Creates a new payout request from the cabinet
   * (Requirement 13.1–13.5). Validation:
   *   - DTO: `amount >= 0.01`, `requisites` length 5..2000.
   *   - Service: `amount <= getBalance(partnerId)`.
   *
   * On a balance violation `PayoutService.create` throws
   * `BadRequestException` with `Запрашиваемая сумма превышает
   * доступный баланс` — Nest surfaces it as a 400 directly.
   */
  @Post('payouts')
  @HttpCode(HttpStatus.CREATED)
  async createPayout(
    @CurrentPartner() partner: Partner,
    @Body() dto: CreatePayoutRequestDto,
  ) {
    const payout = await this.payoutService.create(partner.id, dto);
    return {
      success: true,
      data: payout,
    };
  }
}
