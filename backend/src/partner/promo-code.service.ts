import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import * as crypto from 'crypto';

import { Partner, PartnerStatusEnum } from './entities/partner.entity';
import { PartnerPromoCode } from './entities/partner-promo-code.entity';
import {
  PartnerAuditLog,
  PartnerAuditActorType,
} from './entities/partner-audit-log.entity';

/**
 * Charset and length for auto-generated partner promo codes.
 *
 * Per Requirement 8.2 we constrain the alphabet to upper-case Latin
 * letters and digits. The chosen length of 8 gives 36^8 ≈ 2.8 * 10^12
 * possible codes — collision probability is negligible at any realistic
 * partner count, but we still retry up to MAX_GENERATION_ATTEMPTS on the
 * extremely rare DB-side unique-violation (Requirement 8.4) before
 * failing hard (Requirement 8.5).
 */
const PROMO_CODE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const PROMO_CODE_LENGTH = 8;
const MAX_GENERATION_ATTEMPTS = 10;

/** PostgreSQL SQLSTATE for `unique_violation` (see pg docs §A.1). */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * PromoCodeService
 *
 * Owns the lifecycle of `partner_promo_codes` rows:
 *
 *   - {@link generate}     — atomic rotation: deactivate any prior current
 *                             code for the partner, insert a fresh unique one.
 *   - {@link validate}     — checkout-time lookup; returns the partner and
 *                             rate snapshots, or throws if the code is
 *                             unknown / belongs to a disabled partner.
 *   - {@link regenerate}   — admin-driven rotation; same as `generate` but
 *                             additionally records an audit-log entry with
 *                             before/after code values (Requirement 17.2).
 *
 * Both rotations run inside `DataSource.transaction(...)` so the
 * "exactly one current code per partner" invariant cannot be violated
 * by interleaving operations or partial failures.
 */
@Injectable()
export class PromoCodeService {
  private readonly logger = new Logger(PromoCodeService.name);

  constructor(
    @InjectRepository(Partner)
    private readonly partnerRepo: Repository<Partner>,
    @InjectRepository(PartnerPromoCode)
    private readonly promoCodeRepo: Repository<PartnerPromoCode>,
    @InjectRepository(PartnerAuditLog)
    private readonly auditLogRepo: Repository<PartnerAuditLog>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {
    // Repos for PartnerAuditLog and PartnerPromoCode are kept on the instance
    // for read-only paths (e.g. `validate`); rotation paths use the
    // transactional EntityManager from DataSource.transaction.
    void this.auditLogRepo;
    void this.promoCodeRepo;
  }

  /**
   * Generates a single random `[A-Z0-9]` code of length `PROMO_CODE_LENGTH`,
   * sourcing entropy from `crypto.randomBytes` (CSPRNG).
   *
   * We sample one byte per output character and project it onto the
   * 36-symbol alphabet via modulo. The bias from `256 mod 36 = 4`
   * (chars index 0..3 are slightly more likely) is negligible for the
   * uniqueness use-case here — we are not generating cryptographic keys.
   */
  private generateCodeString(): string {
    const bytes = crypto.randomBytes(PROMO_CODE_LENGTH);
    let code = '';
    for (let i = 0; i < PROMO_CODE_LENGTH; i++) {
      code += PROMO_CODE_CHARSET[bytes[i] % PROMO_CODE_CHARSET.length];
    }
    return code;
  }

  /**
   * Extracts the underlying SQLSTATE from a TypeORM/pg error.
   *
   * TypeORM wraps driver errors in `QueryFailedError` and exposes the
   * original `pg` error on `.driverError`; some versions surface `.code`
   * directly on the wrapper. We probe both so the retry logic stays
   * portable across upgrades.
   */
  private extractDriverCode(err: unknown): string | undefined {
    const e = err as { driverError?: { code?: string }; code?: string };
    return e.driverError?.code ?? e.code;
  }

  /**
   * Inserts a fresh, unique `is_current=true` promo code for `partnerId`.
   * Retries up to `MAX_GENERATION_ATTEMPTS` times on PG unique-violation
   * collisions; any other DB error propagates immediately.
   *
   * Caller MUST run this inside a transaction and is responsible for
   * de-currenting any prior code(s) before invoking — otherwise the
   * "one current code per partner" invariant can momentarily break.
   *
   * @throws Error if all attempts collide (Requirement 8.5).
   */
  private async insertUniqueCode(
    manager: EntityManager,
    partnerId: string,
  ): Promise<PartnerPromoCode> {
    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
      const code = this.generateCodeString();
      const entity = manager.create(PartnerPromoCode, {
        partnerId,
        code,
        isCurrent: true,
      });
      try {
        return await manager.save(entity);
      } catch (err) {
        if (this.extractDriverCode(err) === PG_UNIQUE_VIOLATION) {
          this.logger.warn(
            `Promo code collision on attempt ${attempt}/${MAX_GENERATION_ATTEMPTS} ` +
              `for partner ${partnerId} (code=${code}); retrying.`,
          );
          continue;
        }
        throw err;
      }
    }
    throw new Error(
      `Failed to generate unique promo code after ${MAX_GENERATION_ATTEMPTS} attempts`,
    );
  }

  /**
   * Marks every existing `is_current=true` code for `partnerId` as inactive.
   * Idempotent — a no-op if the partner has no current code.
   */
  private async deactivateCurrent(
    manager: EntityManager,
    partnerId: string,
  ): Promise<void> {
    await manager.update(
      PartnerPromoCode,
      { partnerId, isCurrent: true },
      { isCurrent: false },
    );
  }

  /**
   * Generates and persists a new current promo code for the given partner.
   *
   * The rotation (deactivate previous current code → insert new current
   * code) runs inside a single DB transaction, so concurrent callers
   * cannot leave the partner with zero or two `is_current=true` rows.
   *
   * @returns the newly inserted {@link PartnerPromoCode} entity.
   * @throws Error after {@link MAX_GENERATION_ATTEMPTS} unique-violation collisions.
   */
  async generate(partnerId: string): Promise<PartnerPromoCode> {
    return this.dataSource.transaction(async (manager) => {
      await this.deactivateCurrent(manager, partnerId);
      return this.insertUniqueCode(manager, partnerId);
    });
  }

  /**
   * Resolves a checkout-time promo code to its owning partner and
   * snapshot rate values.
   *
   * Decimal columns are returned as strings by the `pg` driver; we
   * coerce to `number` so the caller can use them directly in price
   * arithmetic without surprise concatenation.
   *
   * @throws NotFoundException — code does not exist or is no longer current.
   * @throws BadRequestException — owning partner has status `disabled`
   *   (Requirement 9.4).
   */
  async validate(code: string): Promise<{
    partner: Partner;
    discountRate: number;
    commissionRate: number;
  }> {
    const promo = await this.promoCodeRepo.findOne({
      where: { code, isCurrent: true },
    });
    if (!promo) {
      throw new NotFoundException('Промокод не найден');
    }

    const partner = await this.partnerRepo.findOne({
      where: { id: promo.partnerId },
    });
    if (!partner) {
      // Defensive: should be unreachable while FKs are intact, but a
      // dangling promo code row is treated as "not found" rather than
      // a server error so checkout fails gracefully.
      throw new NotFoundException('Промокод не найден');
    }

    if (partner.status === PartnerStatusEnum.DISABLED) {
      throw new BadRequestException('Промокод неактивен');
    }

    return {
      partner,
      discountRate: Number(partner.discountRate),
      commissionRate: Number(partner.commissionRate),
    };
  }

  /**
   * Admin-driven rotation: same atomicity guarantees as {@link generate},
   * plus an audit-log row capturing the previous and new code values
   * (Requirement 17.2).
   *
   * @param actorAdminId  id of the admin performing the rotation, or
   *   `null` for automated/system flows. Stored verbatim in
   *   `partner_audit_log.actor_id`.
   */
  async regenerate(
    partnerId: string,
    actorAdminId: string | null,
  ): Promise<PartnerPromoCode> {
    return this.dataSource.transaction(async (manager) => {
      const previous = await manager.findOne(PartnerPromoCode, {
        where: { partnerId, isCurrent: true },
      });

      await this.deactivateCurrent(manager, partnerId);
      const fresh = await this.insertUniqueCode(manager, partnerId);

      const auditEntry = manager.create(PartnerAuditLog, {
        entityType: 'partner',
        entityId: partnerId,
        action: 'code_regenerated',
        actorType: PartnerAuditActorType.ADMIN,
        actorId: actorAdminId,
        oldValue: previous ? { code: previous.code } : null,
        newValue: { code: fresh.code },
      });
      await manager.save(auditEntry);

      this.logger.log(
        `Regenerated promo code for partner ${partnerId}: ` +
          `${previous?.code ?? '(none)'} → ${fresh.code} ` +
          `(actor=${actorAdminId ?? 'system'})`,
      );

      return fresh;
    });
  }
}
