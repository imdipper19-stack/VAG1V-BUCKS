import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import * as crypto from 'node:crypto';

import { Partner, PartnerStatusEnum } from './entities/partner.entity';
import { PartnerPromoCode } from './entities/partner-promo-code.entity';
import {
  CommissionEntry,
  CommissionEntryStatus,
} from './entities/commission-entry.entity';
import {
  PayoutRequest,
  PayoutRequestStatus,
} from './entities/payout-request.entity';
import {
  PartnerAuditActorType,
  PartnerAuditLog,
} from './entities/partner-audit-log.entity';
import { PromoCodeService } from './promo-code.service';
import { PartnerAuthService } from './partner-auth.service';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { UpdatePartnerDto } from './dto/update-partner.dto';

/**
 * Result of a successful {@link PartnerService.create} call. Mirrors
 * `ApproveApplicationResult` from {@link PartnerApplicationService} so
 * admin UIs can render the same "copy invite link" + "copy promo code"
 * flow regardless of which entry path produced the partner.
 */
export interface CreatePartnerResult {
  partner: Partner;
  promoCode: string;
  inviteToken: string;
}

/**
 * Aggregated stats returned by {@link PartnerService.getStats}. All
 * money fields are returned as `number` (not the raw `string`s pg
 * delivers for `decimal` columns) so the controller can pass them to
 * `JSON.stringify` without producing string-typed amounts that confuse
 * the frontend's price arithmetic.
 *
 * The exact set of fields satisfies Requirement 15.2 (admin partner
 * detail screen) while also giving {@link PartnerService.list} cheap
 * per-partner balance/totals for the list view.
 */
export interface PartnerStats {
  partnerBalance: number;
  pendingBalance: number;
  totalEarned: number;
  totalPaid: number;
  totalOrders: number;
  pendingOrders: number;
  approvedOrders: number;
  cancelledOrders: number;
  currentPromoCode: string | null;
}

/** Single row returned by {@link PartnerService.list} for the admin grid. */
export type PartnerListItem = Partner & {
  currentPromoCode: string | null;
  partnerBalance: number;
  totalEarned: number;
};

/** PostgreSQL SQLSTATE for `unique_violation` (see pg docs §A.1). */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Maximum length of the sanitised stem of a derived username, before
 * the random suffix is appended. The cabinet `username` column tops
 * out at 64 chars; we reserve 5 chars for the separator plus 4 hex
 * chars of the collision-avoidance suffix. Mirrors the constant in
 * {@link PartnerApplicationService} so both creation paths produce
 * usernames of the same shape.
 */
const DERIVED_USERNAME_STEM_MAX = 59;

/** Number of attempts to derive a unique username before giving up. */
const USERNAME_DERIVATION_ATTEMPTS = 5;

/**
 * Tiny Cyrillic→Latin transliteration map used by the username
 * deriver. Kept in lock-step with
 * {@link PartnerApplicationService}'s copy — the two creation paths
 * (auto-approval and manual creation) intentionally produce
 * indistinguishable usernames.
 */
const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh',
  з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu',
  я: 'ya',
};

/**
 * PartnerService
 *
 * Owns the admin-facing lifecycle of `partners` rows that does NOT
 * originate from the public application form (the
 * application→partner path lives in
 * {@link PartnerApplicationService}). Concretely:
 *
 *   - {@link create}                 — manual partner creation by the
 *                                      Owner (Requirement 6.1–6.3),
 *                                      with optional explicit promo
 *                                      code and auto-derived username.
 *   - {@link list}                   — admin-grid listing with current
 *                                      promo code, balance, and total
 *                                      earned per partner.
 *   - {@link getById}                — admin-side detail read.
 *   - {@link updateRates}            — partial update of rates and/or
 *                                      status with the Requirement
 *                                      7.7–7.8 cross-field check.
 *   - {@link toggleStatus}           — convenience flip between
 *                                      `active` and `disabled` statuses
 *                                      (Requirement 7.4).
 *   - {@link getStats}               — aggregated balance/earned/paid
 *                                      figures for one partner
 *                                      (Requirement 15.2, 16.3).
 *   - {@link regenerateInviteToken}  — admin-driven re-issue of the
 *                                      invite link when the original
 *                                      was lost or expired.
 *
 * Why a separate service from {@link PartnerApplicationService}?
 * The application path bundles application bookkeeping (status flip,
 * reviewer audit, partial-failure recovery rules) that the manual
 * path doesn't need. Splitting them keeps each surface small and the
 * audit payloads honest about their origin
 * (`partner_created_manually` vs `application_approved`).
 */
@Injectable()
export class PartnerService {
  private readonly logger = new Logger(PartnerService.name);

  constructor(
    @InjectRepository(Partner)
    private readonly partnerRepo: Repository<Partner>,
    @InjectRepository(PartnerPromoCode)
    private readonly promoCodeRepo: Repository<PartnerPromoCode>,
    @InjectRepository(CommissionEntry)
    private readonly commissionRepo: Repository<CommissionEntry>,
    @InjectRepository(PayoutRequest)
    private readonly payoutRepo: Repository<PayoutRequest>,
    @InjectRepository(PartnerAuditLog)
    private readonly auditRepo: Repository<PartnerAuditLog>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly promoCodeService: PromoCodeService,
    private readonly partnerAuthService: PartnerAuthService,
  ) {
    // Audit repo is used inside the rates/status/regenerate paths via
    // its instance reference; declared so InjectRepository wiring is
    // explicit and the linter doesn't flag the field as unused.
    void this.auditRepo;
  }

  // ─── manual creation ─────────────────────────────────────────────────

  /**
   * Creates a Partner row from an admin-supplied DTO without going
   * through the application flow.
   *
   * Sequencing rationale (mirrors
   * {@link PartnerApplicationService.approve}):
   *   1. Cross-field rate check happens FIRST so a bad payload cannot
   *      cause any DB writes.
   *   2. Optional custom promo code uniqueness is checked before the
   *      transaction so we fail fast with a stable Russian message
   *      (Requirement 6.3); the DB unique constraint still catches
   *      the race inside the transaction.
   *   3. Inside one DB transaction: derive a unique username, insert
   *      the partner, optionally insert the custom promo code, write
   *      the audit log entry. All-or-nothing.
   *   4. After commit: auto-generate a promo code (if no custom one
   *      was supplied) and issue an invite token. Each follow-up runs
   *      its own transaction; a failure here leaves the partner
   *      without one of those artifacts, which the admin recovers
   *      from via the existing regenerate-code / regenerate-invite
   *      admin actions.
   *
   * @throws BadRequestException — `discountRate + commissionRate > 1.0`
   *   (Requirement 7.8 applied at creation time).
   * @throws ConflictException — supplied custom promo code is already
   *   taken (Requirement 6.3) or username collision could not be
   *   resolved.
   */
  async create(
    dto: CreatePartnerDto,
    adminId: string,
  ): Promise<CreatePartnerResult> {
    if (dto.discountRate + dto.commissionRate > 1) {
      throw new BadRequestException(
        'Сумма Discount_Rate и Commission_Rate не должна превышать 1.0',
      );
    }

    // Pre-flight uniqueness check. A second check inside the
    // transaction is implicit via the DB unique constraint, which
    // would catch a concurrent race; on conflict we re-map the
    // driver error to the same ConflictException below.
    if (dto.promoCode) {
      const existing = await this.promoCodeRepo.findOne({
        where: { code: dto.promoCode },
      });
      if (existing) {
        throw new ConflictException('Промокод уже занят');
      }
    }

    const { partner, customPromoCode } = await this.dataSource.transaction(
      async (manager): Promise<{
        partner: Partner;
        customPromoCode: string | null;
      }> => {
        const username = await this.deriveUniqueUsername(
          manager,
          dto.username,
          dto.displayName,
        );

        const partnerEntity = manager.create(Partner, {
          username,
          // Empty hash forces the partner through the invite-link
          // flow: PartnerAuthService.verifyPassword() returns false
          // for any stored value lacking ':'.
          passwordHash: '',
          displayName: dto.displayName,
          contactTg: dto.contactTg,
          discountRate: dto.discountRate,
          commissionRate: dto.commissionRate,
          status: PartnerStatusEnum.ACTIVE,
          applicationId: null,
        });
        const savedPartner = await manager.save(partnerEntity);

        let customCode: string | null = null;
        if (dto.promoCode) {
          customCode = await this.insertCustomPromoCode(
            manager,
            savedPartner.id,
            dto.promoCode,
          );
        }

        await manager.save(
          manager.create(PartnerAuditLog, {
            entityType: 'partner',
            entityId: savedPartner.id,
            action: 'partner_created_manually',
            actorType: PartnerAuditActorType.ADMIN,
            actorId: adminId,
            oldValue: null,
            newValue: {
              id: savedPartner.id,
              username: savedPartner.username,
              displayName: savedPartner.displayName,
              discountRate: dto.discountRate,
              commissionRate: dto.commissionRate,
              ...(customCode ? { promoCode: customCode } : {}),
            },
          }),
        );

        return { partner: savedPartner, customPromoCode: customCode };
      },
    );

    // Post-commit: auto-generate promo code (when no custom one was
    // supplied) and issue the invite token.
    let promoCode: string;
    if (customPromoCode) {
      promoCode = customPromoCode;
    } else {
      const generated = await this.promoCodeService.generate(partner.id);
      promoCode = generated.code;
    }

    const inviteToken = await this.partnerAuthService.generateInviteToken(
      partner.id,
    );

    this.logger.log(
      `Partner ${partner.id} created manually by admin ${adminId}: ` +
        `username=${partner.username} promo=${promoCode} ` +
        `(custom=${Boolean(customPromoCode)})`,
    );

    return { partner, promoCode, inviteToken };
  }

  // ─── reads ───────────────────────────────────────────────────────────

  /**
   * Lists all partners (newest first) augmented with the current promo
   * code and the two balance fields the admin grid needs at a glance.
   *
   * Implementation note: the per-partner stats lookup is run via
   * `Promise.all` against {@link getStats}. For an admin-only list
   * with a small population (≤ ~100 partners is the realistic upper
   * bound for a single shop) the simpler N+1 query is acceptable, and
   * keeps the code easy to follow. If the partner count grows, this
   * is the obvious place to swap for a single grouped aggregation.
   */
  async list(): Promise<PartnerListItem[]> {
    const partners = await this.partnerRepo.find({
      order: { createdAt: 'DESC' },
    });
    if (partners.length === 0) return [];

    // TODO: collapse the per-partner stat lookups into a single
    // grouped query (commission_entries + payout_requests +
    // partner_promo_codes joined per partner_id) once the partner
    // population grows beyond ~100 rows.
    const stats = await Promise.all(
      partners.map((p) => this.getStats(p.id)),
    );

    return partners.map((p, i) => ({
      ...p,
      currentPromoCode: stats[i].currentPromoCode,
      partnerBalance: stats[i].partnerBalance,
      totalEarned: stats[i].totalEarned,
    }));
  }

  /**
   * Loads a single partner by id. Throws {@link NotFoundException}
   * with a Russian message suitable for direct surfacing to the admin
   * UI when no row matches.
   */
  async getById(id: string): Promise<Partner> {
    const partner = await this.partnerRepo.findOne({ where: { id } });
    if (!partner) {
      throw new NotFoundException('Партнёр не найден');
    }
    return partner;
  }

  // ─── rate / status updates ───────────────────────────────────────────

  /**
   * Partial update of `discount_rate`, `commission_rate`, and/or
   * `status`. Validates the cross-field rate sum before saving
   * (Requirement 7.7–7.8) using the *resulting* values — i.e. an
   * unchanged field is taken from the stored partner row, so an admin
   * editing only one rate cannot inadvertently violate the constraint
   * by leaving the other rate at a high value.
   *
   * Per-field range checks (`[0, 1]`) live on
   * {@link UpdatePartnerDto}; this method assumes the global
   * ValidationPipe ran first.
   *
   * @throws NotFoundException — partner id does not exist.
   * @throws BadRequestException — `newDiscount + newCommission > 1.0`.
   */
  async updateRates(
    id: string,
    dto: UpdatePartnerDto,
    adminId: string,
  ): Promise<Partner> {
    const partner = await this.getById(id);

    // pg returns DECIMAL columns as strings; coerce before arithmetic.
    const currentDiscount = Number(partner.discountRate);
    const currentCommission = Number(partner.commissionRate);

    const newDiscount = dto.discountRate ?? currentDiscount;
    const newCommission = dto.commissionRate ?? currentCommission;

    if (newDiscount + newCommission > 1) {
      throw new BadRequestException(
        'Сумма Discount_Rate и Commission_Rate не должна превышать 1.0',
      );
    }

    const oldStatus = partner.status;
    const newStatus = dto.status ?? oldStatus;

    // Only persist what actually changed. Saving the entity wholesale
    // would also touch unrelated columns, which makes audit log
    // reasoning unnecessarily noisy for downstream readers.
    if (dto.discountRate !== undefined) partner.discountRate = newDiscount;
    if (dto.commissionRate !== undefined) partner.commissionRate = newCommission;
    if (dto.status !== undefined) partner.status = newStatus;

    const saved = await this.partnerRepo.save(partner);

    await this.auditRepo.save(
      this.auditRepo.create({
        entityType: 'partner',
        entityId: saved.id,
        action: 'rates_updated',
        actorType: PartnerAuditActorType.ADMIN,
        actorId: adminId,
        oldValue: {
          discountRate: currentDiscount,
          commissionRate: currentCommission,
          status: oldStatus,
        },
        newValue: {
          discountRate: newDiscount,
          commissionRate: newCommission,
          status: newStatus,
        },
      }),
    );

    this.logger.log(
      `Partner ${id} updated by admin ${adminId}: ` +
        `discount=${currentDiscount}→${newDiscount} ` +
        `commission=${currentCommission}→${newCommission} ` +
        `status=${oldStatus}→${newStatus}`,
    );

    return saved;
  }

  /**
   * Flips Partner_Status between `active` and `disabled`
   * (Requirement 7.4). Existing balances are preserved — only new
   * Commission_Entry creations and promo-code validations are
   * affected by the flag, per Requirement 9.4 / 16.7.
   */
  async toggleStatus(id: string, adminId: string): Promise<Partner> {
    const partner = await this.getById(id);

    const oldStatus = partner.status;
    const newStatus =
      oldStatus === PartnerStatusEnum.ACTIVE
        ? PartnerStatusEnum.DISABLED
        : PartnerStatusEnum.ACTIVE;

    partner.status = newStatus;
    const saved = await this.partnerRepo.save(partner);

    await this.auditRepo.save(
      this.auditRepo.create({
        entityType: 'partner',
        entityId: saved.id,
        action: 'status_changed',
        actorType: PartnerAuditActorType.ADMIN,
        actorId: adminId,
        oldValue: { status: oldStatus },
        newValue: { status: newStatus },
      }),
    );

    this.logger.log(
      `Partner ${id} status toggled by admin ${adminId}: ` +
        `${oldStatus} → ${newStatus}`,
    );

    return saved;
  }

  // ─── stats ───────────────────────────────────────────────────────────

  /**
   * Aggregates a partner's commission and payout figures into the
   * {@link PartnerStats} shape used by both the admin detail page
   * (Requirement 15.2) and the partner cabinet dashboard
   * (Requirement 12.1).
   *
   * Money math (Requirement 16.3):
   * ```
   *   totalEarned        = SUM(commission.amount)  WHERE status='approved'
   *   pendingBalance     = SUM(commission.amount)  WHERE status='pending'
   *   totalPaid          = SUM(payout.amount)      WHERE status='paid'
   *   outstandingPayouts = SUM(payout.amount)      WHERE status IN
   *                        ('requested','processing')
   *   partnerBalance     = totalEarned - totalPaid - outstandingPayouts
   * ```
   *
   * Decimal columns come back from `pg` as strings; we coerce every
   * aggregation result via {@link sumOrZero} so callers get plain
   * `number`s.
   */
  async getStats(id: string): Promise<PartnerStats> {
    // Run the four sums and the four count buckets in parallel — none
    // of them depend on each other and we don't need a snapshot
    // isolation guarantee across them (the partner's stats screen is
    // a best-effort point-in-time read).
    const [
      totalEarnedRaw,
      pendingBalanceRaw,
      totalPaidRaw,
      outstandingPayoutsRaw,
      orderCounts,
      currentCode,
    ] = await Promise.all([
      this.commissionRepo
        .createQueryBuilder('c')
        .select('COALESCE(SUM(c.amount), 0)', 'sum')
        .where('c.partner_id = :id', { id })
        .andWhere('c.status = :s', { s: CommissionEntryStatus.APPROVED })
        .getRawOne<{ sum: string | number | null }>(),
      this.commissionRepo
        .createQueryBuilder('c')
        .select('COALESCE(SUM(c.amount), 0)', 'sum')
        .where('c.partner_id = :id', { id })
        .andWhere('c.status = :s', { s: CommissionEntryStatus.PENDING })
        .getRawOne<{ sum: string | number | null }>(),
      this.payoutRepo
        .createQueryBuilder('p')
        .select('COALESCE(SUM(p.amount), 0)', 'sum')
        .where('p.partner_id = :id', { id })
        .andWhere('p.status = :s', { s: PayoutRequestStatus.PAID })
        .getRawOne<{ sum: string | number | null }>(),
      this.payoutRepo
        .createQueryBuilder('p')
        .select('COALESCE(SUM(p.amount), 0)', 'sum')
        .where('p.partner_id = :id', { id })
        .andWhere('p.status IN (:...statuses)', {
          statuses: [
            PayoutRequestStatus.REQUESTED,
            PayoutRequestStatus.PROCESSING,
          ],
        })
        .getRawOne<{ sum: string | number | null }>(),
      // Single grouped query for the four order-count buckets so we
      // hit `commission_entries` exactly once for counting.
      this.commissionRepo
        .createQueryBuilder('c')
        .select('c.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .where('c.partner_id = :id', { id })
        .groupBy('c.status')
        .getRawMany<{ status: CommissionEntryStatus; count: string | number }>(),
      this.promoCodeRepo.findOne({
        where: { partnerId: id, isCurrent: true },
      }),
    ]);

    const totalEarned = this.sumOrZero(totalEarnedRaw);
    const pendingBalance = this.sumOrZero(pendingBalanceRaw);
    const totalPaid = this.sumOrZero(totalPaidRaw);
    const outstandingPayouts = this.sumOrZero(outstandingPayoutsRaw);

    // Bucket the grouped counts into a small map, defaulting absent
    // statuses to 0 so the response shape is stable.
    const counts = {
      [CommissionEntryStatus.PENDING]: 0,
      [CommissionEntryStatus.APPROVED]: 0,
      [CommissionEntryStatus.CANCELLED]: 0,
    };
    for (const row of orderCounts) {
      counts[row.status] = Number(row.count) || 0;
    }
    const totalOrders =
      counts[CommissionEntryStatus.PENDING] +
      counts[CommissionEntryStatus.APPROVED] +
      counts[CommissionEntryStatus.CANCELLED];

    // Requirement 16.3 / 16.4: balance is computed dynamically and is
    // always non-negative as long as PayoutService rejects requests
    // with `amount > balance` at creation time.
    const partnerBalance = totalEarned - totalPaid - outstandingPayouts;

    return {
      partnerBalance,
      pendingBalance,
      totalEarned,
      totalPaid,
      totalOrders,
      pendingOrders: counts[CommissionEntryStatus.PENDING],
      approvedOrders: counts[CommissionEntryStatus.APPROVED],
      cancelledOrders: counts[CommissionEntryStatus.CANCELLED],
      currentPromoCode: currentCode?.code ?? null,
    };
  }

  // ─── invite-link regeneration ────────────────────────────────────────

  /**
   * Re-issues the partner's invite token so the admin can ship a
   * fresh `/partner/invite?token=…` link if the original was lost or
   * expired. Overwrites any existing token by virtue of
   * {@link PartnerAuthService.generateInviteToken}'s update semantics
   * (Requirement 11.2 — we always have a way to recover access).
   *
   * @throws NotFoundException — partner id does not exist.
   */
  async regenerateInviteToken(
    id: string,
    adminId: string,
  ): Promise<{ inviteToken: string }> {
    const partner = await this.getById(id);
    const inviteToken = await this.partnerAuthService.generateInviteToken(
      partner.id,
    );

    await this.auditRepo.save(
      this.auditRepo.create({
        entityType: 'partner',
        entityId: partner.id,
        action: 'invite_regenerated',
        actorType: PartnerAuditActorType.ADMIN,
        actorId: adminId,
        oldValue: null,
        newValue: { regeneratedAt: new Date().toISOString() },
      }),
    );

    this.logger.log(
      `Invite token regenerated for partner ${partner.id} by admin ${adminId}`,
    );

    return { inviteToken };
  }

  // ─── helpers ─────────────────────────────────────────────────────────

  /**
   * Coerces a raw aggregation result (`{ sum: '12.34' | 12.34 | null }`)
   * to a plain `number`. The pg driver returns DECIMAL columns as
   * strings; `Number('')` and `Number(null)` both yield 0 and we
   * normalise both via the nullish-coalescing default for clarity.
   */
  private sumOrZero(raw: { sum: string | number | null } | undefined): number {
    if (!raw) return 0;
    const value = raw.sum ?? 0;
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  /**
   * Inserts an admin-supplied promo code as the partner's current
   * code. Translates a PG unique-violation into the user-facing
   * `Промокод уже занят` ConflictException so a race against another
   * admin assigning the same code surfaces a clean error
   * (Requirement 6.3).
   */
  private async insertCustomPromoCode(
    manager: EntityManager,
    partnerId: string,
    code: string,
  ): Promise<string> {
    try {
      const entity = manager.create(PartnerPromoCode, {
        partnerId,
        code,
        isCurrent: true,
      });
      const saved = await manager.save(entity);
      return saved.code;
    } catch (err) {
      const driverCode =
        (err as { driverError?: { code?: string }; code?: string }).driverError
          ?.code ?? (err as { code?: string }).code;
      if (driverCode === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('Промокод уже занят');
      }
      throw err;
    }
  }

  /**
   * Resolves the username for a new Partner. Either trusts the
   * explicit `explicit` value (after a uniqueness pre-check) or
   * derives one from `displayName` via {@link deriveUsername},
   * retrying with fresh suffixes on collision.
   *
   * Mirrors {@link PartnerApplicationService.deriveUniqueUsername} so
   * both creation paths produce indistinguishable usernames; if you
   * change the algorithm here, update the application-side copy too.
   */
  private async deriveUniqueUsername(
    manager: EntityManager,
    explicit: string | undefined,
    displayName: string,
  ): Promise<string> {
    if (explicit) {
      const existing = await manager.findOne(Partner, {
        where: { username: explicit },
      });
      if (existing) {
        throw new ConflictException('Username уже занят');
      }
      return explicit;
    }

    for (let i = 0; i < USERNAME_DERIVATION_ATTEMPTS; i++) {
      const candidate = this.deriveUsername(displayName);
      const existing = await manager.findOne(Partner, {
        where: { username: candidate },
      });
      if (!existing) return candidate;
    }
    throw new ConflictException(
      'Не удалось подобрать уникальный username — укажите его вручную',
    );
  }

  /**
   * Builds a candidate username from a free-form display name. See
   * {@link PartnerApplicationService.deriveUsername} for the
   * step-by-step algorithm — both copies stay byte-identical so the
   * two creation paths cannot diverge.
   */
  private deriveUsername(displayName: string): string {
    const lower = displayName.toLowerCase();
    let translit = '';
    for (const char of lower) {
      translit += CYRILLIC_TO_LATIN[char] ?? char;
    }
    let stem = translit.replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-');
    stem = stem.replace(/^-+|-+$/g, '');
    if (stem.length === 0) stem = 'partner';
    if (stem.length > DERIVED_USERNAME_STEM_MAX) {
      stem = stem.slice(0, DERIVED_USERNAME_STEM_MAX);
    }
    const suffix = crypto.randomBytes(2).toString('hex'); // 4 hex chars
    return `${stem}-${suffix}`;
  }
}
