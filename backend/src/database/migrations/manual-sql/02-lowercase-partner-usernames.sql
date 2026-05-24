-- 02-lowercase-partner-usernames.sql
--
-- Normalises every existing partner's username to lowercase so the
-- backend's case-insensitive login lookup matches a stored row exactly.
--
-- Background: the original create / approve paths persisted the
-- username verbatim (e.g. "S6lev") while the partner login form sends
-- it lowercased ("s6lev"). After commit caf6422+ both paths normalise
-- new usernames and the login query uses LOWER(username), but rows
-- created before that point still need a one-time fix.
--
-- Idempotent: a partner whose username is already lowercase is left
-- alone. If two partners would collapse to the same lowercase value
-- (extremely unlikely given how usernames are derived), the UNIQUE
-- constraint will surface the conflict at apply-time and the script
-- will abort without touching anything else, so you can resolve the
-- collision manually before re-running.
--
-- Apply with:
--   docker exec -i bag1vbucks-postgres psql -U postgres -d bag1vbucks \
--     < backend/src/database/migrations/manual-sql/02-lowercase-partner-usernames.sql

BEGIN;

UPDATE partners
SET    username = LOWER(username)
WHERE  username <> LOWER(username);

COMMIT;
