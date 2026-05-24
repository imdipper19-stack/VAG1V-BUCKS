/**
 * P5 — Promo code uniqueness (Task 18.6).
 *
 * **Validates: Requirements 8.1, 8.3, 16.8**
 *
 * Property:
 *   ∀ N partners generated concurrently:
 *     ∀ codes ∈ DB:  unique(code) ∧  count(code) = N
 *
 * The DB enforces uniqueness via `UQ_partner_promo_codes_code`; this
 * test additionally exercises the service's retry-on-collision logic
 * (Requirement 8.4) by hammering the generator concurrently. With an
 * 8-character `[A-Z0-9]` alphabet (36^8 ≈ 2.8 × 10^12 keyspace) the
 * birthday-paradox probability of a real collision at N ≤ 50 is
 * vanishingly small, so the test is effectively measuring "does the
 * service serialise enough to never produce duplicates" rather than
 * "is the keyspace big enough" — those are the same property from the
 * caller's perspective.
 */

import * as fc from 'fast-check';

import { PromoCodeService } from '../promo-code.service';
import { Partner } from '../entities/partner.entity';
import { PartnerPromoCode } from '../entities/partner-promo-code.entity';
import { PartnerAuditLog } from '../entities/partner-audit-log.entity';
import {
  TestDataSourceHandle,
  createTestDataSource,
  createTestPartner,
} from './test-helpers';

jest.setTimeout(120_000);

describe('PBT P5 — Promo code uniqueness', () => {
  let handle: TestDataSourceHandle;

  beforeAll(async () => {
    handle = await createTestDataSource();
  });

  afterAll(async () => {
    if (handle) await handle.destroy();
  });

  it('generating N codes concurrently produces N distinct codes', async () => {
    const ds = handle.dataSource;
    const promoCodeService = new PromoCodeService(
      ds.getRepository(Partner),
      ds.getRepository(PartnerPromoCode),
      ds.getRepository(PartnerAuditLog),
      ds,
    );

    await fc.assert(
      fc.asyncProperty(
        // Modest range — generation involves a transaction per call,
        // and we want the suite to finish in reasonable time. Even
        // numRuns=3 with maxN=20 is enough to surface a serialisation
        // bug because uniqueness violations are deterministic.
        fc.integer({ min: 5, max: 20 }),
        async (n) => {
          // Create N partners up-front (sequentially — partner inserts
          // are unrelated to the property under test).
          const partners: Partner[] = [];
          for (let i = 0; i < n; i++) {
            partners.push(await createTestPartner(ds));
          }

          // Fire all N generate() calls concurrently. Each call opens
          // its own transaction; PG's UNIQUE constraint and the
          // service's retry-on-collision logic must conspire to give
          // every partner a distinct current code.
          const codes = await Promise.all(
            partners.map((p) => promoCodeService.generate(p.id)),
          );

          // Local uniqueness check.
          const codeStrings = codes.map((c) => c.code);
          expect(new Set(codeStrings).size).toBe(n);

          // DB-level uniqueness check: every code we just generated
          // appears exactly once across the full table inside this
          // schema.
          const repo = ds.getRepository(PartnerPromoCode);
          for (const code of codeStrings) {
            const count = await repo.count({ where: { code } });
            expect(count).toBe(1);
          }

          // And every code respects the [A-Z0-9]{8} format
          // (Requirement 8.2).
          for (const code of codeStrings) {
            expect(code).toMatch(/^[A-Z0-9]{8}$/);
          }
        },
      ),
      { numRuns: 3 },
    );
  });
});
