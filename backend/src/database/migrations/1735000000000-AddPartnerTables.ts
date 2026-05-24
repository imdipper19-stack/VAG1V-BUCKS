import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: AddPartnerTables
 *
 * Creates the 6 partner-program tables per design.md §1.1:
 *   1. partners
 *   2. partner_applications
 *   3. partner_promo_codes
 *   4. commission_entries
 *   5. payout_requests
 *   6. partner_audit_log
 *
 * Notes on ordering:
 *   - `partners` and `partner_applications` have a circular FK relationship.
 *     We create `partners` first WITHOUT the `application_id` foreign-key
 *     constraint, then create `partner_applications`, then ALTER `partners`
 *     to add the FK.
 *
 * Rollback (down): drops everything created in up() in reverse order. The
 *   `pgcrypto` extension is intentionally NOT dropped — it may be in use by
 *   other parts of the schema. DROP TABLE cascades indexes and FKs.
 */
export class AddPartnerTables1735000000000 implements MigrationInterface {
  name = 'AddPartnerTables1735000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Required for gen_random_uuid()
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    // -------------------------------------------------------------------
    // ENUM types
    // -------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TYPE "partners_status_enum" AS ENUM ('active', 'disabled')
    `);
    await queryRunner.query(`
      CREATE TYPE "partner_applications_platform_type_enum"
        AS ENUM ('telegram', 'vk', 'twitch', 'youtube', 'tiktok', 'other')
    `);
    await queryRunner.query(`
      CREATE TYPE "partner_applications_status_enum"
        AS ENUM ('pending', 'approved', 'rejected')
    `);
    await queryRunner.query(`
      CREATE TYPE "commission_entries_status_enum"
        AS ENUM ('pending', 'approved', 'cancelled')
    `);
    await queryRunner.query(`
      CREATE TYPE "payout_requests_status_enum"
        AS ENUM ('requested', 'processing', 'paid', 'rejected')
    `);
    await queryRunner.query(`
      CREATE TYPE "partner_audit_log_actor_type_enum"
        AS ENUM ('admin', 'system')
    `);

    // -------------------------------------------------------------------
    // 1. partners — created WITHOUT application_id FK (circular dep)
    // -------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "partners" (
        "id"                       UUID NOT NULL DEFAULT gen_random_uuid(),
        "username"                 VARCHAR(64) NOT NULL,
        "password_hash"            VARCHAR(255) NOT NULL,
        "display_name"             VARCHAR(128) NOT NULL,
        "contact_tg"               VARCHAR(64) NOT NULL,
        "commission_rate"          DECIMAL(5,4) NOT NULL DEFAULT 0.10,
        "discount_rate"            DECIMAL(5,4) NOT NULL DEFAULT 0.05,
        "status"                   "partners_status_enum" NOT NULL DEFAULT 'active',
        "invite_token"             VARCHAR(128),
        "invite_token_used"        BOOLEAN NOT NULL DEFAULT FALSE,
        "invite_token_expires_at"  TIMESTAMP,
        "application_id"           UUID,
        "created_at"               TIMESTAMP NOT NULL DEFAULT NOW(),
        "updated_at"               TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_partners" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_partners_username" UNIQUE ("username"),
        CONSTRAINT "UQ_partners_invite_token" UNIQUE ("invite_token")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_partners_status" ON "partners" ("status")
    `);

    // -------------------------------------------------------------------
    // 2. partner_applications
    //    - reviewed_by → admins.id  ON DELETE SET NULL
    //    - partner_id  → partners.id ON DELETE SET NULL
    // -------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "partner_applications" (
        "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
        "display_name"   VARCHAR(128) NOT NULL,
        "platform_type"  "partner_applications_platform_type_enum" NOT NULL,
        "platform_url"   VARCHAR(512) NOT NULL,
        "audience_size"  VARCHAR(64) NOT NULL,
        "contact_tg"     VARCHAR(64) NOT NULL,
        "description"    TEXT NOT NULL,
        "status"         "partner_applications_status_enum" NOT NULL DEFAULT 'pending',
        "reviewed_by"    UUID,
        "reviewed_at"    TIMESTAMP,
        "partner_id"     UUID,
        "created_at"     TIMESTAMP NOT NULL DEFAULT NOW(),
        "updated_at"     TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_partner_applications" PRIMARY KEY ("id"),
        CONSTRAINT "FK_partner_applications_reviewed_by"
          FOREIGN KEY ("reviewed_by") REFERENCES "admins"("id")
          ON DELETE SET NULL,
        CONSTRAINT "FK_partner_applications_partner_id"
          FOREIGN KEY ("partner_id") REFERENCES "partners"("id")
          ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_partner_applications_status"
        ON "partner_applications" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_partner_applications_partner_id"
        ON "partner_applications" ("partner_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_partner_applications_created_at"
        ON "partner_applications" ("created_at")
    `);

    // -------------------------------------------------------------------
    // Add the deferred FK partners.application_id → partner_applications.id
    // -------------------------------------------------------------------
    await queryRunner.query(`
      ALTER TABLE "partners"
        ADD CONSTRAINT "FK_partners_application_id"
        FOREIGN KEY ("application_id") REFERENCES "partner_applications"("id")
        ON DELETE SET NULL
    `);

    // -------------------------------------------------------------------
    // 3. partner_promo_codes
    //    - partner_id → partners.id ON DELETE CASCADE
    // -------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "partner_promo_codes" (
        "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
        "partner_id"  UUID NOT NULL,
        "code"        VARCHAR(16) NOT NULL,
        "is_current"  BOOLEAN NOT NULL DEFAULT TRUE,
        "created_at"  TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_partner_promo_codes" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_partner_promo_codes_code" UNIQUE ("code"),
        CONSTRAINT "FK_partner_promo_codes_partner_id"
          FOREIGN KEY ("partner_id") REFERENCES "partners"("id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_partner_promo_codes_partner_id"
        ON "partner_promo_codes" ("partner_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_partner_promo_codes_is_current"
        ON "partner_promo_codes" ("is_current")
    `);

    // -------------------------------------------------------------------
    // 4. commission_entries
    //    - order_id   → orders.id   ON DELETE RESTRICT (UNIQUE)
    //    - partner_id → partners.id ON DELETE RESTRICT
    // -------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "commission_entries" (
        "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
        "order_id"      UUID NOT NULL,
        "partner_id"    UUID NOT NULL,
        "amount"        DECIMAL(12,2) NOT NULL,
        "status"        "commission_entries_status_enum" NOT NULL DEFAULT 'pending',
        "approved_at"   TIMESTAMP,
        "cancelled_at"  TIMESTAMP,
        "created_at"    TIMESTAMP NOT NULL DEFAULT NOW(),
        "updated_at"    TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_commission_entries" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_commission_entries_order_id" UNIQUE ("order_id"),
        CONSTRAINT "FK_commission_entries_order_id"
          FOREIGN KEY ("order_id") REFERENCES "orders"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_commission_entries_partner_id"
          FOREIGN KEY ("partner_id") REFERENCES "partners"("id")
          ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_commission_entries_partner_id"
        ON "commission_entries" ("partner_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_commission_entries_status"
        ON "commission_entries" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_commission_entries_partner_status"
        ON "commission_entries" ("partner_id", "status")
    `);

    // -------------------------------------------------------------------
    // 5. payout_requests
    //    - partner_id   → partners.id ON DELETE RESTRICT
    //    - processed_by → admins.id   ON DELETE SET NULL
    // -------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "payout_requests" (
        "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
        "partner_id"        UUID NOT NULL,
        "amount"            DECIMAL(12,2) NOT NULL,
        "requisites"        TEXT NOT NULL,
        "status"            "payout_requests_status_enum" NOT NULL DEFAULT 'requested',
        "rejection_reason"  TEXT,
        "processed_by"      UUID,
        "requested_at"      TIMESTAMP NOT NULL DEFAULT NOW(),
        "processing_at"     TIMESTAMP,
        "paid_at"           TIMESTAMP,
        "rejected_at"       TIMESTAMP,
        "created_at"        TIMESTAMP NOT NULL DEFAULT NOW(),
        "updated_at"        TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_payout_requests" PRIMARY KEY ("id"),
        CONSTRAINT "FK_payout_requests_partner_id"
          FOREIGN KEY ("partner_id") REFERENCES "partners"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_payout_requests_processed_by"
          FOREIGN KEY ("processed_by") REFERENCES "admins"("id")
          ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_payout_requests_partner_id"
        ON "payout_requests" ("partner_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_payout_requests_status"
        ON "payout_requests" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_payout_requests_partner_status"
        ON "payout_requests" ("partner_id", "status")
    `);

    // -------------------------------------------------------------------
    // 6. partner_audit_log
    //    - actor_id is intentionally NOT a FK (can reference admin or system)
    // -------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "partner_audit_log" (
        "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
        "entity_type"  VARCHAR(64) NOT NULL,
        "entity_id"    UUID NOT NULL,
        "action"       VARCHAR(128) NOT NULL,
        "actor_type"   "partner_audit_log_actor_type_enum" NOT NULL,
        "actor_id"     UUID,
        "old_value"    JSONB,
        "new_value"    JSONB,
        "created_at"   TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_partner_audit_log" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_partner_audit_log_entity"
        ON "partner_audit_log" ("entity_type", "entity_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_partner_audit_log_created_at"
        ON "partner_audit_log" ("created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // -------------------------------------------------------------------
    // Drop tables in REVERSE order of creation. DROP TABLE cascades any
    // indexes attached to the table, but FKs that reference these tables
    // from outside (e.g. orders.partner_id) must be removed first by their
    // owning migration's down() — that is handled by
    // 1735000001000-AddPartnerFieldsToOrders.down() running before this.
    // -------------------------------------------------------------------
    await queryRunner.query(`DROP TABLE IF EXISTS "partner_audit_log"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payout_requests"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "commission_entries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "partner_promo_codes"`);

    // Break the circular FK between partners and partner_applications before
    // dropping either table.
    await queryRunner.query(`
      ALTER TABLE "partners"
        DROP CONSTRAINT IF EXISTS "FK_partners_application_id"
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS "partner_applications"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "partners"`);

    // -------------------------------------------------------------------
    // Drop ENUM types in reverse order of creation.
    // -------------------------------------------------------------------
    await queryRunner.query(`DROP TYPE IF EXISTS "partner_audit_log_actor_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "payout_requests_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "commission_entries_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "partner_applications_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "partner_applications_platform_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "partners_status_enum"`);

    // NOTE: `pgcrypto` extension is intentionally NOT dropped — it may be
    //       used by other parts of the schema.
  }
}
