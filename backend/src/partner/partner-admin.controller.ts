import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { AdminAuthGuard } from '../admin/admin-auth.guard';
import { CurrentAdmin } from '../admin/current-admin.decorator';
import { Admin } from '../admin/admin.entity';
import { Order } from '../database/entities';
import {
  CommissionEntry,
  CommissionEntryStatus,
} from './entities/commission-entry.entity';
import {
  PayoutRequest,
  PayoutRequestStatus,
} from './entities/payout-request.entity';
import { PartnerApplicationStatus } from './entities/partner-application.entity';
import { PartnerApplicationService } from './partner-application.service';
import { PartnerService } from './partner.service';
import { PayoutService } from './payout.service';
import { PromoCodeService } from './promo-code.service';
import { ApproveApplicationDto } from './dto/approve-application.dto';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { UpdatePartnerDto } from './dto/update-partner.dto';
import { UpdatePayoutStatusDto } from './dto/update-payout-status.dto';

/**
 * PartnerAdminController
 *
 * REST surface for the admin-side partner-program management UI
 * (Task 11). Every route is guarded by {@link AdminAuthGuard}; the
 * authenticated admin is injected via {@link CurrentAdmin} so service
 * calls that need to attribute mutations (audit log, `processed_by`,
 * etc.) receive a real `adminId` rather than a magic constant.
 *
 * Three orthogonal resource families live here:
 *
 *   - **Applications** — list/get/approve/reject the partner-program
 *     applications submitted via the public landing form (Task 5).
 *   - **Partners** — create manually, list, edit rates/status,
 *     regenerate promo code, regenerate invite link, view per-partner
 *     orders + payouts (Task 6 + Task 8).
 *   - **Payouts** — list, get, transition state across the
 *     `requested → processing → paid` / `… → rejected` machine
 *     (Task 8).
 *
 * Responses follow the existing project convention
 * `{ success: true, data: ... }`. Approve and manual-create endpoints
 * return the full triple `{ partner, promoCode, inviteToken,
 * inviteLink }` so the admin UI can render the "copy link to send via
 * Telegram" affordance immediately, without a follow-up round trip.
 *
 * HTTP status convention:
 *   - `POST` that creates a brand-new resource (approve, manual create)
 *     → `201 Created` via `@HttpCode(HttpStatus.CREATED)`.
 *   - `POST` that mutates an existing row without creating one
 *     (regenerate-code, regenerate-invite, toggle-status, reject)
 *     → `200 OK` via `@HttpCode(HttpStatus.OK)`.
 *   - `PATCH` → `200 OK`.
 *   - `GET` → `200 OK` (the framework default).
 */
@Controller('admin')
@UseGuards(AdminAuthGuard)
export class PartnerAdminController {
  constructor(
    private readonly partnerApplicationService: PartnerApplicationService,
    private readonly partnerService: PartnerService,
    private readonly payoutService: PayoutService,
    private readonly promoCodeService: PromoCodeService,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(CommissionEntry)
    private readonly commissionRepo: Repository<CommissionEntry>,
    @InjectRepository(PayoutRequest)
    private readonly payoutRepo: Repository<PayoutRequest>,
  ) {}

  // ─── applications ─────────────────────────────────────────────────────

  /**
   * `GET /api/admin/partner-applications?status=pending`
   *
   * Lists applications, newest-first (Requirement 5.2). The optional
   * `status` query parameter is validated against
   * {@link PartnerApplicationStatus}; an unknown value yields a 400
   * before reaching the service.
   */
  @Get('partner-applications')
  async listApplications(
    @Query(
      'status',
      new ParseEnumPipe(PartnerApplicationStatus, { optional: true }),
    )
    status?: PartnerApplicationStatus,
  ) {
    const applications = await this.partnerApplicationService.list({ status });
    return { success: true, data: applications };
  }

  /**
   * `GET /api/admin/partner-applications/:id`
   *
   * Single-application detail view. Service throws
   * `NotFoundException` (→ 404) when the id does not exist.
   */
  @Get('partner-applications/:id')
  async getApplication(@Param('id', new ParseUUIDPipe()) id: string) {
    const application = await this.partnerApplicationService.getById(id);
    return { success: true, data: application };
  }

  /**
   * `POST /api/admin/partner-applications/:id/approve`
   *
   * Pending → approved transition (Requirement 5.5). Returns the
   * brand-new partner row, the freshly-issued promo code, the raw
   * invite token, and the formatted invite link the admin pastes into
   * Telegram (Task 11.3).
   */
  @Post('partner-applications/:id/approve')
  @HttpCode(HttpStatus.CREATED)
  async approveApplication(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ApproveApplicationDto,
    @CurrentAdmin() admin: Admin,
  ) {
    const result = await this.partnerApplicationService.approve(
      id,
      admin.id,
      body,
    );
    return {
      success: true,
      data: {
        partner: result.partner,
        promoCode: result.promoCode,
        inviteToken: result.inviteToken,
        inviteLink: this.formatInviteLink(result.inviteToken),
      },
    };
  }

  /**
   * `POST /api/admin/partner-applications/:id/reject`
   *
   * Pending → rejected transition (Requirement 5.6). Does NOT create a
   * Partner row; returns the updated application so the UI can re-paint
   * the row without a separate refetch.
   */
  @Post('partner-applications/:id/reject')
  @HttpCode(HttpStatus.OK)
  async rejectApplication(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentAdmin() admin: Admin,
  ) {
    const application = await this.partnerApplicationService.reject(
      id,
      admin.id,
    );
    return { success: true, data: application };
  }

  // ─── partners ─────────────────────────────────────────────────────────

  /**
   * `GET /api/admin/partners`
   *
   * Lists every partner (Requirement 7.1) with the current promo code,
   * Partner_Balance, and Total_Earned attached for the admin grid.
   */
  @Get('partners')
  async listPartners() {
    const partners = await this.partnerService.list();
    return { success: true, data: partners };
  }

  /**
   * `POST /api/admin/partners`
   *
   * Manual partner creation (Requirement 6.1). Mirrors the approve
   * response shape so the admin UI can surface the same
   * "copy invite link" + "copy promo code" workflow regardless of
   * whether the partner came in via the application form or was added
   * by hand.
   */
  @Post('partners')
  @HttpCode(HttpStatus.CREATED)
  async createPartner(
    @Body() body: CreatePartnerDto,
    @CurrentAdmin() admin: Admin,
  ) {
    const result = await this.partnerService.create(body, admin.id);
    return {
      success: true,
      data: {
        partner: result.partner,
        promoCode: result.promoCode,
        inviteToken: result.inviteToken,
        inviteLink: this.formatInviteLink(result.inviteToken),
      },
    };
  }

  /**
   * `GET /api/admin/partners/:id`
   *
   * Per-partner detail (Requirement 15.2). Merges the base partner row
   * with the aggregated stats so the admin detail page renders without
   * a second round trip. Stats override base columns where they
   * conflict (none today, but the spread order is intentional).
   */
  @Get('partners/:id')
  async getPartner(@Param('id', new ParseUUIDPipe()) id: string) {
    const [partner, stats] = await Promise.all([
      this.partnerService.getById(id),
      this.partnerService.getStats(id),
    ]);
    return {
      success: true,
      data: { ...partner, ...stats },
    };
  }

  /**
   * `PATCH /api/admin/partners/:id`
   *
   * Partial update of `discount_rate`, `commission_rate`, and/or
   * `status` (Requirement 7.2–7.4). The cross-field check
   * `discountRate + commissionRate <= 1` (Requirement 7.7–7.8) lives
   * in the service layer.
   */
  @Patch('partners/:id')
  @HttpCode(HttpStatus.OK)
  async updatePartner(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdatePartnerDto,
    @CurrentAdmin() admin: Admin,
  ) {
    const partner = await this.partnerService.updateRates(id, body, admin.id);
    return { success: true, data: partner };
  }

  /**
   * `POST /api/admin/partners/:id/toggle-status`
   *
   * Convenience flip between `active` and `disabled` (Requirement 7.4).
   * Existing balances and Commission_Entry rows are preserved — only
   * future promo-code validations and commission creations are
   * affected.
   */
  @Post('partners/:id/toggle-status')
  @HttpCode(HttpStatus.OK)
  async togglePartnerStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentAdmin() admin: Admin,
  ) {
    const partner = await this.partnerService.toggleStatus(id, admin.id);
    return { success: true, data: partner };
  }

  /**
   * `POST /api/admin/partners/:id/regenerate-code`
   *
   * Rotates the partner's current promo code (Requirement 7.5–7.6).
   * Old code is marked `is_current=false` (kept for historical join
   * integrity), new code is inserted and returned to the admin UI for
   * an immediate "copy" gesture.
   */
  @Post('partners/:id/regenerate-code')
  @HttpCode(HttpStatus.OK)
  async regeneratePromoCode(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentAdmin() admin: Admin,
  ) {
    const fresh = await this.promoCodeService.regenerate(id, admin.id);
    return { success: true, data: { code: fresh.code } };
  }

  /**
   * `POST /api/admin/partners/:id/regenerate-invite`
   *
   * Re-issues the invite token so the admin can ship a fresh
   * `/partner/invite?token=…` link if the original was lost or
   * expired. Returns both the raw token (for diagnostic logging) and
   * the formatted link (the value the admin actually pastes into
   * Telegram).
   */
  @Post('partners/:id/regenerate-invite')
  @HttpCode(HttpStatus.OK)
  async regenerateInvite(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentAdmin() admin: Admin,
  ) {
    const { inviteToken } = await this.partnerService.regenerateInviteToken(
      id,
      admin.id,
    );
    return {
      success: true,
      data: {
        inviteToken,
        inviteLink: this.formatInviteLink(inviteToken),
      },
    };
  }

  /**
   * `GET /api/admin/partners/:id/orders?limit=50&offset=0`
   *
   * Per-partner order history for the admin detail page
   * (Requirement 15.3). Loads the partner's orders via
   * `OrdersService.findOrders` with a `partnerId` filter, then merges
   * each order with its corresponding `commission_entries` row so the
   * UI sees a single flat record per order.
   *
   * Why a controller-level merge instead of a service method? The
   * existing `OrdersService.findOrders` was designed for the admin
   * orders dashboard and intentionally doesn't know about the partner
   * domain. Doing the merge here keeps that separation intact and
   * avoids cross-coupling two modules over a single query.
   *
   * The response shape mirrors what Task 10.2 will surface in the
   * partner cabinet, so the admin UI and the partner UI can share
   * rendering code with only a permission swap at the top.
   */
  @Get('partners/:id/orders')
  async listPartnerOrders(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ) {
    // 1. Verify the partner exists so callers get a clean 404 instead
    //    of an empty list when they typo the id.
    await this.partnerService.getById(id);

    // 2. Pull the slice of orders owned by this partner. We query the
    //    Order repository directly here rather than threading a
    //    `partnerId` filter through `OrdersService.findOrders`, since
    //    this is the only caller that needs that filter today and the
    //    response shape we produce (orders + commission merge) is
    //    partner-specific anyway.
    const orders = await this.orderRepo
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.timelineLogs', 'timelineLogs')
      .where('order.partnerId = :id', { id })
      .orderBy('order.createdAt', 'DESC')
      .addOrderBy('timelineLogs.timestamp', 'ASC')
      .skip(Math.max(offset ?? 0, 0))
      .take(Math.min(Math.max(limit ?? 50, 1), 200))
      .getMany();

    if (orders.length === 0) {
      return {
        success: true,
        data: {
          orders: [],
          limit: limit ?? 50,
          offset: offset ?? 0,
        },
      };
    }

    // 3. Fetch every commission entry whose order_id is in the set we
    //    just loaded, then index by order id for an O(1) merge per
    //    row. A single IN-list query keeps this O(orders) instead of
    //    one round-trip per row.
    const orderIds = orders.map((o) => o.id);
    const entries = await this.commissionRepo.find({
      where: { orderId: In(orderIds) },
    });
    const byOrderId = new Map<string, CommissionEntry>();
    for (const entry of entries) byOrderId.set(entry.orderId, entry);

    const merged = orders.map((order) => {
      const entry = byOrderId.get(order.id);
      return {
        id: order.id,
        orderId: order.orderId,
        vbucksAmount: order.vbucksAmount,
        priceTRY: order.priceTRY,
        status: order.status,
        createdAt: order.createdAt,
        completedAt: order.completedAt,
        promoCodeSnapshot: order.promoCodeSnapshot,
        discountRateSnapshot: order.discountRateSnapshot,
        commissionRateSnapshot: order.commissionRateSnapshot,
        discountAmount: order.discountAmount,
        commission: entry
          ? {
              id: entry.id,
              amount: Number(entry.amount),
              status: entry.status as CommissionEntryStatus,
              approvedAt: entry.approvedAt,
              cancelledAt: entry.cancelledAt,
            }
          : null,
      };
    });

    return {
      success: true,
      data: {
        orders: merged,
        limit: limit ?? 50,
        offset: offset ?? 0,
      },
    };
  }

  /**
   * `GET /api/admin/partners/:id/payouts`
   *
   * Per-partner payout history for the admin detail page
   * (Requirement 15.4). Returns rows sorted newest-first directly from
   * the payout repo — no need for the service-level filtering since we
   * want every status here, not just one tab.
   */
  @Get('partners/:id/payouts')
  async listPartnerPayouts(@Param('id', new ParseUUIDPipe()) id: string) {
    // Verify the partner exists so a typo'd id surfaces as a clean 404.
    await this.partnerService.getById(id);

    const payouts = await this.payoutRepo.find({
      where: { partnerId: id },
      order: { createdAt: 'DESC' },
    });
    return { success: true, data: payouts };
  }

  // ─── payouts ──────────────────────────────────────────────────────────

  /**
   * `GET /api/admin/payouts?status=requested`
   *
   * Lists every payout request (Requirement 14.2), newest-first, with
   * an optional status filter for the tabbed admin UI. An unknown
   * `status` value yields a 400 before reaching the service.
   */
  @Get('payouts')
  async listPayouts(
    @Query(
      'status',
      new ParseEnumPipe(PayoutRequestStatus, { optional: true }),
    )
    status?: PayoutRequestStatus,
  ) {
    const payouts = await this.payoutService.list({ status });
    return { success: true, data: payouts };
  }

  /**
   * `GET /api/admin/payouts/:id`
   *
   * Single-payout detail. Service throws `NotFoundException` (→ 404)
   * when the id does not exist.
   */
  @Get('payouts/:id')
  async getPayout(@Param('id', new ParseUUIDPipe()) id: string) {
    const payout = await this.payoutService.getById(id);
    return { success: true, data: payout };
  }

  /**
   * `PATCH /api/admin/payouts/:id/status`
   *
   * Transitions a payout through the state machine (Requirement
   * 14.3–14.5). The DTO validates `status` against the enum; the
   * actual transition graph and idempotency rules live in
   * {@link PayoutService.updateStatus}.
   */
  @Patch('payouts/:id/status')
  @HttpCode(HttpStatus.OK)
  async updatePayoutStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdatePayoutStatusDto,
    @CurrentAdmin() admin: Admin,
  ) {
    const payout = await this.payoutService.updateStatus(
      id,
      body.status,
      admin.id,
      body.rejectionReason,
    );
    return { success: true, data: payout };
  }

  // ─── helpers ──────────────────────────────────────────────────────────

  /**
   * Builds the public `/partner/invite?token=…` URL the admin pastes
   * into Telegram to ship a partner their invite link
   * (Task 11.3, Requirement 11.2).
   *
   * Base URL precedence (most specific wins):
   *   1. `FRONTEND_URL` — explicit override for the public origin.
   *   2. `BASE_URL`     — fallback to whatever the rest of the app
   *                       uses for outbound links (e.g. order URLs).
   *   3. Hard-coded `http://localhost:3001` for local dev.
   *
   * Trailing slash on the base is normalised away so we don't emit
   * `https://example.com//partner/invite?…` when the env var was set
   * with a trailing slash.
   */
  private formatInviteLink(token: string): string {
    const base =
      process.env.FRONTEND_URL ??
      process.env.BASE_URL ??
      'http://localhost:3001';
    return `${base.replace(/\/$/, '')}/partner/invite?token=${token}`;
  }
}
