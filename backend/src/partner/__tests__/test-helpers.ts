/**
 * Test helpers for partner-program property-based tests (Task 18).
 *
 * --------------------------------------------------------------------
 * Choice of database
 * --------------------------------------------------------------------
 * Spec text suggested in-memory SQLite via `better-sqlite3` for test
 * isolation. After looking at the partner services we keep here, that
 * path turned out to be more painful than the spec acknowledged:
 *
 *   - `CommissionService.approve/cancel` use raw `NOW()` SQL — SQLite
 *     does not have NOW(); it expects `CURRENT_TIMESTAMP`.
 *   - `PayoutService.create` opens a `SERIALIZABLE` transaction, which
 *     is a no-op in SQLite but a hard error in some driver configs.
 *   - `PartnerAuditLog.oldValue/newValue` are `jsonb` — SQLite has no
 *     JSONB; TypeORM falls back to TEXT and `Object → string` coercion
 *     becomes brittle.
 *   - `Partner.status` and several other columns use PG ENUM types
 *     (`enumName: 'partners_status_enum'`); TypeORM emits raw
 *     `CREATE TYPE … AS ENUM` SQL for them on `synchronize`, which
 *     SQLite cannot parse.
 *
 * The pragmatic alternative — and the one we use — is the existing
 * PostgreSQL instance at `localhost:5433` (already running for dev,
 * see `backend/.env`). For each call to {@link createTestDataSource}
 * we create a fresh, randomly-named SQL schema, run TypeORM
 * `synchronize()` against it, and `DROP SCHEMA … CASCADE` on
 * teardown. That keeps tests parallel-safe and leaves the dev
 * database otherwise untouched.
 *
 * --------------------------------------------------------------------
 * Why per-test schemas instead of per-test transactions
 * --------------------------------------------------------------------
 * `PayoutService.create` uses an explicit `dataSource.transaction(...)`,
 * so we cannot wrap each test in an outer transaction and roll back —
 * the inner BEGIN/COMMIT would interfere. A fresh schema gives a clean
 * slate for every PBT iteration without coordinating with the service
 * code.
 *
 * Each schema is created from the same TypeORM entity metadata as
 * production, so the column types, enums, indexes, and constraints
 * exactly mirror the live schema.
 */

import { randomBytes, randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

import { Partner, PartnerStatusEnum } from '../entities/partner.entity';
import { PartnerPromoCode } from '../entities/partner-promo-code.entity';
import { PartnerApplication } from '../entities/partner-application.entity';
import { CommissionEntry } from '../entities/commission-entry.entity';
import { PayoutRequest } from '../entities/payout-request.entity';
import { PartnerAuditLog } from '../entities/partner-audit-log.entity';
import { Order, OrderStatusEnum, PaymentStatusEnum } from '../../database/entities/order.entity';
import { TimelineLogEntry } from '../../database/entities/timeline-log.entity';

/** Connection settings for the local dev PostgreSQL (mirrors .env). */
const PG_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5433,
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_DATABASE || 'bag1vbucks',
};

/** All entities the partner tests touch. Order matters only for clarity. */
const TEST_ENTITIES = [
  Partner,
  PartnerPromoCode,
  PartnerApplication,
  CommissionEntry,
  PayoutRequest,
  PartnerAuditLog,
  Order,
  TimelineLogEntry,
];

/**
 * Result returned from {@link createTestDataSource}. The schema name
 * is exposed so the caller can drop it on teardown.
 */
export interface TestDataSourceHandle {
  /** Initialised TypeORM DataSource scoped to the per-test schema. */
  dataSource: DataSource;
  /** Generated PostgreSQL schema name (e.g. `partner_pbt_a3f9c1`). */
  schemaName: string;
  /** Clean up: drops the schema and closes the connection. */
  destroy: () => Promise<void>;
}

/**
 * Creates an isolated PostgreSQL schema and a TypeORM DataSource
 * scoped to it. Caller MUST call {@link TestDataSourceHandle.destroy}
 * in `finally` to avoid leaking schemas on the dev DB.
 *
 * The randomly-suffixed schema name keeps parallel Jest workers from
 * stepping on each other (Jest defaults to `numWorkers = cpus - 1`).
 */
export async function createTestDataSource(): Promise<TestDataSourceHandle> {
  // Lower-case + alphanumeric — pg identifier rules. 12 hex chars give
  // us 16^12 ≈ 2.8 × 10^14 names, more than enough to avoid collisions
  // across concurrent Jest workers.
  const schemaName = `partner_pbt_${randomBytes(6).toString('hex')}`;

  // Bootstrap connection on the public schema to CREATE SCHEMA.
  const bootstrap = new DataSource({
    type: 'postgres',
    ...PG_CONFIG,
  });
  await bootstrap.initialize();
  try {
    await bootstrap.query(`CREATE SCHEMA "${schemaName}"`);
  } finally {
    await bootstrap.destroy();
  }

  // Connect anew with `schema: schemaName` so every query (and
  // `synchronize`) is scoped to the test schema. `synchronize: true`
  // builds the tables from entity metadata; `dropSchema: false` is
  // implicit because the schema is already empty.
  const dataSource = new DataSource({
    type: 'postgres',
    ...PG_CONFIG,
    schema: schemaName,
    entities: TEST_ENTITIES,
    synchronize: true,
    logging: false,
  });

  await dataSource.initialize();

  const destroy = async (): Promise<void> => {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
    // Drop the schema with a fresh short-lived connection — the
    // primary DataSource is already closed at this point.
    const cleanup = new DataSource({ type: 'postgres', ...PG_CONFIG });
    await cleanup.initialize();
    try {
      await cleanup.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    } finally {
      await cleanup.destroy();
    }
  };

  return { dataSource, schemaName, destroy };
}

/**
 * Inserts a test {@link Partner} with sensible defaults. Override any
 * field via `opts`. The username is randomised so multiple partners
 * created in the same test do not collide on the unique index.
 */
export async function createTestPartner(
  ds: DataSource,
  opts: Partial<Partner> = {},
): Promise<Partner> {
  const repo = ds.getRepository(Partner);
  const suffix = randomBytes(4).toString('hex');
  const partner = repo.create({
    username: opts.username ?? `test_${suffix}`,
    passwordHash: opts.passwordHash ?? 'test:hash',
    displayName: opts.displayName ?? `Test Partner ${suffix}`,
    contactTg: opts.contactTg ?? `@test_${suffix}`,
    commissionRate: opts.commissionRate ?? 0.1,
    discountRate: opts.discountRate ?? 0.05,
    status: opts.status ?? PartnerStatusEnum.ACTIVE,
    inviteToken: opts.inviteToken ?? null,
    inviteTokenUsed: opts.inviteTokenUsed ?? false,
    inviteTokenExpiresAt: opts.inviteTokenExpiresAt ?? null,
    applicationId: opts.applicationId ?? null,
  });
  return repo.save(partner);
}

/**
 * Inserts an {@link Order} row with the partner snapshot fields
 * pre-populated, returning the saved entity. Only the fields that
 * `CommissionService` and the partner code actually read are filled
 * with non-null values; everything else gets a placeholder so the
 * NOT-NULL columns on the orders table are satisfied.
 *
 * @param ds              DataSource the order is saved through.
 * @param partnerId       Partner attributed to this order. The caller
 *                        is responsible for creating the partner first.
 * @param priceTRY        Order amount that the commission is computed
 *                        from. Stored on `orders.price_try`.
 * @param commissionRate  Snapshot rate for the commission calculation
 *                        (`commission_entry.amount = price * rate`).
 *                        Stored on `orders.commission_rate_snapshot`.
 */
export async function createTestOrder(
  ds: DataSource,
  partnerId: string,
  priceTRY: number,
  commissionRate: number,
): Promise<Order> {
  const repo = ds.getRepository(Order);
  // The orders table has many NOT-NULL columns (orderId, shortUrlSlug,
  // vbucksAmount, expiresAt). Fill them with synthetic values; the
  // partner tests only read the partner snapshot fields.
  const suffix = randomBytes(6).toString('hex').toUpperCase();
  const order = repo.create({
    orderId: `VB-PBT-${suffix}`,
    shortUrlSlug: `pbt-${suffix.toLowerCase()}`,
    vbucksAmount: 1000,
    priceTRY,
    currency: 'TRY',
    region: 'TR',
    partnerId,
    promoCodeSnapshot: 'TESTCODE',
    discountRateSnapshot: 0.05,
    commissionRateSnapshot: commissionRate,
    discountAmount: 0,
    status: OrderStatusEnum.PENDING,
    paymentStatus: PaymentStatusEnum.PENDING,
    expiresAt: new Date(Date.now() + 3600_000),
  });
  return repo.save(order);
}

/**
 * Convenience: forge a UUID for tests that need a synthetic order id
 * without persisting an actual `orders` row. Useful when the
 * commission entry is being created with an arbitrary order_id (the
 * commission FK to `orders` is enforced, so prefer
 * {@link createTestOrder} when running against the real schema).
 */
export function generateOrderId(): string {
  return randomUUID();
}
