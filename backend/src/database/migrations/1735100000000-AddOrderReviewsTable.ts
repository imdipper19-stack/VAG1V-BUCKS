import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: AddOrderReviewsTable
 *
 * Creates the `order_reviews` table per design.md §1.1 of the
 * `order-reviews` spec, plus the supporting `order_reviews_status_enum`
 * ENUM type.
 *
 * Schema highlights:
 *   - `order_id`     UNIQUE, FK -> orders.id ON DELETE CASCADE
 *                    (one review per order, removed with the order)
 *   - `moderated_by` FK -> admins.id ON DELETE SET NULL
 *                    (audit reference survives admin deletion as NULL)
 *   - `status`       ENUM('pending','approved','rejected') DEFAULT 'pending'
 *
 * Indexes:
 *   - UQ_order_reviews_order_id              (UNIQUE on order_id)
 *   - IDX_order_reviews_status               (status filter)
 *   - IDX_order_reviews_status_created_at    (sorted public/admin lists)
 *   - IDX_order_reviews_ip_created_at        (per-IP rate-limit lookups)
 *
 * Settings rows:
 *   The existing `settings` table is JSON-keyed (see
 *   `backend/src/database/entities/settings.entity.ts`) and not a flat
 *   key/value store, so we do NOT seed `reviews.rate_limit.threshold` /
 *   `reviews.rate_limit.window_seconds` here. Per task 1.3's fallback
 *   instruction, rate-limit defaults live as constants in
 *   `ReviewsService` (threshold = 5, window = 3600 seconds), overridable
 *   via environment variables if/when needed.
 *
 * Note on `pgcrypto`:
 *   The extension is already enabled by 1735000000000-AddPartnerTables.
 *   We re-issue `CREATE EXTENSION IF NOT EXISTS` defensively so this
 *   migration can run independently if the partner migration order ever
 *   changes.
 */
export class AddOrderReviewsTable1735100000000 implements MigrationInterface {
  name = 'AddOrderReviewsTable1735100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Required for gen_random_uuid() — no-op if already enabled.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    // -------------------------------------------------------------------
    // ENUM type
    // -------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TYPE "order_reviews_status_enum"
        AS ENUM ('pending', 'approved', 'rejected')
    `);

    // -------------------------------------------------------------------
    // order_reviews table
    // -------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "order_reviews" (
        "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
        "order_id"          UUID NOT NULL,
        "nickname"          VARCHAR(64) NOT NULL,
        "stars"             SMALLINT NOT NULL,
        "text"              TEXT NOT NULL,
        "status"            "order_reviews_status_enum" NOT NULL DEFAULT 'pending',
        "rejection_reason"  TEXT,
        "moderated_by"      UUID,
        "approved_at"       TIMESTAMP,
        "rejected_at"       TIMESTAMP,
        "ip_address"        INET,
        "user_agent"        TEXT,
        "created_at"        TIMESTAMP NOT NULL DEFAULT NOW(),
        "updated_at"        TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_order_reviews" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_order_reviews_order_id" UNIQUE ("order_id"),
        CONSTRAINT "CHK_order_reviews_stars_range"
          CHECK ("stars" BETWEEN 0 AND 5),
        CONSTRAINT "FK_order_reviews_order_id"
          FOREIGN KEY ("order_id") REFERENCES "orders"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_order_reviews_moderated_by"
          FOREIGN KEY ("moderated_by") REFERENCES "admins"("id")
          ON DELETE SET NULL
      )
    `);

    // -------------------------------------------------------------------
    // Indexes
    // -------------------------------------------------------------------
    await queryRunner.query(`
      CREATE INDEX "IDX_order_reviews_status"
        ON "order_reviews" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_order_reviews_status_created_at"
        ON "order_reviews" ("status", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_order_reviews_ip_created_at"
        ON "order_reviews" ("ip_address", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // DROP TABLE cascades the table's own indexes and constraints.
    await queryRunner.query(`DROP TABLE IF EXISTS "order_reviews"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "order_reviews_status_enum"`);

    // NOTE: `pgcrypto` extension is intentionally NOT dropped — it is
    //       shared with other migrations.
  }
}
