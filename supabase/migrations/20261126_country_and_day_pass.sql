-- Country-aware pricing + day passes
--
-- Apply to an existing database before deploying the matching backend build.
-- Safe to run twice: every statement is idempotent.

BEGIN;

-- 1) Users can now hold a day pass, and remember their market.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS country_code TEXT;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_plan_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_plan_check
  CHECK (plan IN ('free', 'day_pass', 'weekly', 'monthly', 'monthly_basic', 'monthly_pro', 'admin'));

COMMENT ON COLUMN public.users.country_code IS
  'Market override chosen by the user (ET/KE/NG/GH/TZ/UG/ZA/GLOBAL). Null means infer from phone or geo.';

-- 2) Fast lookup for the pricing endpoint.
CREATE INDEX IF NOT EXISTS idx_users_country_code
  ON public.users (country_code)
  WHERE country_code IS NOT NULL;

-- 3) Optional: per-pass usage counter, needed to enforce the catalog's
--    monthlyAnalysesCap. Backend reads these if present.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS pass_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pass_analyses_used INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pass_analyses_cap INTEGER;

COMMIT;
