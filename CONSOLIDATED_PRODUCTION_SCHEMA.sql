-- Consolidated production schema for Flash AI.
-- Idempotent: safe to run on a fresh project or an existing database.
--
-- Notes:
--   * The backend uses the Supabase service-role key, which bypasses RLS.
--   * RLS is still enabled on every table so the anon/authenticated keys cannot
--     read or write private data if they are ever exposed to the client.
--   * Tables that are only accessed by the backend intentionally have no client
--     policies at all (deny by default).

BEGIN;

-- 0) Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Users
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT UNIQUE NOT NULL,
  name TEXT,
  username TEXT,
  phone TEXT,
  photo_url TEXT,
  referrer_id BIGINT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  plan TEXT NOT NULL DEFAULT 'free',
  credits INTEGER NOT NULL DEFAULT 3 CHECK (credits >= 0),
  win_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (win_rate >= 0 AND win_rate <= 100),
  predictions_count INTEGER NOT NULL DEFAULT 0 CHECK (predictions_count >= 0),
  ranking INTEGER NOT NULL DEFAULT 0 CHECK (ranking >= 0),
  referral_rewarded BOOLEAN NOT NULL DEFAULT FALSE,
  last_credit_reset TIMESTAMPTZ NOT NULL DEFAULT now(),
  plan_expires_at TIMESTAMPTZ,
  last_active TIMESTAMPTZ,
  is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS photo_url TEXT,
  ADD COLUMN IF NOT EXISTS referrer_id BIGINT,
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS referral_rewarded BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_credit_reset TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_active TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Normalize the plan check constraint across older databases.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_plan_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_plan_check
  CHECK (plan IN ('free', 'weekly', 'monthly', 'monthly_basic', 'monthly_pro', 'admin'));

-- 2) Content
CREATE TABLE IF NOT EXISTS public.faqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('general', 'subscription', 'referral', 'technical')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.api_cache (
  endpoint TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT NOT NULL REFERENCES public.users(telegram_id) ON DELETE CASCADE,
  fixture_id TEXT,
  match TEXT NOT NULL,
  home TEXT NOT NULL,
  away TEXT NOT NULL,
  prediction_market TEXT NOT NULL,
  confidence INTEGER NOT NULL DEFAULT 0,
  reasoning TEXT,
  analysis_payload JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'won', 'lost')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  reward INTEGER NOT NULL DEFAULT 10 CHECK (reward >= 0),
  url TEXT,
  button_label TEXT DEFAULT 'Start Task',
  image_url TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS button_label TEXT DEFAULT 'Start Task',
  ADD COLUMN IF NOT EXISTS image_url TEXT;

CREATE TABLE IF NOT EXISTS public.ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT,
  subtitle TEXT,
  description TEXT,
  image_url TEXT,
  link TEXT,
  cta TEXT DEFAULT 'Check Out',
  target_group TEXT DEFAULT 'all',
  is_internal BOOLEAN NOT NULL DEFAULT FALSE,
  internal_target TEXT,
  primary_color TEXT DEFAULT '#3b82f6',
  gradient_to TEXT DEFAULT '#8b5cf6',
  hero_color TEXT DEFAULT '#ffffff',
  sub_color TEXT DEFAULT '#e4e4e7',
  button_color TEXT DEFAULT '#ffffff',
  button_text_color TEXT DEFAULT '#111827',
  hero_size INTEGER DEFAULT 32,
  sub_size INTEGER DEFAULT 18,
  button_text_size INTEGER DEFAULT 14,
  button_radius INTEGER DEFAULT 999,
  button_pad_x INTEGER DEFAULT 20,
  button_pad_y INTEGER DEFAULT 8,
  views INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ads
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS target_group TEXT DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS internal_target TEXT,
  ADD COLUMN IF NOT EXISTS primary_color TEXT DEFAULT '#3b82f6',
  ADD COLUMN IF NOT EXISTS gradient_to TEXT DEFAULT '#8b5cf6',
  ADD COLUMN IF NOT EXISTS hero_color TEXT DEFAULT '#ffffff',
  ADD COLUMN IF NOT EXISTS sub_color TEXT DEFAULT '#e4e4e7',
  ADD COLUMN IF NOT EXISTS button_color TEXT DEFAULT '#ffffff',
  ADD COLUMN IF NOT EXISTS button_text_color TEXT DEFAULT '#111827',
  ADD COLUMN IF NOT EXISTS hero_size INTEGER DEFAULT 32,
  ADD COLUMN IF NOT EXISTS sub_size INTEGER DEFAULT 18,
  ADD COLUMN IF NOT EXISTS button_text_size INTEGER DEFAULT 14,
  ADD COLUMN IF NOT EXISTS button_radius INTEGER DEFAULT 999,
  ADD COLUMN IF NOT EXISTS button_pad_x INTEGER DEFAULT 20,
  ADD COLUMN IF NOT EXISTS button_pad_y INTEGER DEFAULT 8,
  ADD COLUMN IF NOT EXISTS views INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clicks INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.ads ALTER COLUMN image_url DROP NOT NULL;

-- 3) Tasks, referrals, notifications
CREATE TABLE IF NOT EXISTS public.user_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT NOT NULL,
  task_id UUID NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (telegram_id, task_id)
);

CREATE TABLE IF NOT EXISTS public.referrals (
  id BIGSERIAL PRIMARY KEY,
  referrer_telegram_id BIGINT NOT NULL,
  referred_telegram_id BIGINT NOT NULL UNIQUE,
  reward_given BOOLEAN NOT NULL DEFAULT FALSE,
  reward_amount INTEGER NOT NULL DEFAULT 50 CHECK (reward_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_logs (
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL,
  message_type TEXT NOT NULL,
  message_content TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  success BOOLEAN NOT NULL DEFAULT TRUE,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL,
  amount INTEGER NOT NULL,
  transaction_type TEXT NOT NULL,
  description TEXT,
  balance_before INTEGER,
  balance_after INTEGER,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4) Payments
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT NOT NULL,
  amount NUMERIC(18, 8) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'completed',
  provider_payment_charge_id TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_payment_charge_id, type)
);

CREATE TABLE IF NOT EXISTS public.processed_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_hash TEXT NOT NULL UNIQUE,
  telegram_id BIGINT NOT NULL,
  plan_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT NOT NULL,
  plan_id TEXT NOT NULL,
  amount_nano TEXT NOT NULL,
  receiver TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'expired', 'cancelled')),
  tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_tx_hash_uq
  ON public.payment_intents (tx_hash)
  WHERE tx_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.user_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT NOT NULL,
  wallet_address TEXT NOT NULL,
  chain TEXT,
  wallet_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5) Observability & support
CREATE TABLE IF NOT EXISTS public.usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  telegram_id BIGINT,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  status INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT NOT NULL,
  name TEXT,
  username TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  subject TEXT NOT NULL,
  details TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6) Indexes
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON public.users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);
CREATE INDEX IF NOT EXISTS idx_users_last_credit_reset ON public.users(last_credit_reset);
CREATE INDEX IF NOT EXISTS idx_user_history_telegram_id ON public.user_history(telegram_id);
CREATE INDEX IF NOT EXISTS idx_user_history_created_at ON public.user_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_cache_updated_at ON public.api_cache(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_active ON public.tasks(active);
CREATE INDEX IF NOT EXISTS idx_ads_active ON public.ads(active);
CREATE INDEX IF NOT EXISTS idx_ads_active_expires ON public.ads(active, expires_at) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_ads_created_at ON public.ads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals(referrer_telegram_id);
CREATE INDEX IF NOT EXISTS idx_referrals_reward_given ON public.referrals(reward_given);
CREATE INDEX IF NOT EXISTS idx_notification_logs_telegram_sent ON public.notification_logs(telegram_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_telegram ON public.credit_transactions(telegram_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_type ON public.credit_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created ON public.credit_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_telegram ON public.transactions(telegram_id);
CREATE INDEX IF NOT EXISTS idx_processed_transactions_telegram ON public.processed_transactions(telegram_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_telegram_status ON public.payment_intents(telegram_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS user_wallets_telegram_wallet_uq
  ON public.user_wallets (telegram_id, wallet_address);
CREATE INDEX IF NOT EXISTS user_wallets_telegram_id_idx ON public.user_wallets (telegram_id);
CREATE INDEX IF NOT EXISTS user_wallets_active_idx ON public.user_wallets (telegram_id, is_active);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON public.usage_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_logs_telegram_id ON public.usage_logs(telegram_id);
CREATE INDEX IF NOT EXISTS idx_reports_status_created_at ON public.reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_telegram_id ON public.reports(telegram_id);

-- 7) Functions & triggers
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_updated_at ON public.users;
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

CREATE OR REPLACE FUNCTION public.add_credits_to_user(user_telegram_id BIGINT, credits_amount INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.users
  SET credits = GREATEST(0, COALESCE(credits, 0) + credits_amount),
      last_active = now(),
      updated_at = now()
  WHERE telegram_id = user_telegram_id;
END;
$$;

REVOKE ALL ON FUNCTION public.add_credits_to_user(BIGINT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_credits_to_user(BIGINT, INTEGER) FROM anon, authenticated;

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
    plan_expires_at,
    last_credit_reset,
    last_active
  )
  VALUES (
    p_telegram_id,
    'User',
    p_plan,
    GREATEST(0, COALESCE(p_credits, 0)),
    CASE
      WHEN p_duration_days > 0 THEN now() + make_interval(days => p_duration_days)
      ELSE NULL
    END,
    now(),
    now()
  )
  ON CONFLICT (telegram_id) DO UPDATE
  SET plan = EXCLUDED.plan,
      credits = GREATEST(0, COALESCE(public.users.credits, 0) + COALESCE(p_credits, 0)),
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

CREATE OR REPLACE FUNCTION public.increment_ad_metric(ad_id UUID, is_click BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF is_click THEN
    UPDATE public.ads SET clicks = COALESCE(clicks, 0) + 1 WHERE id = ad_id;
  ELSE
    UPDATE public.ads SET views = COALESCE(views, 0) + 1 WHERE id = ad_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_ad_metric(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_ad_metric(UUID, BOOLEAN) FROM anon, authenticated;

-- The backend calls these functions with the service-role key. Revoking from
-- PUBLIC also removes EXECUTE from service_role, so grant it explicitly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.add_credits_to_user(BIGINT, INTEGER) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.apply_plan_purchase(BIGINT, TEXT, INTEGER, INTEGER) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.increment_ad_metric(UUID, BOOLEAN) TO service_role';
  END IF;
END $$;

-- 8) Row Level Security
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Rebuild public read policies from a clean slate.
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN (SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

CREATE POLICY "faqs_read_public" ON public.faqs
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "tasks_read_public" ON public.tasks
  FOR SELECT TO anon, authenticated USING (active = TRUE);

CREATE POLICY "ads_read_public" ON public.ads
  FOR SELECT TO anon, authenticated USING (active = TRUE);

-- All other tables: no client policies -> deny by default for anon/authenticated.
-- The backend service role bypasses RLS.

-- 9) Seed data
INSERT INTO public.faqs (question, answer, category)
SELECT * FROM (
  VALUES
    ('What is Flash AI?', 'Flash AI is a powerful Telegram Mini App that uses advanced artificial intelligence to analyze football matches and provide high-accuracy betting predictions and insights.', 'general'),
    ('How do I get more credits?', 'You can get more credits by upgrading to a Monthly Basic or Monthly Pro plan, or by completing tasks in the Referral and Earn section.', 'general'),
    ('What are the differences between the plans?', 'Free gives 3 daily credits. Monthly Basic gives 10 daily credits and 2 bet-slip analyses per day. Monthly Pro gives 16 daily credits, 6 bet-slip analyses per day, and unlimited AI chat.', 'subscription'),
    ('How does the Referral system work?', 'Share your unique referral link. When friends join, you receive bonus credits.', 'referral'),
    ('How accurate are the predictions?', 'Our AI analyzes thousands of data points. While no prediction is 100% guaranteed, our models aim for high accuracy.', 'technical')
) AS seed(question, answer, category)
WHERE NOT EXISTS (SELECT 1 FROM public.faqs f WHERE f.question = seed.question);

COMMIT;
