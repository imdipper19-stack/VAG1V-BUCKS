import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';

import { CreateReviewDto } from './dto/create-review.dto';
import { PublicReviewDto } from './dto/public-review.dto';
import {
  OrderReview,
  ReviewStatus,
} from './entities/order-review.entity';
import { ReviewsEligibilityService } from './reviews-eligibility.service';
import {
  AdminActivityLog,
  AdminActivityType,
} from '../database/entities/admin-activity-log.entity';

/**
 * Postgres SQLSTATE for `unique_violation` — see
 * https://www.postgresql.org/docs/current/errcodes-appendix.html.
 * Used to convert a race-induced UNIQUE(order_id) trip into a 409.
 */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Soft cap on the user-agent string we persist. Browser UAs rarely
 * exceed 200 characters; anything larger is almost certainly a probe
 * or a bug-out client. 512 leaves head-room without enabling
 * runaway-size attacks against the table.
 */
const USER_AGENT_MAX_LENGTH = 512;

/**
 * Default page size for the public listing. Capped server-side so
 * `?limit=999999` cannot exhaust DB resources.
 */
const PUBLIC_LIST_DEFAULT_LIMIT = 50;
const PUBLIC_LIST_MAX_LIMIT = 200;

/**
 * Audit identity passed by the admin controllers into
 * {@link ReviewsService.approve} / {@link ReviewsService.reject}.
 *
 * `ip` and `userAgent` are sourced from the HTTP request — the
 * service does not extract them itself so the controller stays the
 * single point of trust for client-supplied headers.
 */
export interface ModeratorActor {
  adminId: string;
  adminUsername: string;
  ip: string;
  userAgent?: string;
}

/**
 * ReviewsService
 *
 * Buyer-facing submission, public listing, and admin moderation of
 * order reviews. Implements Requirements 5.* (validation), 6.*
 * (one-review-per-order, lifecycle persistence), 7.* (privacy of
 * public payload), 8.* (rate-limit + window) and 10.* (approve /
 * reject + audit log).
 *
 * Rate-limit configuration is read from environment variables at
 * construction time. The settings table in this project is JSON-keyed
 * (one row per logical key) and not a flat key/value store, so flat
 * values like `reviews.rate_limit.threshold` would require an
 * awkward wrapper row. Env vars keep the surface predictable while
 * still allowing per-environment overrides.
 *
 *   `REVIEWS_RATE_LIMIT_THRESHOLD`        default 5      (Requirement 8.4)
 *   `REVIEWS_RATE_LIMIT_WINDOW_SECONDS`   default 3600   (Requirement 8.4)
 */
@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  /** Max submissions per IP inside the rolling window before 429. */
  private readonly RATE_LIMIT_THRESHOLD = Number(
    process.env.REVIEWS_RATE_LIMIT_THRESHOLD ?? 5,
  );

  /** Length of the rolling rate-limit window, in seconds. */
  private readonly RATE_LIMIT_WINDOW_SECONDS = Number(
    process.env.REVIEWS_RATE_LIMIT_WINDOW_SECONDS ?? 3600,
  );

  constructor(
    @InjectRepository(OrderReview)
    private readonly reviewRepo: Repository<OrderReview>,
    @InjectRepository(AdminActivityLog)
    private readonly auditRepo: Repository<AdminActivityLog>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly eligibilityService: ReviewsEligibilityService,
  ) {
    // The activity-log repo is only used inside transactions via the
    // `manager.create(...)` API, but injecting it pulls the entity
    // metadata into this module's TypeORM scope so `manager` knows
    // about the table. Reference once to silence unused-property
    // warnings if the codebase enables them in the future.
    void this.auditRepo;
  }

  // ===================================================================
  // Buyer-facing
  // ===================================================================

  /**
   * Persist a new review for `orderId`.
   *
   * Pipeline:
   *   1. {@link ReviewsEligibilityService.assertCanSubmit} — completed,
   *      inside Delivery_Window, no existing review (Requirement
   *      3.5–3.7 / 8.1–8.2).
   *   2. Per-IP rate-limit check (Requirement 8.4).
   *   3. INSERT with `status = pending`. A concurrent insert that
   *      slips past step 1 is caught by the UNIQUE(order_id) constraint
   *      → 23505 → ConflictException (Requirement 6.3).
   *
   * Trim transformations on `nickname` / `text` are already applied by
   * `CreateReviewDto`'s class-transformer decorators, so this method
   * just persists the values as-is.
   *
   * @param orderId  The orders.id UUID. The buyer endpoint accepts
   *                 this in the URL — it is NEVER read from the body.
   * @param dto      Validated submission payload.
   * @param ip       Client IP, sourced server-side from `req.ip`.
   *                 Empty string / null disables the rate-limit step
   *                 (used by tests).
   * @param userAgent Raw `User-Agent` header — truncated to 512 chars
   *                  before persistence to avoid abuse.
   */
  async submit(
    orderId: string,
    dto: CreateReviewDto,
    ip: string | null,
    userAgent: string | null,
  ): Promise<OrderReview> {
    // ----- 1. Eligibility (throws on failure) ------------------------
    await this.eligibilityService.assertCanSubmit(orderId);

    // ----- 2. Rate-limit (only if we know the caller's IP) -----------
    if (ip) {
      await this.assertWithinRateLimit(ip);
    }

    // ----- 3. Persist ------------------------------------------------
    try {
      const review = this.reviewRepo.create({
        orderId,
        nickname: dto.nickname,
        stars: dto.stars,
        text: dto.text,
        ipAddress: ip,
        userAgent: userAgent ? userAgent.slice(0, USER_AGENT_MAX_LENGTH) : null,
        status: ReviewStatus.PENDING,
      });
      return await this.reviewRepo.save(review);
    } catch (err) {
      // Guard the race between assertCanSubmit and INSERT — two
      // concurrent submissions for the same order will both clear
      // the eligibility check, only one will win the UNIQUE.
      if (
        err instanceof QueryFailedError &&
        (err as QueryFailedError & { code?: string }).code ===
          PG_UNIQUE_VIOLATION
      ) {
        throw new ConflictException('Отзыв для этого заказа уже существует');
      }
      throw err;
    }
  }

  // ===================================================================
  // Public listing
  // ===================================================================

  /**
   * Approved reviews, newest first, mapped to the privacy-safe
   * {@link PublicReviewDto} (Requirements 7.1–7.3).
   *
   * @param limit  Optional client-supplied page size. Clamped to
   *               `[1, PUBLIC_LIST_MAX_LIMIT]`; falsy / NaN values
   *               fall back to {@link PUBLIC_LIST_DEFAULT_LIMIT}.
   */
  async listApproved(limit?: number): Promise<PublicReviewDto[]> {
    const take = this.resolvePublicLimit(limit);
    const rows = await this.reviewRepo.find({
      where: { status: ReviewStatus.APPROVED },
      order: { createdAt: 'DESC' },
      take,
    });
    return rows.map((r) => this.toPublicDto(r));
  }

  // ===================================================================
  // Admin-facing
  // ===================================================================

  /**
   * Full review entities for the moderation table (admin-only callers).
   * Optional `status` filter narrows the list to one lifecycle state.
   */
  async listForModeration(filters: {
    status?: ReviewStatus;
  }): Promise<OrderReview[]> {
    return this.reviewRepo.find({
      where: filters.status ? { status: filters.status } : {},
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Single review by id — `404` if missing. Used by the admin detail
   * page and as the basis for approve/reject mutations.
   */
  async getById(id: string): Promise<OrderReview> {
    const review = await this.reviewRepo.findOne({ where: { id } });
    if (!review) {
      throw new NotFoundException('Отзыв не найден');
    }
    return review;
  }

  /**
   * Move a pending review to `approved` and write an
   * `AdminActivityType.REVIEW_APPROVE` audit log entry, atomically.
   *
   *   - Throws `NotFoundException` if the review does not exist.
   *   - Throws `ConflictException` if it is no longer `pending`
   *     (Requirement 10.10).
   *
   * Both the status update and the audit insert run inside a single
   * `dataSource.transaction(...)` so a failure on either side rolls
   * back the other.
   */
  async approve(id: string, actor: ModeratorActor): Promise<OrderReview> {
    return this.dataSource.transaction(async (manager) => {
      const review = await manager.findOne(OrderReview, { where: { id } });
      if (!review) {
        throw new NotFoundException('Отзыв не найден');
      }
      if (review.status !== ReviewStatus.PENDING) {
        throw new ConflictException('Отзыв уже не в статусе на модерации');
      }

      review.status = ReviewStatus.APPROVED;
      review.approvedAt = new Date();
      review.moderatedBy = actor.adminId;
      const updated = await manager.save(OrderReview, review);

      // `userAgent` is typed `string` on the entity (the DB column is
      // nullable, but the TypeScript type was authored without the
      // `| null`). We pass `undefined` when missing so TypeORM stores
      // SQL NULL without tripping the strict TS overload.
      await manager.save(
        manager.create(AdminActivityLog, {
          adminId: actor.adminId,
          adminUsername: actor.adminUsername,
          action: AdminActivityType.REVIEW_APPROVE,
          metadata: { reviewId: id, orderId: review.orderId },
          ipAddress: actor.ip,
          userAgent: actor.userAgent,
        }),
      );

      this.logger.log(
        `Review ${id} approved by ${actor.adminUsername} (${actor.adminId})`,
      );
      return updated;
    });
  }

  /**
   * Move a pending review to `rejected`, store the optional reason,
   * and write an `AdminActivityType.REVIEW_REJECT` audit log entry,
   * atomically. Same exception contract as {@link approve}.
   */
  async reject(
    id: string,
    actor: ModeratorActor,
    reason?: string,
  ): Promise<OrderReview> {
    return this.dataSource.transaction(async (manager) => {
      const review = await manager.findOne(OrderReview, { where: { id } });
      if (!review) {
        throw new NotFoundException('Отзыв не найден');
      }
      if (review.status !== ReviewStatus.PENDING) {
        throw new ConflictException('Отзыв уже не в статусе на модерации');
      }

      review.status = ReviewStatus.REJECTED;
      review.rejectedAt = new Date();
      review.rejectionReason = reason ?? null;
      review.moderatedBy = actor.adminId;
      const updated = await manager.save(OrderReview, review);

      await manager.save(
        manager.create(AdminActivityLog, {
          adminId: actor.adminId,
          adminUsername: actor.adminUsername,
          action: AdminActivityType.REVIEW_REJECT,
          metadata: {
            reviewId: id,
            orderId: review.orderId,
            reason: reason ?? null,
          },
          ipAddress: actor.ip,
          userAgent: actor.userAgent,
        }),
      );

      this.logger.log(
        `Review ${id} rejected by ${actor.adminUsername} (${actor.adminId})`,
      );
      return updated;
    });
  }

  // ===================================================================
  // Internals
  // ===================================================================

  /**
   * Throws 429 if `ip` has already submitted ≥ THRESHOLD reviews
   * inside the rolling window. Implementation uses a single COUNT
   * query against the `(ip_address, created_at)` index — no Redis,
   * no in-process state, safe across multi-instance deploys.
   *
   * The `:ip::inet` cast in the WHERE clause matches the column type
   * (`inet`) and lets PG use the index. Without the cast PG would
   * coerce `r.ip_address` to text and lose index usage.
   */
  private async assertWithinRateLimit(ip: string): Promise<void> {
    const since = new Date(
      Date.now() - this.RATE_LIMIT_WINDOW_SECONDS * 1000,
    );
    const count = await this.reviewRepo
      .createQueryBuilder('r')
      .where('r.ip_address = :ip::inet', { ip })
      .andWhere('r.created_at > :since', { since })
      .getCount();

    if (count >= this.RATE_LIMIT_THRESHOLD) {
      throw new HttpException(
        'Слишком много заявок на отзыв',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Clamp `?limit=` to a sane range. Callers may pass a parsed number
   * or `undefined` — we treat NaN / negatives / zero as «use the
   * default» rather than silently returning an empty list.
   */
  private resolvePublicLimit(input?: number): number {
    if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
      return PUBLIC_LIST_DEFAULT_LIMIT;
    }
    return Math.min(Math.floor(input), PUBLIC_LIST_MAX_LIMIT);
  }

  /**
   * Map an internal entity to the privacy-safe public DTO. Anything
   * not whitelisted here MUST stay server-side.
   */
  private toPublicDto(r: OrderReview): PublicReviewDto {
    return {
      id: r.id,
      nickname: r.nickname,
      stars: r.stars,
      text: r.text,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
