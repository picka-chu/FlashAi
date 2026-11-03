-- Allow history rows that can never be settled (e.g. the fixture is no longer
-- available from any provider) to be marked "not_applicable" instead of being
-- wrongly forced to "lost".
-- Compatible with Supabase/Postgres, safe for repeated runs.

BEGIN;

ALTER TABLE public.user_history
  DROP CONSTRAINT IF EXISTS user_history_status_check;

ALTER TABLE public.user_history
  ADD CONSTRAINT user_history_status_check
  CHECK (status IN ('pending', 'won', 'lost', 'not_applicable'));

COMMIT;
