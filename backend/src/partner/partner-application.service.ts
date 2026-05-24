import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import * as crypto from 'node:crypto';

import {
  PartnerApplication,
  PartnerApplicationStatus,
} from './entities/partner-application.entity';
import { Partner, PartnerStatusEnum } from './entities/partner.entity';
import { PartnerPromoCode } from './entities/partner-promo-code.entity';
import {
  PartnerAuditLog,
  PartnerAuditActorType,
} from './entities/partner-audit-log.entity';
import { PromoCodeService } from './promo-code.service';
import { PartnerAuthService } from './partner-auth.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { ApproveApplicationDto } from './dto/approve-application.dto';

/**
 * Result of a successful {@link PartnerApplicationService.approve} call.
 * `inviteToken` is the raw token string — admin UI formats it as
 * `/partner/invite?token=<token>` and copies the URL into Telegram for
 * the partner.
 */
export interface ApproveApplicationResult {
  partner: Partner;
  promoCode: string;
  inviteToken: string;
}

/** PostgreSQL SQLSTATE for `unique_violation` (see pg docs §A.1). */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Maximum length of the sanitised stem of a derived username, before
 * the random suffix is appended. The cabinet `username` column tops out
 * at 64 chars (see partner.entity.ts); we reserve 5 chars for the
 * separator plus 4 hex chars of the collision-avoidance suffix.
 */
const DERIVED_USERNAME_STEM_MAX = 59;

/** Number of attempts to derive a unique username before giving up. */
const USERNAME_DERIVATION_ATTEMPTS = 5;

/**
 * Tiny Cyrillic→Latin transliteration map covering the letters most
 * commonly used in Russian-language display names. We do not aim for
 * a strict GOST or BGN/PCGN transliteration — the goal is just to
 * produce a memorable `[a-z0-9_-]` username from a Russian display
 * name. Anything outside this map falls through to the regex stripper
 * downstream.
 */
const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh',
  з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu',
  я: 'ya',
};

/**
 * PartnerApplicationService
 *
 * Owns the partner_applications table lifecycle:
 *
 *   - {@link submit}   — accepts a public form payload and stores it
 *                         with `status='pending'` (Requirement 4.5).
 *   - {@link list}     — admin-side listing with optional status filter
 *                         (Requirement 5.2).
 *   - {@link getById}  — admin-side detail read.
 *   - {@link approve}  — pending → approved transition: creates a
 *                         Partner row, generates a promo code (random or
 *                         admin-supplied), generates an invite token,
 *                         writes audit log (Requirement 5.5, 17.1).
 *   - {@link reject}   — pending → rejected transition + audit log
 *                         (Requirement 5.6, 17.1).
 *
 * Both terminal transitions raise `ConflictException` if the
 * application is not in `pending` (Requirement 5.7).
 *
 * Transaction strategy on approve(): the partner-row + application-row
 * + (optional) custom-promo-code insert are wrapped in one DataSource
 * transaction so a partial failure cannot leave a half-approved state.
 * The auto-generated promo code path and the invite-token write happen
 * AFTER commit because each of those services already runs its own
 * transaction; nesting would either silently pass-through (savepoint)
 * or break (depending on driver). Both follow-up calls touch only the
 * brand-new partner row, so an admin retry (`regenerate-code` /
 * `invite-link`) trivially recovers from a post-commit failure.
 */
@Injectable()
export class PartnerApplicationService {
  private readonly logger = new Logger(PartnerApplicationService.name);

  constructor(
    @InjectRepository(PartnerApplication)
    private readonly applicationRepo: Repository<PartnerApplication>,
    @InjectRepository(Partner)
    private readonly partnerRepo: Repository<Partner>,
    @InjectRepository(PartnerPromoCode)
    private readonly promoCodeRepo: Repository<PartnerPromoCode>,
    @InjectRepository(PartnerAuditLog)
    private readonly auditLogRepo: Repository<PartnerAuditLog>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly promoCodeService: PromoCodeService,
    private readonly partnerAuthService: PartnerAuthService,
  ) {
    // Repos are kept on the instance for read paths and post-commit
    // writes; the transactional path (`approve`) uses the EntityManager
    // it receives from `dataSource.transaction(...)`.
    void this.promoCodeRepo;
    void this.auditLogRepo;
  }

  // ─── public submission ───────────────────────────────────────────────

  /**
   * Persists a new partner application as `status='pending'`. The
   * controller is expected to have already passed the payload through
   * the global ValidationPipe + {@link CreateApplicationDto}, so we
   * trust the field shapes here.
   */
  async submit(dto: CreateApplicationDto): Promise<PartnerApplication> {
    const entity = this.applicationRepo.create({
      displayName: dto.displayName,
      platformType: dto.platformType,
      platformUrl: dto.platformUrl,
      audienceSize: dto.audienceSize,
      contactTg: dto.contactTg,
      description: dto.description,
      status: PartnerApplicationStatus.PENDING,
    });
    const saved = await this.applicationRepo.save(entity);
    this.logger.log(
      `Partner application submitted: id=${saved.id} ` +
        `displayName="${saved.displayName}" platform=${saved.platformType}`,
    );
    return saved;
  }

  // ─── admin reads ─────────────────────────────────────────────────────

  /**
   * Lists applications, newest first. Optional status filter supports
   * the admin-side tab UI (`pending` / `approved` / `rejected`).
   */
  async list(
    filters: { status?: PartnerApplicationStatus } = {},
  ): Promise<PartnerApplication[]> {
    const where = filters.status ? { status: filters.status } : {};
    return this.applicationRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Loads a single application by id. Throws {@link NotFoundException}
   * with a Russian message suitable for direct surfacing to the admin
   * UI when no row matches.
   */
  async getById(id: string): Promise<PartnerApplication> {
    const application = await this.applicationRepo.findOne({ where: { id } });
    if (!application) {
      throw new NotFoundException('Заявка не найдена');
    }
    return application;
  }

  // ─── admin approve / reject ──────────────────────────────────────────

  /**
   * Approves a pending application: creates the Partner row, generates
   * (or accepts a custom) promo code, issues an invite token, and
   * records audit-log entries.
   *
   * @throws NotFoundException — application id does not exist.
   * @throws ConflictException — application is no longer `pending`
   *   (Requirement 5.7), or a supplied custom promo code is already taken.
   * @throws BadRequestException — `discountRate + commissionRate > 1.0`
   *   (Requirement 7.8 applied at approval time).
   */
  async approve(
    id: string,
    adminId: string,
    params: ApproveApplicationDto,
  ): Promise<ApproveApplicationResult> {
    const application = await this.getById(id);
    this.assertPending(application, 'approve');

    // Cross-field rate check — see ApproveApplicationDto for why this
    // is not a class-validator decorator.
    if (params.discountRate + params.commissionRate > 1) {
      throw new BadRequestException(
        'Сумма Discount_Rate и Commission_Rate не должна превышать 1.0',
      );
    }

    // Custom promo code uniqueness is checked OUTSIDE the transaction
    // because we want to fail fast with a stable message before doing
    // any writes. A second check inside the transaction is implicit via
    // the DB unique constraint, which would catch a race; on conflict
    // we re-map the driver error to ConflictException below.
    if (params.promoCode) {
      const existing = await this.promoCodeRepo.findOne({
        where: { code: params.promoCode },
      });
      if (existing) {
        throw new ConflictException('Промокод уже занят');
      }
    }

    // ── transactional core: partner + application + (optional) custom
    //    promo code + audit log are all-or-nothing. Auto-generated
    //    promo code and invite token are issued after commit (see class
    //    comment).
    const { partner, customPromoCode } = await this.dataSource.transaction(
      async (manager): Promise<{ partner: Partner; customPromoCode: string | null }> => {
        const username = await this.deriveUniqueUsername(
          manager,
          params.username,
          application.displayName,
        );

        const partnerEntity = manager.create(Partner, {
          username,
          // Empty hash forces the partner through the invite-link flow:
          // PartnerAuthService.verifyPassword() returns false for any
          // stored value lacking ':', so login is impossible until the
          // invite is consumed and a real bcrypt-style hash is written.
          passwordHash: '',
          displayName: application.displayName,
          contactTg: application.contactTg,
          discountRate: params.discountRate,
          commissionRate: params.commissionRate,
          status: PartnerStatusEnum.ACTIVE,
          applicationId: application.id,
        });
        const savedPartner = await manager.save(partnerEntity);

        // Backfill the application: status + reviewer + partner_id.
        await manager.update(
          PartnerApplication,
          { id: application.id },
          {
            status: PartnerApplicationStatus.APPROVED,
            reviewedBy: adminId,
            reviewedAt: new Date(),
            partnerId: savedPartner.id,
          },
        );

        let customCode: string | null = null;
        if (params.promoCode) {
          customCode = await this.insertCustomPromoCode(
            manager,
            savedPartner.id,
            params.promoCode,
          );

          // Audit row for the manual code creation. Auto-generated
          // codes get an audit entry written by PromoCodeService
          // implicitly via `regenerate`; for `generate` (the first
          // code) there's no audit, but the approval audit below
          // captures the new partner anyway.
          await manager.save(
            manager.create(PartnerAuditLog, {
              entityType: 'partner',
              entityId: savedPartner.id,
              action: 'code_assigned',
              actorType: PartnerAuditActorType.ADMIN,
              actorId: adminId,
              oldValue: null,
              newValue: { code: customCode },
            }),
          );
        }

        // Approval audit row — captures the application transition and
        // the rate snapshots used to materialise the partner.
        await manager.save(
          manager.create(PartnerAuditLog, {
            entityType: 'application',
            entityId: application.id,
            action: 'approved',
            actorType: PartnerAuditActorType.ADMIN,
            actorId: adminId,
            oldValue: { status: PartnerApplicationStatus.PENDING },
            newValue: {
              status: PartnerApplicationStatus.APPROVED,
              partnerId: savedPartner.id,
              discountRate: params.discountRate,
              commissionRate: params.commissionRate,
            },
          }),
        );

        return { partner: savedPartner, customPromoCode: customCode };
      },
    );

    // Post-commit: generate auto promo code (if no custom one was
    // provided) and issue the invite token. Each call runs its own
    // transaction; failure here leaves the partner without a code or
    // invite link, which the admin can fix via the regenerate-code /
    // invite-link admin actions.
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
      `Application ${application.id} approved by admin ${adminId}: ` +
        `partner=${partner.id} username=${partner.username} ` +
        `promo=${promoCode} (custom=${Boolean(customPromoCode)})`,
    );

    return { partner, promoCode, inviteToken };
  }

  /**
   * Rejects a pending application. Writes a rejection audit-log entry
   * (Requirement 17.1) but does NOT create a Partner row.
   *
   * @throws NotFoundException — application id does not exist.
   * @throws ConflictException — application is no longer `pending`
   *   (Requirement 5.7).
   */
  async reject(id: string, adminId: string): Promise<PartnerApplication> {
    const application = await this.getById(id);
    this.assertPending(application, 'reject');

    return this.dataSource.transaction(async (manager) => {
      await manager.update(
        PartnerApplication,
        { id: application.id },
        {
          status: PartnerApplicationStatus.REJECTED,
          reviewedBy: adminId,
          reviewedAt: new Date(),
        },
      );

      await manager.save(
        manager.create(PartnerAuditLog, {
          entityType: 'application',
          entityId: application.id,
          action: 'rejected',
          actorType: PartnerAuditActorType.ADMIN,
          actorId: adminId,
          oldValue: { status: PartnerApplicationStatus.PENDING },
          newValue: { status: PartnerApplicationStatus.REJECTED },
        }),
      );

      const reloaded = await manager.findOne(PartnerApplication, {
        where: { id: application.id },
      });
      this.logger.log(
        `Application ${application.id} rejected by admin ${adminId}`,
      );
      return reloaded!;
    });
  }

  // ─── helpers ─────────────────────────────────────────────────────────

  /**
   * Throws {@link ConflictException} unless the application is in the
   * `pending` state. Single chokepoint for Requirement 5.7 so both
   * approve and reject produce identical error responses.
   */
  private assertPending(
    application: PartnerApplication,
    action: 'approve' | 'reject',
  ): void {
    if (application.status !== PartnerApplicationStatus.PENDING) {
      this.logger.warn(
        `Cannot ${action} application ${application.id}: ` +
          `status=${application.status} (expected pending)`,
      );
      throw new ConflictException('Заявка уже обработана');
    }
  }

  /**
   * Inserts an admin-supplied promo code as the partner's current code.
   * Translates a PG unique-violation into the user-facing
   * `Промокод уже занят` ConflictException so a race against another
   * admin assigning the same code surfaces a clean error.
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
      const driverCode = (err as { driverError?: { code?: string }; code?: string })
        .driverError?.code ??
        (err as { code?: string }).code;
      if (driverCode === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('Промокод уже занят');
      }
      throw err;
    }
  }

  /**
   * Resolves the username for a new Partner. Either trusts the explicit
   * `params.username` (after a uniqueness check) or derives one from
   * `displayName` via {@link deriveUsername}, retrying with fresh
   * suffixes on collision.
   *
   * Note: `Partner.username` has a DB-level UNIQUE constraint, so this
   * is a best-effort pre-check — a concurrent insert could still
   * trigger a 23505 at save time, which propagates as a 500 (acceptable
   * for the rare collision and ergonomic for retry).
   */
  private async deriveUniqueUsername(
    manager: EntityManager,
    explicit: string | undefined,
    displayName: string,
  ): Promise<string> {
    if (explicit) {
      // Normalize to lowercase so login lookups (also case-insensitive)
      // never miss because of input casing differences.
      const normalized = explicit.trim().toLowerCase();
      const existing = await manager
        .createQueryBuilder(Partner, 'p')
        .where('LOWER(p.username) = :u', { u: normalized })
        .getOne();
      if (existing) {
        throw new ConflictException('Username уже занят');
      }
      return normalized;
    }

    for (let i = 0; i < USERNAME_DERIVATION_ATTEMPTS; i++) {
      const candidate = this.deriveUsername(displayName);
      const existing = await manager
        .createQueryBuilder(Partner, 'p')
        .where('LOWER(p.username) = :u', { u: candidate })
        .getOne();
      if (!existing) return candidate;
    }
    throw new ConflictException(
      'Не удалось подобрать уникальный username — укажите его вручную',
    );
  }

  /**
   * Builds a candidate username from a free-form display name:
   *   1. lowercases the input,
   *   2. transliterates Cyrillic letters to Latin via
   *      {@link CYRILLIC_TO_LATIN},
   *   3. drops everything outside `[a-z0-9_-]`,
   *   4. trims to {@link DERIVED_USERNAME_STEM_MAX} chars,
   *   5. appends a 4-char hex suffix from `crypto.randomBytes(2)` so
   *      multiple partners with similar names don't collide.
   *
   * If sanitisation produces an empty stem (e.g. name was emoji-only),
   * we fall back to a `partner-` prefix so the resulting username still
   * matches the regex used by {@link ApproveApplicationDto}.
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
