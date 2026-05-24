import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: WidenAdminActivityLogAction
 *
 * Drops the Postgres ENUM constraint on `admin_activity_logs.action`
 * and converts the column to `varchar(64)`.
 *
 * --------------------------------------------------------------------
 * Why
 * --------------------------------------------------------------------
 * The `admin_activity_logs` table is created via TypeORM
 * `synchronize: true` (see `database.module.ts`), and TypeORM cannot
 * extend Postgres ENUMs through `synchronize` — adding a new value
 * requires an explicit `ALTER TYPE … ADD VALUE` which TypeORM does not
 * emit. Every new admin-action string therefore blocks app startup
 * until a migration is run.
 *
 * To unblock future admin actions (review.approve, review.reject and
 * anything else that comes later) we drop the enum constraint once,
 * widen the column to `varchar(64)`, and rely on the TypeScript
 * `AdminActivityType` union for compile-time safety. 64 characters is
 * generous for the current `<resource>.<verb>` naming convention while
 * keeping stored size predictable.
 *
 * The original ENUM type is auto-named by TypeORM: it follows the
 * pattern `<table>_<column>_enum` → `admin_activity_logs_action_enum`.
 *
 * --------------------------------------------------------------------
 * Behaviour
 * --------------------------------------------------------------------
 * up():
 *   1. ALTER COLUMN `action` TYPE `varchar(64)` USING `action::text`.
 *      Existing rows keep their string values verbatim.
 *   2. DROP TYPE `admin_activity_logs_action_enum` (now unreferenced).
 *
 * down():
 *   1. Re-create the ENUM with the original 9 values.
 *   2. ALTER COLUMN back to the ENUM.
 *      Any rows with non-original values (e.g. `review.approve`) would
 *      break the cast — the `down()` first deletes such rows so the
 *      rollback is safe even after new actions have been recorded.
 *      Audit data loss on rollback is documented and acceptable; the
 *      rollback path is for emergency use only.
 *
 * --------------------------------------------------------------------
 * Idempotency
 * --------------------------------------------------------------------
 * Both `up()` and `down()` use `IF EXISTS` / `IF NOT EXISTS` where
 * Postgres supports them so a half-applied migration can be re-run.
 */
export class WidenAdminActivityLogAction1735100001000
  implements MigrationInterface
{
  name = 'WidenAdminActivityLogAction1735100001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // -------------------------------------------------------------------
    // 1) Convert the column from ENUM to varchar(64). The USING clause
    //    casts the enum value to text so every existing row keeps its
    //    string label.
    // -------------------------------------------------------------------
    await queryRunner.query(`
      ALTER TABLE "admin_activity_logs"
        ALTER COLUMN "action" TYPE varchar(64) USING "action"::text
    `);

    // -------------------------------------------------------------------
    // 2) Drop the now-orphaned enum type.
    // -------------------------------------------------------------------
    await queryRunner.query(
      `DROP TYPE IF EXISTS "admin_activity_logs_action_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // -------------------------------------------------------------------
    // 1) Strip rows whose `action` is not one of the original 9 values
    //    so the cast back to ENUM cannot fail. This is destructive but
    //    expected on rollback (see class comment).
    // -------------------------------------------------------------------
    await queryRunner.query(`
      DELETE FROM "admin_activity_logs"
      WHERE "action" NOT IN (
        'login',
        'logout',
        'password_change',
        'order_retry',
        'proxy_add',
        'proxy_delete',
        'razer_add',
        'razer_delete',
        'settings_update'
      )
    `);

    // -------------------------------------------------------------------
    // 2) Recreate the original ENUM type.
    // -------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TYPE "admin_activity_logs_action_enum" AS ENUM (
        'login',
        'logout',
        'password_change',
        'order_retry',
        'proxy_add',
        'proxy_delete',
        'razer_add',
        'razer_delete',
        'settings_update'
      )
    `);

    // -------------------------------------------------------------------
    // 3) Convert the column back to the ENUM type.
    // -------------------------------------------------------------------
    await queryRunner.query(`
      ALTER TABLE "admin_activity_logs"
        ALTER COLUMN "action" TYPE "admin_activity_logs_action_enum"
        USING "action"::"admin_activity_logs_action_enum"
    `);
  }
}
