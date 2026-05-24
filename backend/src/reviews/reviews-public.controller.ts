import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';

import { CreateReviewDto } from './dto/create-review.dto';
import { PublicReviewDto } from './dto/public-review.dto';
import { ReviewsEligibilityService } from './reviews-eligibility.service';
import { ReviewsService } from './reviews.service';
import { OrdersService } from '../orders/orders.service';

/**
 * ReviewsPublicController
 *
 * Public-facing review endpoints, no authentication required:
 *
 *   - `POST /api/orders/:orderId/reviews`            — submit a review
 *   - `GET  /api/orders/:orderId/review-eligibility` — pre-check the
 *                                                      timeline-page CTA
 *   - `GET  /api/reviews/public`                     — landing carousel
 *
 * **orderId resolution.** The frontend timeline page lives at
 * `/order/[orderId]/timeline` and the URL parameter is the
 * human-readable `Order.orderId` (`VB-YYYY-XXXXXX`), not the UUID
 * primary key. Both the FK on `order_reviews.order_id` and
 * `ReviewsService` / `ReviewsEligibilityService` work in UUIDs, so this
 * controller is the single point of translation: every public path
 * resolves the human id → UUID via {@link OrdersService.findByOrderId}
 * before calling into the rest of the module.
 *
 * **Privacy-safe failure mode.** `OrdersService.findByOrderId` throws
 * a plain `Error('Order not found')` when the row is missing. We
 * deliberately convert that throw into either:
 *
 *   - the privacy-safe «not eligible» response on the eligibility
 *     endpoint, so a probe cannot tell whether a given orderId exists;
 *   - a generic `BadRequestException` on the submit endpoint, with the
 *     same Russian message the eligibility service uses for
 *     `not_completed`. Same surface area as a real not-completed order.
 *
 * **Validation.** `@Body() dto: CreateReviewDto` is auto-validated by
 * the global `ValidationPipe({ whitelist: true, transform: true })`
 * configured in `main.ts`, so the trim transformations on
 * `nickname` / `text` and the bounds checks on all three fields run
 * before the handler body executes.
 *
 * **Response shape.** All endpoints return `{ success: true, data:
 * ... }` to match the partner-program controllers and the existing
 * frontend `api` axios helper.
 */
@Controller()
export class ReviewsPublicController {
  constructor(
    private readonly reviewsService: ReviewsService,
    private readonly eligibilityService: ReviewsEligibilityService,
    private readonly ordersService: OrdersService,
  ) {}

  // ===================================================================
  // Submit
  // ===================================================================

  /**
   * Persist a new pending review for the order identified by
   * `orderId` (`VB-YYYY-XXXXXX`).
   *
   * - Auto-validated by the global ValidationPipe — invalid bodies
   *   surface as 400 with field-level messages from `CreateReviewDto`.
   * - `req.ip` and `req.headers['user-agent']` are read server-side
   *   only — never from the body — so a malicious client cannot spoof
   *   them past the rate-limit step (Requirement 8.4).
   * - Service-level errors map naturally:
   *     - `BadRequestException` → 400 (eligibility / window expired)
   *     - `ConflictException`   → 409 (already reviewed, UNIQUE race)
   *     - `HttpException(429)`  → 429 (rate-limit exceeded)
   */
  @Post('orders/:orderId/reviews')
  @HttpCode(HttpStatus.CREATED)
  async submit(
    @Param('orderId') orderId: string,
    @Body() dto: CreateReviewDto,
    @Req() req: Request,
  ) {
    const order = await this.resolveOrderUuidOrFail(orderId);

    const ip = req.ip ?? null;
    const userAgentHeader = req.headers['user-agent'];
    const userAgent =
      typeof userAgentHeader === 'string' ? userAgentHeader : null;

    const review = await this.reviewsService.submit(
      order.id,
      dto,
      ip,
      userAgent,
    );

    return {
      success: true,
      data: {
        id: review.id,
        status: review.status,
      },
    };
  }

  // ===================================================================
  // Eligibility
  // ===================================================================

  /**
   * Tell the timeline page whether the «Оставить отзыв» CTA should
   * render (Requirement 3.1–3.4).
   *
   * If the orderId is unknown (typo, tampered URL, deleted order) we
   * return the same `{ canSubmit: false, alreadyReviewed: false }`
   * shape the «not yet completed» state uses. That keeps the endpoint
   * from being usable as an existence oracle for orderId enumeration.
   */
  @Get('orders/:orderId/review-eligibility')
  async checkEligibility(@Param('orderId') orderId: string) {
    let orderUuid: string;
    try {
      const order = await this.ordersService.findByOrderId(orderId);
      orderUuid = order.id;
    } catch {
      // Privacy: do not disclose whether `orderId` corresponds to a
      // real row. The frontend treats this exactly like the
      // not_completed branch — render nothing.
      return {
        success: true,
        data: { canSubmit: false, alreadyReviewed: false },
      };
    }

    const eligibility = await this.eligibilityService.checkOrderEligibility(
      orderUuid,
    );
    return { success: true, data: eligibility };
  }

  // ===================================================================
  // Public listing (landing carousel)
  // ===================================================================

  /**
   * Approved reviews for the landing-page carousel
   * (Requirement 7.1–7.3). Each entry is mapped to
   * {@link PublicReviewDto} — only `id`, `nickname`, `stars`, `text`,
   * `createdAt` are exposed. The DB columns `orderId`, `ipAddress`,
   * `userAgent`, `moderatedBy`, lifecycle timestamps stay server-side.
   *
   * `?limit=` is optional. We parse it NaN-safely here; the service
   * clamps the result to its configured `[1, 200]` bounds and falls
   * back to a 50-row default if the value is missing or invalid.
   */
  @Get('reviews/public')
  async listApproved(
    @Query('limit') limitRaw?: string,
  ): Promise<{ success: true; data: PublicReviewDto[] }> {
    let limit: number | undefined;
    if (typeof limitRaw === 'string' && limitRaw.length > 0) {
      const parsed = Number(limitRaw);
      if (Number.isFinite(parsed)) {
        limit = parsed;
      }
    }

    const data = await this.reviewsService.listApproved(limit);
    return { success: true, data };
  }

  // ===================================================================
  // Internals
  // ===================================================================

  /**
   * Resolve `VB-YYYY-XXXXXX` → `Order` for the submit path.
   *
   * Converts the plain `Error` thrown by
   * {@link OrdersService.findByOrderId} into a `BadRequestException`
   * with the same message the eligibility service uses for the
   * `not_completed` reason — keeps the surface area uniform between
   * «order doesn't exist» and «order isn't completed».
   */
  private async resolveOrderUuidOrFail(orderId: string) {
    try {
      return await this.ordersService.findByOrderId(orderId);
    } catch {
      throw new BadRequestException('Заказ не доступен для отзыва');
    }
  }
}
