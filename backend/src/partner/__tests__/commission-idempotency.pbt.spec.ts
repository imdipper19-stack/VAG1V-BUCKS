/**
 * P3 — Commission idempotency (Task 18.4).
 *
 * **Validates: Requirements 16.6**
 *
 * Property:
 *   ∀ orderId, partner, amount:
 *     approve(orderId); approve(orderId)  ≡  approve(orderId)
 *     cancel(orderId);  cancel(orderId)   ≡  cancel(orderId)
 *
 * The order pipeline (`OrderProcessingService.handleSuccess` /
 * `handleFailure`) is allowed to retry a status callback. The
 * commission service must therefore be idempotent: a second call must
 * NOT re-stamp `approved_at` / `cancelled_at` and must NOT shift
 * totalEarned for the partner.
 */

import * as fc from 'fast-check';

import { CommissionService } from '../commission.service';
import {
  CommissionEntry,
  CommissionEntryStatus,
} from '../entities/commission-entry.entity';
import { PartnerAuditLog } from '../entities/partner-audit-log.entity';
import {
  TestDataSourceHandle,
  createTestDataSource,
  createTestOrder,
  createTestPartner,
} from './test-helpers';

jest.setTimeout(60_000);

/**
 * Sums every approved commission for a partner. Mirrors the SQL inside
 * {@link PayoutService.getBalance} but kept inline so this test is
 * self-contained and does not depend on PayoutService behaviour.
 */
async function totalEarned(
  ds: import('typeorm').DataSource,
  partnerId: string,
): Promise<number> {
  const row = await ds
    .getRepository(CommissionEntry)
    .createQueryBuilder('c')
    .select('COALESCE(SUM(c.amount), 0)', 'sum')
    .where('c.partner_id = :id', { id: partnerId })
    .andWhere('c.status = :s', { s: CommissionEntryStatus.APPROVED })
    .getRawOne<{ sum: string | number | null }>();
  return Number(row?.sum ?? 0);
}

describe('PBT P3 — Commission idempotency', () => {
  let handle: TestDataSourceHandle;

  beforeAll(async () => {
    handle = await createTestDataSource();
  });

  afterAll(async () => {
    if (handle) await handle.destroy();
  });

  it('approve(orderId) is idempotent: totalEarned and approvedAt unchanged on second call', async () => {
    const ds = handle.dataSource;
    const commissionService = new CommissionService(
      ds.getRepository(CommissionEntry),
      ds.getRepository(PartnerAuditLog),
      ds,
    );

    await fc.assert(
      fc.asyncProperty(
        // amount: 0.01–9 999 999.99 RUB, two-decimal cents, fits the
        // commission_entries.amount decimal(12,2) column.
        fc.integer({ min: 1, max: 999_999_999 }).map((c) => c / 100),
        async (amount) => {
          const partner = await createTestPartner(ds);
          const order = await createTestOrder(ds, partner.id, 100, 0.1);

          await commissionService.createPending(order.id, partner.id, amount);

          // First approve — must succeed and update totalEarned.
          const first = await commissionService.approve(order.id);
          expect(first).not.toBeNull();
          const earnedAfterFirst = await totalEarned(ds, partner.id);
          expect(earnedAfterFirst).toBeCloseTo(amount, 2);
          const approvedAtFirst = first!.approvedAt;
          expect(approvedAtFirst).not.toBeNull();

          // Second approve — must be a no-op (returns null per the
          // service contract) and must NOT shift totalEarned or the
          // approved_at timestamp.
          const second = await commissionService.approve(order.id);
          expect(second).toBeNull();

          const earnedAfterSecond = await totalEarned(ds, partner.id);
          expect(earnedAfterSecond).toBeCloseTo(earnedAfterFirst, 2);

          const repo = ds.getRepository(CommissionEntry);
          const reloaded = await repo.findOne({ where: { orderId: order.id } });
          expect(reloaded!.status).toBe(CommissionEntryStatus.APPROVED);
          expect(reloaded!.approvedAt!.getTime()).toBe(
            approvedAtFirst!.getTime(),
          );
        },
      ),
      { numRuns: 20 },
    );
  });

  it('cancel(orderId) is idempotent: cancelledAt unchanged on second call', async () => {
    const ds = handle.dataSource;
    const commissionService = new CommissionService(
      ds.getRepository(CommissionEntry),
      ds.getRepository(PartnerAuditLog),
      ds,
    );

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 999_999_999 }).map((c) => c / 100),
        async (amount) => {
          const partner = await createTestPartner(ds);
          const order = await createTestOrder(ds, partner.id, 100, 0.1);

          await commissionService.createPending(order.id, partner.id, amount);

          const first = await commissionService.cancel(order.id);
          expect(first).not.toBeNull();
          expect(first!.cancelledAt).not.toBeNull();
          const cancelledAtFirst = first!.cancelledAt!;

          // totalEarned ignores cancelled rows by definition; a second
          // cancel must therefore neither change earned (still 0) nor
          // re-stamp cancelled_at.
          const earnedAfterFirst = await totalEarned(ds, partner.id);
          expect(earnedAfterFirst).toBeCloseTo(0, 2);

          const second = await commissionService.cancel(order.id);
          expect(second).toBeNull();

          const repo = ds.getRepository(CommissionEntry);
          const reloaded = await repo.findOne({ where: { orderId: order.id } });
          expect(reloaded!.status).toBe(CommissionEntryStatus.CANCELLED);
          expect(reloaded!.cancelledAt!.getTime()).toBe(
            cancelledAtFirst.getTime(),
          );

          const earnedAfterSecond = await totalEarned(ds, partner.id);
          expect(earnedAfterSecond).toBeCloseTo(earnedAfterFirst, 2);
        },
      ),
      { numRuns: 20 },
    );
  });
});
