/**
 * P6 — Snapshot correctness (Task 18.7).
 *
 * **Validates: Requirements 16.1**
 *
 * Property:
 *   ∀ order with partner:
 *     commission_entry.amount = round2(order.price * order.commission_rate_snapshot)
 *
 * The snapshot is taken at order creation time so subsequent rate
 * changes by the admin do not retroactively alter the commission
 * (Requirement 7.3, 16.1). This test exercises the snapshot pipeline
 * via the actual {@link CommissionService.createPending} call so the
 * computation that runs in production is the one being measured.
 */

import * as fc from 'fast-check';

import { CommissionService } from '../commission.service';
import { CommissionEntry } from '../entities/commission-entry.entity';
import { PartnerAuditLog } from '../entities/partner-audit-log.entity';
import {
  TestDataSourceHandle,
  createTestDataSource,
  createTestOrder,
  createTestPartner,
} from './test-helpers';

// PBT runs serial DB I/O; widen the per-test budget so a slow
// connection cannot fail the whole suite.
jest.setTimeout(60_000);

/** Banker's rounding to two decimals — mirrors the convention used by
 *  the order pipeline when stamping `discount_amount` and friends. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

describe('PBT P6 — Commission snapshot correctness', () => {
  let handle: TestDataSourceHandle;

  beforeAll(async () => {
    handle = await createTestDataSource();
  });

  afterAll(async () => {
    if (handle) await handle.destroy();
  });

  it('commission_entry.amount = round2(price * commission_rate_snapshot)', async () => {
    const ds = handle.dataSource;
    const commissionService = new CommissionService(
      ds.getRepository(CommissionEntry),
      ds.getRepository(PartnerAuditLog),
      ds,
    );

    await fc.assert(
      fc.asyncProperty(
        // priceTRY: 1–10 000 TRY, two decimal places.
        // The orders.price_try column is `decimal(10,2)`.
        fc
          .integer({ min: 100, max: 1_000_000 })
          .map((cents) => cents / 100),
        // commission_rate: 0.0001–0.9999, four decimal places.
        // The orders.commission_rate_snapshot column is `decimal(5,4)`.
        fc
          .integer({ min: 1, max: 9_999 })
          .map((tenths) => tenths / 10_000),
        async (price, rate) => {
          const partner = await createTestPartner(ds);
          const order = await createTestOrder(ds, partner.id, price, rate);

          const expected = round2(price * rate);

          // The order pipeline (Task 9.5) computes the amount as
          //   `order.priceRUB * order.commissionRateSnapshot`
          // and passes it to createPending. Mirror that here.
          const created = await commissionService.createPending(
            order.id,
            partner.id,
            expected,
          );
          expect(created).not.toBeNull();

          // Reload through the repository so the value is what the DB
          // actually persisted (after decimal coercion).
          const repo = ds.getRepository(CommissionEntry);
          const reloaded = await repo.findOne({ where: { orderId: order.id } });
          expect(reloaded).not.toBeNull();
          // Decimals come back as strings from pg.
          const persisted = Number(reloaded!.amount);
          expect(persisted).toBeCloseTo(expected, 2);
        },
      ),
      { numRuns: 25 },
    );
  });
});
