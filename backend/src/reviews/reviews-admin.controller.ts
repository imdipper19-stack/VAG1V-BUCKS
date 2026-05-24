import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';

import { Admin } from '../admin/admin.entity';
import { AdminAuthGuard } from '../admin/admin-auth.guard';
import { CurrentAdmin } from '../admin/current-admin.decorator';
import { RejectReviewDto } from './dto/reject-review.dto';
import { OrderReview, ReviewStatus } from './entities/order-review.entity';
import { ModeratorActor, ReviewsService } from './reviews.service';

/**
 * ReviewsAdminController
 *
 * REST surface for the admin moderation UI (Task 13). Every route is
 * guarded by {@link AdminAuthGuard}; the authenticated admin is
 * injected via {@link CurrentAdmin} so the audit-log writes inside
 * `ReviewsService.approve / reject` receive a real adminId + username
 * instead of a magic constant.
 *
 * The route base is `admin/reviews` — combined with the global
 * `api` prefix configured in `main.ts`, the public URLs become
 * `/api/admin/reviews/*`. This matches the contract in design.md
 * §2.6 and §4.3 (`reviewsApi.listAdmin / approve / reject`).
 *
 * Response envelope follows the existing project convention
 * `{ success: true, data: ... }` — see partner-admin.controller for
 * precedent.
 *
 * HTTP status convention:
 *   - `GET` → `200 OK` (framework default).
 *   - `POST` that mutates an existing row without creating a new
 *     resource (approve / reject) → `200 OK` via
 *     `@HttpCode(HttpStatus.OK)`.
 */
@Controller('admin/reviews')
@UseGuards(AdminAuthGuard)
export class ReviewsAdminController {
  constructor(private readonly reviewsService: ReviewsService) {}

  /**
   * `GET /api/admin/reviews?status=pending`
   *
   * List reviews for the moderation table (Requirement 10.1). The
   * optional `status` query parameter is validated against
   * {@link ReviewStatus}; an unknown value yields 400 before the
   * service is touched. Omitting the parameter returns every review
   * regardless of state — the admin UI uses this for the «Все» tab.
   */
  @Get()
  async list(
    @Query(
      'status',
      new ParseEnumPipe(ReviewStatus, { optional: true }),
    )
    status?: ReviewStatus,
  ): Promise<{ success: true; data: OrderReview[] }> {
    const data = await this.reviewsService.listForModeration({ status });
    return { success: true, data };
  }

  /**
   * `GET /api/admin/reviews/:id`
   *
   * Single-review detail view. The service throws `NotFoundException`
   * (→ 404) when the id is missing.
   */
  @Get(':id')
  async getById(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ success: true; data: OrderReview }> {
    const data = await this.reviewsService.getById(id);
    return { success: true, data };
  }

  /**
   * `POST /api/admin/reviews/:id/approve`
   *
   * Pending → approved transition (Requirement 10.3). Returns the
   * updated entity so the admin UI can swap the row in place without
   * a refetch. The service runs the status update + audit-log insert
   * atomically and refuses to act on non-pending rows
   * (ConflictException → 409, Requirement 10.10).
   */
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentAdmin() admin: Admin,
    @Req() req: Request,
  ): Promise<{ success: true; data: OrderReview }> {
    const actor = this.toModeratorActor(admin, req);
    const data = await this.reviewsService.approve(id, actor);
    return { success: true, data };
  }

  /**
   * `POST /api/admin/reviews/:id/reject`
   *
   * Pending → rejected transition (Requirement 10.7). The optional
   * `reason` from the body is stored in `rejection_reason` and copied
   * into the audit-log metadata. Same lifecycle / 409 contract as
   * {@link approve}.
   */
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RejectReviewDto,
    @CurrentAdmin() admin: Admin,
    @Req() req: Request,
  ): Promise<{ success: true; data: OrderReview }> {
    const actor = this.toModeratorActor(admin, req);
    const data = await this.reviewsService.reject(id, actor, dto.reason);
    return { success: true, data };
  }

  /**
   * Convert the `Admin` row attached to the request by
   * {@link AdminAuthGuard} (plus the request itself for IP / UA) into
   * the {@link ModeratorActor} shape that the service uses for audit
   * attribution.
   *
   * `req.ip` is sourced server-side from Express — it is NEVER read
   * from a client-controlled header. It can be empty when running
   * under unusual proxy configurations; we coalesce to `''` rather
   * than dropping the audit row, on the principle that an
   * audit-without-IP is still preferable to no audit at all.
   */
  private toModeratorActor(admin: Admin, req: Request): ModeratorActor {
    const userAgentHeader = req.headers['user-agent'];
    const userAgent = Array.isArray(userAgentHeader)
      ? userAgentHeader[0]
      : userAgentHeader;
    return {
      adminId: admin.id,
      adminUsername: admin.username,
      ip: req.ip ?? '',
      userAgent,
    };
  }
}
