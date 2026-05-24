import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

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
import { CreatePayoutRequestDto } from './dto/create-payout-request.dto';

/** Filters accepted by {@link PayoutService.list} for the admin grid. */
export interface PayoutListFilters {
  status?: PayoutRequestStatus;
}

/**
 * Statuses that count against the partner's available balance when
 * computing {@link PayoutService.getBalance}. Anything in this set is
 * "money already promised to the partner" — either paid out or
 * earmarked for an in-flight payout request. `rejected` payouts are
 * deliberately excluded so a rejection automatically restores the
 * funds (Requirement 14.7) without needing a side effect.
 */
const OUTSTANDING_PAYOUT_STATUSES: PayoutRequestStatus[] = [
  PayoutRequestStatus.PAID,
  PayoutRequestStatus.REQUESTED,
  PayoutRequestStatus.PROCESSING,
];

/** Statuses that are terminal in the payout state machine. */
const TERMINAL_PAYOUT_STATUSES: ReadonlySet<PayoutRequestStatus> = new Set([
  PayoutRequestStatus.PAID,
  PayoutRequestStatus.REJECTED,
]);

/**
 * State machine governing {@link PayoutService.updateStatus} (Requirement 14.6):
 *
 *   requested → processing → paid
 *   requested → paid             (admin shortcut, Req 14.4)
 *   requested → rejected
 *   processing → rejected
 *
 * Anything not listed here is forbidden and surfaces as a
 * `ConflictException` to the admin caller.
 */
const ALLOWED_TRANSITIONS: Readonly<
  Record<PayoutRequestStatus, ReadonlySet<PayoutRequestStatus>>
> = {
  [PayoutRequestStatus.REQUESTED]: new Set([
    PayoutRequestStatus.PROCESSING,
    PayoutRequestStatus.PAID,
    PayoutRequestStatus.REJECTED,
  ]),
  [PayoutRequestStatus.PROCESSING]: new Set([
    PayoutRequestStatus.PAID,
    PayoutRequestStatus.REJECTED,
  ]),
  // paid and rejected are terminal — no outbound transitions.
  [PayoutRequestStatus.PAID]: new Set<PayoutRequestStatus>(),
  [PayoutRequestStatus.REJECTED]: new Set<PayoutRequestStatus>(),
};

/**
 * PayoutService
 *
 * Owns the lifecycle of `payout_requests` rows and the dynamic
 * `Partner_Balance` computation that feeds both the cabinet dashboard
 * and the admin grid.
 *
 * Public surface:
 *   - {@link create}            — partner submits a new request from
 *                                  the cabinet (Requirement 13.1–13.5).
 *   - {@link getBalance}        — dynamic balance, summed from
 *                                  approved commissions minus
 *                                  outstanding payouts (Requirement
 *                                  16.3).
 *   - {@link list}              — admin grid listing with optional
 *                                  status filter (Requirement 14.2).
 *   - {@link listForPartner}    — cabinet history, restricted to one
 *                                  partner (Requirement 12.4).
 *   - {@link getById}           — admin detail read.
 *   - {@link updateStatus}      — admin transition with state-machine
 *                                  enforcement (Requirement 14.6) and
 *                                  idempotent terminal-state writes
 *                                  (Requirement 16.5).
 *
 * No-balance-restoration design (Requirement 14.7): we deliberately
 * do NOT write back to anything when a request is rejected, because
 * {@link getBalance} already excludes `rejected` payouts from the
 * deduction — the dynamic computation handles restoration for free.
 *
 * Concurrency on create(): a partner could plausibly submit two
 * payout requests in quick succession that each pass the
 * `amount <= balance` check individually but together would over-draw.
 * We guard against this by wrapping the read-then-insert in a
 * SERIALIZABLE-isolation transaction. PostgreSQL detects the
 * write-skew at commit time and aborts one of the transactions; the
 * caller surfaces it as a 500. In practice, double-submits from a
 * single partner are vanishingly rare and a SERIALIZATION_FAILURE
 * retry loop here would be over-engineering for the volume this
 * endpoint sees. Document and move on.
 *
 * Audit log: every state change writes one row via
 * {@link PartnerAuditLog} (Requirement 17.3). Idempotent no-ops
 * deliberately skip the audit row so re-running the same transition
 * does not pollute the audit trail with phantom entries.
 */
@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    @InjectRepository(PayoutRequest)
    private readonly payoutRepo: Repository<PayoutRequest>,
    @InjectRepository(CommissionEntry)
    private readonly commissionRepo: Repository<CommissionEntry>,
    @InjectRepository(PartnerAuditLog)
    private readonly auditRepo: Repository<PartnerAuditLog>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // ─── balance ─────────────────────────────────────────────────────────

  /**
   * Computes the partner's available balance dynamically (Requirement
   * 16.3):
   *
   * ```
   *   balance = SUM(commission.amount)  WHERE status='approved'
   *           - SUM(payout.amount)      WHERE status IN
   *             ('paid','requested','processing')
   * ```
   *
   * Why dynamic? Storing a denormalised balance column would force us
   * to keep it in sync with every commission and payout state change,
   * which is fragile under retries and concurrent writes. Computing
   * on read is cheap (two indexed sums per call) and trivially correct.
   *
   * @param partnerId partner uuid
   * @param manager   optional EntityManager so the caller can run this
   *                  read inside an open transaction (used by
   *                  {@link create} to ensure the balance check sees a
   *                  consistent snapshot of the same writes).
   *
   * @returns plain number; pg returns DECIMAL columns as strings, so
   *   we coerce via `Number()` and `COALESCE(..., 0)` so the result is
   *   never NaN or undefined for partners with no rows yet.
   */
  async getBalance(
    partnerId: string,
    manager?: EntityManager,
  ): Promise<number> {
    const commissionRepo = manager
      ? manager.getRepository(CommissionEntry)
      : this.commissionRepo;
    const payoutRepo = manager
      ? manager.getRepository(PayoutRequest)
      : this.payoutRepo;

    const [approvedRow, outstandingRow] = await Promise.all([
      commissionRepo
        .createQueryBuilder('c')
        .select('COALESCE(SUM(c.amount), 0)', 'sum')
        .where('c.partner_id = :id', { id: partnerId })
        .andWhere('c.status = :s', { s: CommissionEntryStatus.APPROVED })
        .getRawOne<{ sum: string | number | null }>(),
      payoutRepo
        .createQueryBuilder('p')
        .select('COALESCE(SUM(p.amount), 0)', 'sum')
        .where('p.partner_id = :id', { id: partnerId })
        .andWhere('p.status IN (:...statuses)', {
          statuses: OUTSTANDING_PAYOUT_STATUSES,
        })
        .getRawOne<{ sum: string | number | null }>(),
    ]);

    const approved = this.sumOrZero(approvedRow);
    const outstanding = this.sumOrZero(outstandingRow);
    return approved - outstanding;
  }

  // ─── create ──────────────────────────────────────────────────────────

  /**
   * Creates a new {@link PayoutRequestStatus.REQUESTED} payout for the
   * given partner.
   *
   * Validation order (Requirement 13.3–13.4):
   *   1. `amount > 0` — the DTO's `Min(0.01)` already enforces this,
   *      so this is a defensive re-check for callers that bypass the
   *      ValidationPipe.
   *   2. `amount <= getBalance(partnerId)` — checked inside the
   *      transaction so the read sees its own pending writes.
   *
   * Concurrency: the read-then-insert runs in a SERIALIZABLE
   * transaction so two concurrent requests from the same partner
   * cannot both pass the balance check and over-draw. PostgreSQL
   * aborts the loser with `40001` (serialization_failure); the caller
   * surfaces a 500 and the partner can simply retry.
   *
   * Audit log: action='created', actor_type='system', actor_id is set
   * to the partner's own id so the audit row identifies who initiated
   * the payout. The {@link PartnerAuditActorType} enum only knows
   * 'admin' and 'system' — there is no 'partner' value — so we use
   * 'system' to mean "automated trail entry, see actor_id for the
   * subject". This convention is documented here so downstream audit
   * readers don't have to re-derive it.
   *
   * @throws BadRequestException — `amount <= 0` (defensive) or
   *   `amount > balance` (Requirement 13.3).
   */
  async create(
    partnerId: string,
    dto: CreatePayoutRequestDto,
  ): Promise<PayoutRequest> {
    if (dto.amount <= 0) {
      // Defensive — DTO Min(0.01) handles this already.
      throw new BadRequestException('Сумма должна быть больше 0');
    }

    return this.dataSource.transaction(
      'SERIALIZABLE',
      async (manager): Promise<PayoutRequest> => {
        const balance = await this.getBalance(partnerId, manager);
        if (dto.amount > balance) {
          throw new BadRequestException(
            'Запрашиваемая сумма превышает доступный баланс',
          );
        }

        const payoutRepo = manager.getRepository(PayoutRequest);
        const auditRepo = manager.getRepository(PartnerAuditLog);

        const entity = payoutRepo.create({
          partnerId,
          // Decimal columns accept strings or numbers; pass as string
          // to avoid float-precision surprises on the way down to pg.
          amount: dto.amount.toFixed(2),
          requisites: dto.requisites,
          status: PayoutRequestStatus.REQUESTED,
        });
        const saved = await payoutRepo.save(entity);

        await auditRepo.save(
          auditRepo.create({
            entityType: 'payout_request',
            entityId: saved.id,
            action: 'created',
            actorType: PartnerAuditActorType.SYSTEM,
            // See class comment: 'system' here means "self-service",
            // and actor_id carries the partner uuid for traceability.
            actorId: partnerId,
            oldValue: null,
            newValue: {
              partnerId,
              amount: dto.amount,
              status: PayoutRequestStatus.REQUESTED,
            },
          }),
        );

        this.logger.log(
          `Payout request ${saved.id} created by partner ${partnerId}: ` +
            `amount=${dto.amount} balance=${balance}`,
        );
        return saved;
      },
    );
  }

  // ─── reads ───────────────────────────────────────────────────────────

  /**
   * Admin-side listing of every payout request, newest first, with an
   * optional status filter for the tabbed admin UI (Requirement 14.2).
   */
  async list(filters: PayoutListFilters = {}): Promise<PayoutRequest[]> {
    const where = filters.status ? { status: filters.status } : {};
    return this.payoutRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Cabinet-side listing — only this partner's payout requests, newest
   * first (Requirement 12.4–12.5). Mirrors {@link list} so the UI can
   * share rendering code, but the WHERE clause is non-negotiable.
   */
  async listForPartner(partnerId: string): Promise<PayoutRequest[]> {
    return this.payoutRepo.find({
      where: { partnerId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Loads a single payout request by id. Throws {@link NotFoundException}
   * with a Russian message suitable for direct surfacing to admin UI
   * when no row matches.
   */
  async getById(id: string): Promise<PayoutRequest> {
    const payout = await this.payoutRepo.findOne({ where: { id } });
    if (!payout) {
      throw new NotFoundException('Заявка на выплату не найдена');
    }
    return payout;
  }

  // ─── status transitions ─────────────────────────────────────────────

  /**
   * Transitions a payout request to `newStatus` (Requirement 14.3–14.5)
   * with the state machine encoded in {@link ALLOWED_TRANSITIONS}.
   *
   * Idempotency (Requirement 16.5): if the row is already in
   * `newStatus` and `newStatus` is terminal (`paid` or `rejected`),
   * this returns the unchanged row without writing anything — repeated
   * admin clicks on "Mark paid" / "Reject" cannot double-touch
   * timestamps or balance components.
   *
   * Non-terminal idempotency (e.g. requested→requested) is a no-op
   * for free since the row is unchanged; we still surface a clean
   * return rather than treating it as an invalid transition.
   *
   * Side effects:
   *   - `processing`: stamps `processingAt = NOW()` and `processedBy`.
   *   - `paid`:       stamps `paidAt = NOW()` and `processedBy`.
   *   - `rejected`:   stamps `rejectedAt = NOW()`, `processedBy`, and
   *                   `rejectionReason` (Requirement 14.5).
   *
   * Audit log: every successful transition writes a row with
   * `entityType='payout_request'`, `action='status_changed'`,
   * `actorType='admin'`, `actorId=adminId` (Requirement 17.3).
   *
   * @throws NotFoundException — payout id does not exist.
   * @throws ConflictException — transition is not in
   *   {@link ALLOWED_TRANSITIONS} (Requirement 14.6).
   */
  async updateStatus(
    payoutId: string,
    newStatus: PayoutRequestStatus,
    adminId: string,
    reason?: string,
  ): Promise<PayoutRequest> {
    const payout = await this.getById(payoutId);
    const oldStatus = payout.status;

    // Idempotency: same terminal status → silent no-op
    // (Requirement 16.5).
    if (oldStatus === newStatus && TERMINAL_PAYOUT_STATUSES.has(newStatus)) {
      this.logger.debug(
        `updateStatus: payout ${payoutId} already ${newStatus}; no-op`,
      );
      return payout;
    }

    // Same non-terminal status → also a no-op, but log it so an
    // erroneous admin double-click is visible in the logs.
    if (oldStatus === newStatus) {
      this.logger.warn(
        `updateStatus: payout ${payoutId} already ${newStatus}; no-op`,
      );
      return payout;
    }

    const allowed = ALLOWED_TRANSITIONS[oldStatus];
    if (!allowed.has(newStatus)) {
      this.logger.warn(
        `Invalid payout transition ${oldStatus} → ${newStatus} ` +
          `for payout ${payoutId}`,
      );
      // For paid/rejected origins, surface the friendlier "уже завершена"
      // message expected by Requirement 14.6.
      if (TERMINAL_PAYOUT_STATUSES.has(oldStatus)) {
        throw new ConflictException('Заявка уже завершена');
      }
      throw new ConflictException(
        `Недопустимый переход статуса: ${oldStatus} → ${newStatus}`,
      );
    }

    // Apply the transition. processedBy is stamped on every
    // admin-driven transition so the "who handled this" question can
    // always be answered even if the audit log is queried separately.
    payout.status = newStatus;
    payout.processedBy = adminId;
    const now = new Date();
    switch (newStatus) {
      case PayoutRequestStatus.PROCESSING:
        payout.processingAt = now;
        break;
      case PayoutRequestStatus.PAID:
        payout.paidAt = now;
        break;
      case PayoutRequestStatus.REJECTED:
        payout.rejectedAt = now;
        payout.rejectionReason = reason ?? null;
        break;
      // requested is unreachable here — it has no inbound transitions
      // in ALLOWED_TRANSITIONS.
      case PayoutRequestStatus.REQUESTED:
        break;
    }

    const saved = await this.payoutRepo.save(payout);

    await this.auditRepo.save(
      this.auditRepo.create({
        entityType: 'payout_request',
        entityId: saved.id,
        action: 'status_changed',
        actorType: PartnerAuditActorType.ADMIN,
        actorId: adminId,
        oldValue: { status: oldStatus },
        newValue: {
          status: newStatus,
          ...(newStatus === PayoutRequestStatus.REJECTED && reason
            ? { rejectionReason: reason }
            : {}),
        },
      }),
    );

    this.logger.log(
      `Payout ${payoutId} ${oldStatus} → ${newStatus} by admin ${adminId}` +
        (newStatus === PayoutRequestStatus.REJECTED && reason
          ? ` (reason: ${reason})`
          : ''),
    );

    return saved;
  }

  // ─── helpers ─────────────────────────────────────────────────────────

  /**
   * Coerces a raw aggregation result (`{ sum: '12.34' | 12.34 | null }`)
   * to a plain `number`. The pg driver returns DECIMAL columns as
   * strings; `Number('')` and `Number(null)` both yield 0 and we
   * normalise both via the nullish-coalescing default for clarity.
   *
   * Mirrors the helper in {@link PartnerService.sumOrZero} — kept as
   * a private copy here rather than imported to avoid a cross-service
   * coupling solely for one liner of arithmetic.
   */
  private sumOrZero(raw: { sum: string | number | null } | undefined): number {
    if (!raw) return 0;
    const value = raw.sum ?? 0;
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) ? num : 0;
  }
}
