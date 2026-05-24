/**
 * P1 — Balance invariant (Task 18.2).
 *
 * **Validates: Requirements 16.3**
 *
 * Property:
 *   ∀ partner, ∀ history of events H:
 *     getBalance(partner)
 *       = Σ amount(c) ∀ commission c with status=approved
 *       - Σ amount(p) ∀ payout p with status ∈ {requested, processing, paid}
 *
 * The test generates a small random sequence of "events":
 *   - `order`  with terminal `success | failure` flag → triggers
 *               createPending + approve|cancel via CommissionService.
 *   - `payout` with terminal status `none | paid | rejected` → submits
 *               via PayoutService.create then optionally transitions
 *               via updateStatus.
 *
 * Payout amounts are clamped to the running balance so create() never
 * trips the over-draw guard — that guard is tested by P2 separately;
 * here we want a clean balance-arithmetic check, not interference
 * from balance-rejection paths.
 */

import * as fc from 'fast-check';

import { CommissionService } from '../commission.service';
import { PayoutService } from '../payout.service';
import {
  CommissionEntry,
  CommissionEntryStatus,
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

jest.setTimeout(120_000);

/** Round to 2dp — same convention used by the order pipeline when
 *  stamping commission and discount amounts onto orders. */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Statuses that count against the balance (mirrors the constant in
 *  PayoutService — duplicated here so this test stays self-contained). */
const OUTSTANDING_STATUSES = new Set<PayoutRequestStatus>([
  PayoutRequestStatus.PAID,
  PayoutRequestStatus.REQUESTED,
  PayoutRequestStatus.PROCESSING,
]);

type OrderEvent = {
  kind: 'order';
  /** order amount in RUB, two decimals */
  amount: number;
  /** terminal status reached for this order */
  success: boolean;
};

type PayoutEvent = {
  kind: 'payout';
  /** fraction of current balance to request (0,1] */
  fraction: number;
  /** terminal transition to apply after request, or 'leave' to keep
   *  the payout in REQUESTED status. */
  terminal: 'leave' | 'paid' | 'rejected';
};

type Event = OrderEvent | PayoutEvent;

const eventArb = fc.oneof(
  fc.record<OrderEvent>({
    kind: fc.constant('order'),
    // Order amount: 1.00 – 10 000.00 RUB.
    amount: fc.integer({ min: 100, max: 1_000_000 }).map((c) => c / 100),
    success: fc.boolean(),
  }),
  fc.record<PayoutEvent>({
    kind: fc.constant('payout'),
    fraction: fc.float({
      min: Math.fround(0.01),
      max: Math.fround(1.0),
      noNaN: true,
      // Disallow subnormals so the multiplication doesn't underflow.
      noDefaultInfinity: true,
    }),
    terminal: fc.constantFrom('leave', 'paid', 'rejected'),
  }),
);

describe('PBT P1 — Balance invariant', () => {
  let handle: TestDataSourceHandle;

  beforeAll(async () => {
    handle = await createTestDataSource();
  });

  afterAll(async () => {
    if (handle) await handle.destroy();
  });

  it('getBalance() equals manual sum of approved commissions minus outstanding payouts', async () => {
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

    // Use a fixed admin id for the payout transitions — the audit log
    // accepts any UUID and the test does not assert on it.
    const adminId = '00000000-0000-0000-0000-0000000000aa';

    await fc.assert(
      fc.asyncProperty(
        fc.array(eventArb, { minLength: 0, maxLength: 12 }),
        async (events) => {
          const partner = await createTestPartner(ds);

          // Track expected balance components manually as we apply
          // events. We cannot just sum the DB at the end because
          // payout amounts depend on the running balance at the time
          // of the request — so the manual model must be in lock-step.
          let expectedApproved = 0;
          let expectedOutstanding = 0;

          for (const ev of events) {
            if (ev.kind === 'order') {
              const order = await createTestOrder(ds, partner.id, 100, 0.1);
              const amount = r2(ev.amount);
              await commissionService.createPending(
                order.id,
                partner.id,
                amount,
              );
              if (ev.success) {
                await commissionService.approve(order.id);
                expectedApproved = r2(expectedApproved + amount);
              } else {
                await commissionService.cancel(order.id);
                // Cancelled commissions don't affect any sum.
              }
              continue;
            }

            // Payout event: clamp to current balance so create() does
            // not throw. We need at least 0.01 to satisfy the DTO Min.
            const balance = r2(expectedApproved - expectedOutstanding);
            if (balance < 0.01) continue;
            const requested = Math.max(0.01, r2(balance * ev.fraction));
            // Floating-point rounding may push `requested` 1 cent
            // above `balance`; clamp.
            const amount = Math.min(requested, balance);
            if (amount < 0.01) continue;

            const created = await payoutService.create(partner.id, {
              amount,
              requisites: 'PBT_REQUISITES',
            });
            // Just-created payout is REQUESTED, which counts against
            // the balance.
            expectedOutstanding = r2(expectedOutstanding + amount);

            if (ev.terminal === 'paid') {
              await payoutService.updateStatus(
                created.id,
                PayoutRequestStatus.PAID,
                adminId,
              );
              // PAID still counts against the balance — no change to
              // expectedOutstanding.
            } else if (ev.terminal === 'rejected') {
              await payoutService.updateStatus(
                created.id,
                PayoutRequestStatus.REJECTED,
                adminId,
                'PBT rejection',
              );
              // REJECTED is excluded from the balance deduction —
              // the amount is "returned" to the partner.
              expectedOutstanding = r2(expectedOutstanding - amount);
            }
            // 'leave' → keep as REQUESTED, expected stays as set.
          }

          const expectedBalance = r2(expectedApproved - expectedOutstanding);

          // Service-side balance.
          const actualBalance = r2(
            await payoutService.getBalance(partner.id),
          );
          expect(actualBalance).toBeCloseTo(expectedBalance, 2);

          // Cross-check: re-derive the components from the DB directly
          // (using the same SQL shape PayoutService uses internally).
          const approvedRow = await ds
            .getRepository(CommissionEntry)
            .createQueryBuilder('c')
            .select('COALESCE(SUM(c.amount), 0)', 'sum')
            .where('c.partner_id = :id', { id: partner.id })
            .andWhere('c.status = :s', {
              s: CommissionEntryStatus.APPROVED,
            })
            .getRawOne<{ sum: string | number | null }>();
          const dbApproved = Number(approvedRow?.sum ?? 0);

          const outstandingRow = await ds
            .getRepository(PayoutRequest)
            .createQueryBuilder('p')
            .select('COALESCE(SUM(p.amount), 0)', 'sum')
            .where('p.partner_id = :id', { id: partner.id })
            .andWhere('p.status IN (:...statuses)', {
              statuses: Array.from(OUTSTANDING_STATUSES),
            })
            .getRawOne<{ sum: string | number | null }>();
          const dbOutstanding = Number(outstandingRow?.sum ?? 0);

          expect(r2(dbApproved)).toBeCloseTo(expectedApproved, 2);
          expect(r2(dbOutstanding)).toBeCloseTo(expectedOutstanding, 2);
        },
      ),
      { numRuns: 8 },
    );
  });
});
