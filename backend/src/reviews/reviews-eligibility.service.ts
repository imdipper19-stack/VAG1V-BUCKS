import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OrderReview } from './entities/order-review.entity';
import { OrdersService } from '../orders/orders.service';
import { OrderStatusEnum } from '../database/entities/order.entity';

/**
 * Reason a given order is currently NOT eligible for a new review.
 *
 *  - `not_completed`     order does not exist OR is not in `completed`
 *                        OR has no `completedAt` timestamp set.
 *  - `window_expired`    order completed > 30 days ago (Requirement 8.3).
 *  - `already_reviewed`  a review already exists for this order
 *                        (Requirement 6.2 / 3.7).
 */
export type EligibilityReason =
  | 'not_completed'
  | 'window_expired'
  | 'already_reviewed';

/**
 * Descriptor returned from {@link ReviewsEligibilityService.checkOrderEligibility}.
 * `alreadyReviewed` is exposed as a separate boolean so the order
 * timeline page can render «Спасибо, вы уже оставили отзыв»
 * (Requirement 3.3) even when `canSubmit` is false.
 */
export interface OrderEligibility {
  canSubmit: boolean;
  reason?: EligibilityReason;
  alreadyReviewed: boolean;
}

/**
 * ReviewsEligibilityService
 *
 * Centralises the «can this order receive a review right now?» logic
 * for both:
 *
 *   - public eligibility checks consumed by the order timeline page
 *     (Requirement 3.1–3.4) via {@link checkOrderEligibility};
 *   - server-side guards at submission time (Requirement 3.5–3.7,
 *     8.1–8.2) via {@link assertCanSubmit}.
 *
 * The two methods share the exact same predicate set so the UI never
 * shows a CTA the server would reject. They differ only in the way
 * they communicate ineligibility — a structured descriptor vs an
 * exception.
 *
 * Order lookup is delegated to {@link OrdersService.findById}, which
 * `throw`s when the order is missing — we treat any throw as
 * `not_completed` so a leaked, mistyped or tampered orderId never
 * leaks information back to the client.
 */
@Injectable()
export class ReviewsEligibilityService {
  private readonly logger = new Logger(ReviewsEligibilityService.name);

  /**
   * Delivery_Window — 30 calendar days from `Order.completedAt`
   * (Requirement 8.3). Kept as `* 1000` ms for easy `Date.now()`
   * arithmetic.
   */
  private readonly DELIVERY_WINDOW_MS = 30 * 24 * 3600 * 1000;

  constructor(
    @InjectRepository(OrderReview)
    private readonly reviewRepo: Repository<OrderReview>,
    private readonly ordersService: OrdersService,
  ) {}

  /**
   * Decide whether `orderId` may currently receive a review.
   *
   * Resolution order (first match wins):
   *
   *   1. Order missing or unloadable → `not_completed`.
   *      Mirrors the «render nothing» frontend state — we never want
   *      to disclose whether a UUID corresponds to a real order.
   *   2. A review already exists → `already_reviewed`. This check
   *      runs BEFORE status/window checks so the «Спасибо, вы уже
   *      оставили отзыв» message stays visible even after the window
   *      has expired.
   *   3. Order status not `completed` → `not_completed`.
   *   4. Order has no `completedAt` (defensive — shouldn't happen
   *      when status === completed but TypeORM types allow null) →
   *      `not_completed`.
   *   5. `Date.now() - completedAt > 30 days` → `window_expired`.
   *   6. Otherwise → eligible.
   */
  async checkOrderEligibility(orderId: string): Promise<OrderEligibility> {
    let order;
    try {
      order = await this.ordersService.findById(orderId);
    } catch (err) {
      // OrdersService.findById throws plain `Error` when the row is
      // missing — see backend/src/orders/orders.service.ts. We swallow
      // it deliberately: from the timeline page's perspective an
      // unknown orderId is just «not eligible».
      this.logger.debug(
        `Eligibility lookup miss for ${orderId}: ${(err as Error).message}`,
      );
      return {
        canSubmit: false,
        reason: 'not_completed',
        alreadyReviewed: false,
      };
    }

    // --------------------------------------------------------------
    // Already-reviewed check first — keeps Requirement 3.3 message
    // visible even after the 30-day window closes.
    // --------------------------------------------------------------
    const existing = await this.reviewRepo.count({ where: { orderId } });
    if (existing > 0) {
      return {
        canSubmit: false,
        reason: 'already_reviewed',
        alreadyReviewed: true,
      };
    }

    // --------------------------------------------------------------
    // Status check (Requirement 3.5 / 8.1).
    // --------------------------------------------------------------
    if (order.status !== OrderStatusEnum.COMPLETED) {
      return {
        canSubmit: false,
        reason: 'not_completed',
        alreadyReviewed: false,
      };
    }

    if (!order.completedAt) {
      return {
        canSubmit: false,
        reason: 'not_completed',
        alreadyReviewed: false,
      };
    }

    // --------------------------------------------------------------
    // Window check (Requirement 3.6 / 8.2).
    // --------------------------------------------------------------
    const elapsed = Date.now() - new Date(order.completedAt).getTime();
    if (elapsed > this.DELIVERY_WINDOW_MS) {
      return {
        canSubmit: false,
        reason: 'window_expired',
        alreadyReviewed: false,
      };
    }

    return { canSubmit: true, alreadyReviewed: false };
  }

  /**
   * Throwing form of {@link checkOrderEligibility}, intended for the
   * submission code path. Localised messages match the requirements:
   *
   *   - already_reviewed  → 409 Conflict        «Отзыв для этого заказа уже существует»
   *   - window_expired    → 400 Bad Request    «Срок добавления отзыва истёк»
   *   - not_completed     → 400 Bad Request    «Заказ не доступен для отзыва»
   *
   * `ConflictException` for the duplicate case mirrors the same status
   * we emit when the DB-level UNIQUE(order_id) constraint fires inside
   * `ReviewsService.submit`, so clients can treat 409 uniformly.
   */
  async assertCanSubmit(orderId: string): Promise<void> {
    const eligibility = await this.checkOrderEligibility(orderId);
    if (eligibility.canSubmit) return;

    switch (eligibility.reason) {
      case 'already_reviewed':
        throw new ConflictException('Отзыв для этого заказа уже существует');
      case 'window_expired':
        throw new BadRequestException('Срок добавления отзыва истёк');
      case 'not_completed':
      default:
        throw new BadRequestException('Заказ не доступен для отзыва');
    }
  }
}
