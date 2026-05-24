-- ============================================================================
-- Manual migration: widen admin_activity_logs.action from PG enum to varchar(64)
-- ============================================================================
--
-- Why this is manual:
--   The project boots with TypeORM `synchronize: true`, which can ALTER most
--   schema differences automatically but CANNOT extend a PostgreSQL ENUM type.
--   The OrderReviews feature adds two new AdminActivityType values
--   (`review.approve`, `review.reject`). On first startup against a prod DB
--   that already has the old `admin_activity_logs_action_enum`, synchronize
--   may fail or warn. Run this script BEFORE restarting the backend.
--
-- What it does:
--   1) Convert the column type from `admin_activity_logs_action_enum` to
--      `varchar(64)`. Existing rows keep their string values verbatim.
--   2) Drop the now-orphaned ENUM type.
--
-- Idempotency:
--   The script uses `pg_typeof` and `IF EXISTS` so it is safe to run twice.
--
-- How to run on the VPS:
--   docker exec -i <postgres_container> psql -U postgres -d bag1vbucks \
--     < backend/src/database/migrations/manual-sql/01-widen-admin-activity-log-action.sql
--
--   ...or copy the SQL into psql directly.
--
-- Rollback:
--   Not provided here. The TypeORM migration class
--   `1735100001000-WidenAdminActivityLogAction.ts` has a destructive `down()`
--   if you ever need it.
-- ============================================================================

DO $$
BEGIN
  -- Only act if the enum type still exists (i.e. migration not yet applied).
  IF EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'admin_activity_logs_action_enum'
  ) THEN
    -- Convert the column to varchar(64). The USING clause casts existing
    -- enum values to text so no data is lost.
    EXECUTE 'ALTER TABLE admin_activity_logs
             ALTER COLUMN action TYPE varchar(64) USING action::text';

    -- Drop the now-orphaned enum type.
    EXECUTE 'DROP TYPE admin_activity_logs_action_enum';

    RAISE NOTICE 'admin_activity_logs.action successfully widened to varchar(64)';
  ELSE
    RAISE NOTICE 'admin_activity_logs_action_enum does not exist — nothing to do';
  END IF;
END
$$;

-- Verification query — should show `character varying` after the migration:
SELECT
  column_name,
  data_type,
  character_maximum_length
FROM information_schema.columns
WHERE table_name = 'admin_activity_logs'
  AND column_name = 'action';
