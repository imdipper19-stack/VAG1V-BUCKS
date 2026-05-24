import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: AddPartnerFieldsToOrders
 *
 * Adds 5 nullable columns to the existing `orders` table per design.md §1.2:
 *   - partner_id                UUID         FK → partners(id) ON DELETE SET NULL
 *   - promo_code_snapshot       VARCHAR(16)  promo code at order creation
 *   - discount_rate_snapshot    DECIMAL(5,4) Discount_Rate snapshot
 *   - commission_rate_snapshot  DECIMAL(5,4) Commission_Rate snapshot
 *   - discount_amount           DECIMAL(12,2) actual discount amount in RUB
 *
 * All columns are nullable with no defaults — orders without a partner remain
 * unaffected (no breaking changes for existing rows).
 *
 * Depends on migration 1735000000000-AddPartnerTables (creates `partners`).
 *
 * Rollback (down): drops the FK constraint and the 5 added columns in
 *   reverse order of creation.
 */
export class AddPartnerFieldsToOrders1735000001000 implements MigrationInterface {
  name = 'AddPartnerFieldsToOrders1735000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // -------------------------------------------------------------------
    // Add the 5 nullable columns
    // -------------------------------------------------------------------
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN "partner_id" UUID
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN "promo_code_snapshot" VARCHAR(16)
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN "discount_rate_snapshot" DECIMAL(5,4)
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN "commission_rate_snapshot" DECIMAL(5,4)
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN "discount_amount" DECIMAL(12,2)
    `);

    // -------------------------------------------------------------------
    // Foreign key: orders.partner_id → partners.id  ON DELETE SET NULL
    // -------------------------------------------------------------------
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD CONSTRAINT "FK_orders_partner_id"
        FOREIGN KEY ("partner_id") REFERENCES "partners"("id")
        ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // -------------------------------------------------------------------
    // Drop FK constraint first so partners table can be dropped later by
    // the AddPartnerTables down() migration.
    // -------------------------------------------------------------------
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP CONSTRAINT IF EXISTS "FK_orders_partner_id"
    `);

    // -------------------------------------------------------------------
    // Drop the 5 added columns in REVERSE order of creation.
    // -------------------------------------------------------------------
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP COLUMN IF EXISTS "discount_amount"
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP COLUMN IF EXISTS "commission_rate_snapshot"
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP COLUMN IF EXISTS "discount_rate_snapshot"
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP COLUMN IF EXISTS "promo_code_snapshot"
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP COLUMN IF EXISTS "partner_id"
    `);
  }
}
