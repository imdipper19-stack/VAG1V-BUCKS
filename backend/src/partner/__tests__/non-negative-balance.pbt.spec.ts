/**
 * P2 — Non-negative balance (Task 18.3).
 *
 * **Validates: Requirements 16.4, 13.3**
 *
 * Property:
 *   ∀ partner, ∀ amount > balance(partner):
 *     create(partner, { amount }) throws BadRequestException
 *
 * The flip side — `amount ≤ balance` — must succeed and keep the
 * resulting balance ≥ 0 (Requirement 16.4). Both directions are
 * exercised here so we know the rejection path is not over-eager
 * (rejecting valid requests is a different bug than the one this
 * property targets).
 */

import { BadRequestException } from '@nestjs/common';
import * as fc from 'fast-check';

import { CommissionService } from '../commission.service';
import { PayoutService } from '../payout.service';
import { CommissionEntry } from '../entities/commission-entry.entity';
import { PartnerAuditLog } from '../entities/partner-audit-log.entity';
import { PayoutRequest } from '../entities/payout-request.entity';
import {
  TestDataSourceHandle,
  createTestDataSource,
  createTestOrder,
  createTestPartner,
} from './test-helpers';

jest.setTimeout(60_000);

describe('PBT P2 — Non-negative balance', () => {
  let handle: TestDataSourceHandle;

  beforeAll(async () => {
    handle = await createTestDataSource();
  });

  afterAll(async () => {
    if (handle) await handle.destroy();
  });

  it('payout creation rejects when amount > balance and accepts when amount ≤ balance', async () => {
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

    await fc.assert(
      fc.asyncProperty(
        // earned: 10–100 000 RUB, two-decimal precision.
        fc.integer({ min: 1_000, max: 10_000_000 }).map((c) => c / 100),
        // requested: 1–200 000 RUB, allows either side of the
        // balance boundary so the property exercises both branches.
        fc.integer({ min: 100, max: 20_000_000 }).map((c) => c / 100),
        async (earned, requested) => {
          const partner = await createTestPartner(ds);
          const order = await createTestOrder(ds, partner.id, 100, 0.1);
          await commissionService.createPending(order.id, partner.id, earned);
          await commissionService.approve(order.id);

          const balance = await payoutService.getBalance(partner.id);
          // Sanity: the seeded approved commission becomes the balance.
          expect(balance).toBeCloseTo(earned, 2);

          if (requested > balance) {
            // Over-draw must be rejected — Requirement 13.3.
            await expect(
              payoutService.create(partner.id, {
                amount: requested,
                requisites: 'SBP +7 999 0000000',
              }),
            ).rejects.toBeInstanceOf(BadRequestException);

            // Balance must NOT change after a rejected create().
            const balanceAfter = await payoutService.getBalance(partner.id);
            expect(balanceAfter).toBeCloseTo(balance, 2);
          } else {
            // amount ≤ balance must succeed.
            const created = await payoutService.create(partner.id, {
              amount: requested,
              requisites: 'SBP +7 999 0000000',
            });
            expect(created.id).toBeDefined();

            // Post-condition: balance is reduced by exactly the
            // requested amount and remains ≥ 0 (Requirement 16.4).
            const balanceAfter = await payoutService.getBalance(partner.id);
            expect(balanceAfter).toBeGreaterThanOrEqual(0);
            expect(balanceAfter).toBeCloseTo(balance - requested, 2);
          }
        },
      ),
      { numRuns: 25 },
    );
  });
});
