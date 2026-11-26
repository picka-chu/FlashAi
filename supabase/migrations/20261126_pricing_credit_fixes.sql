-- Flash AI pricing/credit accounting corrections.
-- Apply after 20261126_country_and_day_pass.sql and before deploying the matching backend.
BEGIN;

UPDATE public.users
SET plan = 'free'
WHERE plan IN ('credits_20', 'credits_50', 'credits_100', 'credits_250')
  AND plan_expires_at IS NULL;

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
DECLARE
  is_credit_pack BOOLEAN := COALESCE(p_duration_days, 0) = 0;
BEGIN
  INSERT INTO public.users (
    telegram_id, name, plan, credits, credit_balance,
    plan_expires_at, last_credit_reset, last_active
  )
  VALUES (
    p_telegram_id,
    'User',
    CASE WHEN is_credit_pack THEN 'free' ELSE p_plan END,
    GREATEST(0, COALESCE(p_credits, 0)),
    CASE WHEN is_credit_pack THEN GREATEST(0, COALESCE(p_credits, 0)) ELSE 0 END,
    CASE WHEN NOT is_credit_pack THEN now() + make_interval(days => p_duration_days) ELSE NULL END,
    now(),
    now()
  )
  ON CONFLICT (telegram_id) DO UPDATE
  SET plan = CASE
        WHEN NOT is_credit_pack THEN EXCLUDED.plan
        WHEN public.users.plan IN ('credits_20', 'credits_50', 'credits_100', 'credits_250') THEN 'free'
        ELSE public.users.plan
      END,
      credits = GREATEST(0, COALESCE(public.users.credits, 0) + COALESCE(p_credits, 0)),
      credit_balance = GREATEST(
        0,
        COALESCE(public.users.credit_balance, 0)
          + CASE WHEN is_credit_pack THEN COALESCE(p_credits, 0) ELSE 0 END
      ),
      plan_expires_at = CASE
        WHEN NOT is_credit_pack THEN
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

COMMENT ON COLUMN public.users.credits IS
  'Total spendable credits: active pass pool plus remaining purchased credit-pack balance.';
COMMENT ON COLUMN public.users.credit_balance IS
  'Remaining purchased credit-pack balance. Top-ups do not expire and are consumed after pass credits.';

COMMIT;
