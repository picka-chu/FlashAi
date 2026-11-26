-- Country-aware pricing + day passes + credit packs
--
-- Apply to an existing database before deploying the matching backend build.
-- Safe to run twice: every statement is idempotent.

BEGIN;

-- 1) Users can now hold a day pass, remember their market, and hold a separate
--    credit balance for purchased credit packs.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS country_code TEXT;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS credit_balance INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_plan_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_plan_check
  CHECK (plan IN ('free', 'day_pass', 'weekly', 'monthly', 'monthly_basic', 'monthly_pro', 'admin', 'credits_20', 'credits_50', 'credits_100', 'credits_250'));

COMMENT ON COLUMN public.users.country_code IS
  'Market override chosen by the user (ET/KE/NG/GH/TZ/UG/ZA/GLOBAL). Null means infer from phone or geo.';

COMMENT ON COLUMN public.users.credit_balance IS
  'Purchased credit pack balance (additive to pass credits). Does not expire with the pass.';

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

-- 4) Update apply_plan_purchase so credit packs (duration_days = 0) only add
--    credits without overwriting the plan or extending expiry.
CREATE OR REPLACE FUNCTION public.apply_plan_purchase(
  p_telegram_id BIGINT,
  p_plan TEXT,
  p_credits INTEGER,
  p_duration_days INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (
    telegram_id,
    name,
    plan,
    credits,
    credit_balance,
    plan_expires_at,
    last_credit_reset,
    last_active
  )
  VALUES (
    p_telegram_id,
    'User',
    p_plan,
    GREATEST(0, COALESCE(p_credits, 0)),
    CASE WHEN p_duration_days = 0 THEN GREATEST(0, COALESCE(p_credits, 0)) ELSE 0 END,
    CASE
      WHEN p_duration_days > 0 THEN now() + make_interval(days => p_duration_days)
      ELSE NULL
    END,
    now(),
    now()
  )
  ON CONFLICT (telegram_id) DO UPDATE
  SET plan = CASE
        WHEN p_duration_days > 0 THEN EXCLUDED.plan
        ELSE public.users.plan
      END,
      credits = GREATEST(0, COALESCE(public.users.credits, 0) + COALESCE(p_credits, 0)),
      credit_balance = GREATEST(0, COALESCE(public.users.credit_balance, 0) + COALESCE(EXCLUDED.credit_balance, 0)),
      plan_expires_at = CASE
        WHEN p_duration_days > 0 THEN
          GREATEST(COALESCE(public.users.plan_expires_at, now()), now())
            + make_interval(days => p_duration_days)
        ELSE public.users.plan_expires_at
      END,
      last_credit_reset = now(),
      last_active = now(),
      updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.apply_plan_purchase(BIGINT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_plan_purchase(BIGINT, TEXT, INTEGER, INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_plan_purchase(BIGINT, TEXT, INTEGER, INTEGER) TO service_role;

COMMIT;
