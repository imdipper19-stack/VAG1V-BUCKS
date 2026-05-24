/**
 * P4 — Payout idempotency (Task 18.5).
 *
 * **Validates: Requirements 16.5**
 *
 * Property:
 *   ∀ payoutId:
 *     updateStatus(payoutId, PAID); updateStatus(payoutId, PAID)
 *     ≡ updateStatus(payoutId, PAID)
 *
 *   Re-running the same terminal transition must not re-stamp
 *   `paid_at` and must not double-deduct from the partner balance.
 *
 * The same property is asserted for the REJECTED terminal status
 * (`rejected_at` invariant + balance restoration is automatic via
 * dynamic balance computation).
 */

import * as fc from 'fast-check';

import { CommissionService } from '../commission.service';
import { PayoutService } from '../payout.service';
import {
  CommissionEntry,
} from '../entities/commission-entry.entity';
import { PartnerAuditLog } from '../entities/partner-audit-log.entity';
import {
  PayoutRequest,
  PayoutRequestStatus,
} from '../entities/payout-request.entity';
import {
  TestDataSourceHandle,
  createTestDataSource,
  createTestOrder,
  createTestPartner,
} from './test-helpers';

jest.setTimeout(60_000);

describe('PBT P4 — Payout idempotency', () => {
  let handle: TestDataSourceHandle;

  beforeAll(async () => {
    handle = await createTestDataSource();
  });

  afterAll(async () => {
    if (handle) await handle.destroy();
  });

  /**
   * Builds the service graph the test needs and seeds an approved
   * commission of `earned` rubles so the partner has a non-zero balance
   * available for payout.
   */
  async function setup(earned: number): Promise<{
    partnerId: string;
    payoutService: PayoutService;
    commissionService: CommissionService;
  }> {
    const ds = handle.dataSource;
    const commissionService = new CommissionService(
      ds.getRepository(CommissionEntry),
      ds.getRepository(PartnerAuditLog),
      ds,
    );
    const payoutService = new PayoutService(
      ds.getRepository(PayoutRequest),
      ds.getRepository(CommissionEntry),
      ds.getRepository(PartnerAuditLog),
      ds,
    );

    const partner = await createTestPartner(ds);
    const order = await createTestOrder(ds, partner.id, 100, 0.1);
    await commissionService.createPending(order.id, partner.id, earned);
    await commissionService.approve(order.id);

    return { partnerId: partner.id, payoutService, commissionService };
  }

  it('markPaid(payoutId) is idempotent: paid_at and balance unchanged on second call', async () => {
    const ds = handle.dataSource;

    await fc.assert(
      fc.asyncProperty(
        // earned in [10, 100 000] RUB so the bounded payout (≤ earned)
        // always passes the create() balance check.
        fc.integer({ min: 1_000, max: 10_000_000 }).map((c) => c / 100),
        // Per-property closure — fc.fraction would feed inputs in the
        // wrong shape for two arbitraries, so we just nest:
        async (earned) => {
          const { partnerId, payoutService } = await setup(earned);

          // Request half of the earned balance; must be > 0.
          const amount = Math.floor((earned / 2) * 100) / 100;
          if (amount < 0.01) return; // skip degenerate sample

          const created = await payoutService.create(partnerId, {
            amount,
            requisites: 'SBP +7 999 000 0000',
          });

          // First markPaid — must succeed.
          const adminId = '00000000-0000-0000-0000-0000000000aa';
          const first = await payoutService.updateStatus(
            created.id,
            PayoutRequestStatus.PAID,
            adminId,
          );
          expect(first.status).toBe(PayoutRequestStatus.PAID);
          expect(first.paidAt).not.toBeNull();
          const paidAtFirst = first.paidAt!.getTime();

          const balanceAfterFirst = await payoutService.getBalance(partnerId);

          // Second markPaid — must be a no-op (Requirement 16.5).
          const second = await payoutService.updateStatus(
            created.id,
            PayoutRequestStatus.PAID,
            adminId,
          );
          expect(second.status).toBe(PayoutRequestStatus.PAID);
          // paid_at must NOT shift on the no-op.
          expect(second.paidAt!.getTime()).toBe(paidAtFirst);

          // Balance must be unchanged.
          const balanceAfterSecond = await payoutService.getBalance(partnerId);
          expect(balanceAfterSecond).toBeCloseTo(balanceAfterFirst, 2);
        },
      ),
      { numRuns: 12 },
    );
  });

  it('reject(payoutId) is idempotent: rejected_at and balance unchanged on second call', async () => {
    const ds = handle.dataSource;

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1_000, max: 10_000_000 }).map((c) => c / 100),
        async (earned) => {
          const { partnerId, payoutService } = await setup(earned);

          const amount = Math.floor((earned / 2) * 100) / 100;
          if (amount < 0.01) return;

          const created = await payoutService.create(partnerId, {
            amount,
            requisites: 'Card 1234 5678 9012 3456',
          });

          const adminId = '00000000-0000-0000-0000-0000000000bb';
          const first = await payoutService.updateStatus(
            created.id,
            PayoutRequestStatus.REJECTED,
            adminId,
            'duplicate request',
          );
          expect(first.status).toBe(PayoutRequestStatus.REJECTED);
          const rejectedAtFirst = first.rejectedAt!.getTime();

          // After rejection, balance must NOT count this payout —
          // PayoutService.getBalance() excludes rejected payouts from
          // the deduction, so balance equals earned again.
          const balanceAfterFirst = await payoutService.getBalance(partnerId);
          expect(balanceAfterFirst).toBeCloseTo(earned, 2);

          const second = await payoutService.updateStatus(
            created.id,
            PayoutRequestStatus.REJECTED,
            adminId,
            'duplicate request',
          );
          expect(second.status).toBe(PayoutRequestStatus.REJECTED);
          expect(second.rejectedAt!.getTime()).toBe(rejectedAtFirst);

          const balanceAfterSecond = await payoutService.getBalance(partnerId);
          expect(balanceAfterSecond).toBeCloseTo(balanceAfterFirst, 2);
        },
      ),
      { numRuns: 12 },
    );
  });
});
