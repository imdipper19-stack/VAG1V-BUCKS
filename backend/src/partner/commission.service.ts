import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';

import {
  CommissionEntry,
  CommissionEntryStatus,
} from './entities/commission-entry.entity';
import {
  PartnerAuditLog,
  PartnerAuditActorType,
} from './entities/partner-audit-log.entity';

/**
 * CommissionService
 *
 * Owns the lifecycle of `commission_entries` rows. The service is
 * driven by `OrderProcessingService` (Task 9) at three points in the
 * existing order pipeline:
 *
 *   - on order creation, when a partner promo code was applied →
 *     {@link createPending} stamps a `pending` row with the snapshot
 *     amount (Requirement 10.1);
 *   - on `handleSuccess` → {@link approve} flips `pending → approved`
 *     so the amount becomes spendable in `getBalance` (Requirement 10.2);
 *   - on `handleFailure` / `markFailed` → {@link cancel} flips
 *     `pending → cancelled` (Requirement 10.3).
 *
 * All three operations are idempotent so the order pipeline can retry
 * safely:
 *
 *   - createPending uses `INSERT ... ON CONFLICT (order_id) DO NOTHING`
 *     (Requirement 10.5, 16.6) — UNIQUE on `order_id` guarantees a
 *     single entry per order; a duplicate call is a silent no-op.
 *   - approve / cancel use a conditional `UPDATE ... WHERE status =
 *     'pending'` so a row already in a final state is not transitioned
 *     a second time (Requirement 16.6).
 *
 * Every state-changing call writes an audit row to `partner_audit_log`
 * (Requirement 17.4). For idempotent no-ops we deliberately skip the
 * audit row — re-running the same transition should not pollute the
 * audit trail with phantom entries.
 *
 * Note on transactions: the original `OrderProcessingService` already
 * wraps order status updates in its own DB transaction. We do not open
 * a nested transaction here for the simple commission UPDATE — the
 * conditional WHERE clause provides atomicity by itself. The audit log
 * write happens in the same logical request after the state change;
 * a crash between the two is acceptable (audit may miss one entry but
 * the data state is still correct).
 */
@Injectable()
export class CommissionService {
  private readonly logger = new Logger(CommissionService.name);

  constructor(
    @InjectRepository(CommissionEntry)
    private readonly commissionRepo: Repository<CommissionEntry>,
    @InjectRepository(PartnerAuditLog)
    private readonly auditRepo: Repository<PartnerAuditLog>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Creates a `pending` commission entry for the given order.
   *
   * Uses `INSERT ... ON CONFLICT (order_id) DO NOTHING` (via TypeORM's
   * `.orIgnore()` clause) so a retry of the same order-creation flow
   * is a safe no-op. Returns the created entry, or `null` if the row
   * already existed.
   *
   * @param orderId   id of the order in `orders` (UUID).
   * @param partnerId id of the partner attributed to the order.
   * @param amount    commission amount in RUB; calculated by the caller
   *                  as `order.priceRUB * order.commissionRateSnapshot`
   *                  (Requirement 16.1).
   */
  async createPending(
    orderId: string,
    partnerId: string,
    amount: number,
  ): Promise<CommissionEntry | null> {
    // ON CONFLICT (order_id) DO NOTHING — `commission_entries.order_id`
    // is UNIQUE so this guarantees at most one entry per order.
    const result = await this.dataSource
      .createQueryBuilder()
      .insert()
      .into(CommissionEntry)
      .values({
        orderId,
        partnerId,
        amount,
        status: CommissionEntryStatus.PENDING,
      })
      .orIgnore()
      .returning('*')
      .execute();

    // `.returning('*')` returns the inserted row(s) on success or an
    // empty array on conflict. Use that to distinguish first call
    // (write audit) from a retry (silent no-op).
    if (!result.raw || result.raw.length === 0) {
      this.logger.debug(
        `createPending: commission entry already exists for order ${orderId}; ignoring`,
      );
      return null;
    }

    // Reload through the repository so the returned entity has the
    // proper TypeORM column types (e.g. Date objects, decimal coercion)
    // rather than the raw driver shape from `.returning('*')`.
    const entry = await this.commissionRepo.findOne({
      where: { orderId },
    });
    if (!entry) {
      // Defensive: should be unreachable — we just inserted the row.
      this.logger.error(
        `createPending: inserted entry for order ${orderId} but reload returned null`,
      );
      return null;
    }

    await this.auditRepo.save(
      this.auditRepo.create({
        entityType: 'commission_entry',
        entityId: entry.id,
        action: 'created',
        actorType: PartnerAuditActorType.SYSTEM,
        actorId: null,
        oldValue: null,
        newValue: {
          orderId,
          partnerId,
          amount,
          status: CommissionEntryStatus.PENDING,
        },
      }),
    );

    this.logger.log(
      `Created pending commission entry ${entry.id} for order ${orderId} ` +
        `(partner=${partnerId} amount=${amount})`,
    );
    return entry;
  }

  /**
   * Transitions the commission entry for `orderId` from `pending` to
   * `approved` and stamps `approved_at = NOW()`.
   *
   * Idempotent (Requirement 16.6): if the entry is already `approved`
   * or `cancelled`, this is a no-op and returns `null`. Same return
   * value if the entry does not exist (the order was created without a
   * partner — caller is responsible for the `if (order.partnerId)`
   * guard, but we degrade gracefully if it's missed).
   */
  async approve(orderId: string): Promise<CommissionEntry | null> {
    const result = await this.commissionRepo
      .createQueryBuilder()
      .update(CommissionEntry)
      .set({
        status: CommissionEntryStatus.APPROVED,
        approvedAt: () => 'NOW()',
      })
      .where('order_id = :orderId AND status = :status', {
        orderId,
        status: CommissionEntryStatus.PENDING,
      })
      .execute();

    if (!result.affected) {
      this.logger.warn(
        `approve: no pending commission entry for order ${orderId}; ` +
          `entry is missing or already in a final state`,
      );
      return null;
    }

    const entry = await this.commissionRepo.findOne({ where: { orderId } });
    if (!entry) {
      // Defensive: row vanished between UPDATE and SELECT (would
      // require an external DELETE — we don't expose one).
      this.logger.error(
        `approve: updated entry for order ${orderId} but reload returned null`,
      );
      return null;
    }

    await this.auditRepo.save(
      this.auditRepo.create({
        entityType: 'commission_entry',
        entityId: entry.id,
        action: 'approved',
        actorType: PartnerAuditActorType.SYSTEM,
        actorId: null,
        oldValue: { status: CommissionEntryStatus.PENDING },
        newValue: { status: CommissionEntryStatus.APPROVED },
      }),
    );

    this.logger.log(
      `Approved commission entry ${entry.id} for order ${orderId} ` +
        `(partner=${entry.partnerId} amount=${entry.amount})`,
    );
    return entry;
  }

  /**
   * Transitions the commission entry for `orderId` from `pending` to
   * `cancelled` and stamps `cancelled_at = NOW()`.
   *
   * Idempotent (Requirement 16.6): if the entry is already `cancelled`
   * or `approved`, this is a no-op and returns `null`. Note that we do
   * NOT roll back an already-`approved` commission on a late failure —
   * once the order was reported successful and the partner saw the
   * earnings, reversing it is an admin-only operation outside this
   * automatic pipeline.
   */
  async cancel(orderId: string): Promise<CommissionEntry | null> {
    const result = await this.commissionRepo
      .createQueryBuilder()
      .update(CommissionEntry)
      .set({
        status: CommissionEntryStatus.CANCELLED,
        cancelledAt: () => 'NOW()',
      })
      .where('order_id = :orderId AND status = :status', {
        orderId,
        status: CommissionEntryStatus.PENDING,
      })
      .execute();

    if (!result.affected) {
      this.logger.warn(
        `cancel: no pending commission entry for order ${orderId}; ` +
          `entry is missing or already in a final state`,
      );
      return null;
    }

    const entry = await this.commissionRepo.findOne({ where: { orderId } });
    if (!entry) {
      this.logger.error(
        `cancel: updated entry for order ${orderId} but reload returned null`,
      );
      return null;
    }

    await this.auditRepo.save(
      this.auditRepo.create({
        entityType: 'commission_entry',
        entityId: entry.id,
        action: 'cancelled',
        actorType: PartnerAuditActorType.SYSTEM,
        actorId: null,
        oldValue: { status: CommissionEntryStatus.PENDING },
        newValue: { status: CommissionEntryStatus.CANCELLED },
      }),
    );

    this.logger.log(
      `Cancelled commission entry ${entry.id} for order ${orderId} ` +
        `(partner=${entry.partnerId} amount=${entry.amount})`,
    );
    return entry;
  }
}
