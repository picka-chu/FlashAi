-- Production-ready Supabase migration for Flash AI
-- Safe to run multiple times (idempotent where possible)

BEGIN;

-- 0) Extensions required by Supabase/Postgres features used below
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Core tables
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT UNIQUE NOT NULL,
  name TEXT,
  username TEXT,
  photo_url TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'weekly', 'monthly')),
  credits INTEGER NOT NULL DEFAULT 5 CHECK (credits >= 0),
  win_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (win_rate >= 0 AND win_rate <= 100),
  predictions_count INTEGER NOT NULL DEFAULT 0 CHECK (predictions_count >= 0),
  ranking INTEGER NOT NULL DEFAULT 0 CHECK (ranking >= 0),
  referral_rewarded BOOLEAN NOT NULL DEFAULT FALSE,
  last_credit_reset TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.faqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('general', 'subscription', 'referral', 'technical')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.api_cache (
  key TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  reward INTEGER NOT NULL DEFAULT 10 CHECK (reward >= 0),
  url TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT,
  subtitle TEXT,
  image_url TEXT NOT NULL,
  link TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2) Helpful indexes
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON public.users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_last_credit_reset ON public.users(last_credit_reset);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON public.usage_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_logs_telegram_id ON public.usage_logs(telegram_id);
CREATE INDEX IF NOT EXISTS idx_tasks_active ON public.tasks(active);
CREATE INDEX IF NOT EXISTS idx_ads_active ON public.ads(active);
CREATE INDEX IF NOT EXISTS idx_api_cache_expires_at ON public.api_cache(expires_at);

-- 3) Triggers and functions
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
AS $$
BEGIN
  IF credits_amount IS NULL OR credits_amount = 0 THEN
    RETURN;
  END IF;

  UPDATE public.users
  SET credits = GREATEST(0, COALESCE(credits, 0) + credits_amount),
      last_active = now(),
      updated_at = now()
  WHERE telegram_id = user_telegram_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_user_credits(target_telegram_id BIGINT, amount INTEGER)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF amount IS NULL OR amount = 0 THEN
    RETURN;
  END IF;

  UPDATE public.users
  SET credits = GREATEST(0, COALESCE(credits, 0) + amount),
      referral_rewarded = TRUE,
      last_active = now(),
      updated_at = now()
  WHERE telegram_id = target_telegram_id;
END;
$$;

-- 4) Row Level Security (Supabase best-practice defaults)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;

-- Drop old policies if they exist to avoid duplicates/conflicts
DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
DROP POLICY IF EXISTS "users_select_own" ON public.users;
DROP POLICY IF EXISTS "users_update_own" ON public.users;
DROP POLICY IF EXISTS "users_insert_own" ON public.users;
DROP POLICY IF EXISTS "Anyone can view FAQs" ON public.faqs;
DROP POLICY IF EXISTS "faqs_read_public" ON public.faqs;
DROP POLICY IF EXISTS "Service role can manage cache" ON public.api_cache;
DROP POLICY IF EXISTS "cache_service_role_all" ON public.api_cache;
DROP POLICY IF EXISTS "usage_logs_service_role_all" ON public.usage_logs;
DROP POLICY IF EXISTS "tasks_read_public" ON public.tasks;
DROP POLICY IF EXISTS "ads_read_public" ON public.ads;

-- users: each authenticated user can read/insert/update only own row (id = auth.uid())
CREATE POLICY "users_select_own"
ON public.users
FOR SELECT
TO authenticated
USING (id = auth.uid());

CREATE POLICY "users_insert_own"
ON public.users
FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());

CREATE POLICY "users_update_own"
ON public.users
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- faqs/tasks/ads: readable by anon + authenticated
CREATE POLICY "faqs_read_public"
ON public.faqs
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "tasks_read_public"
ON public.tasks
FOR SELECT
TO anon, authenticated
USING (active = true);

CREATE POLICY "ads_read_public"
ON public.ads
FOR SELECT
TO anon, authenticated
USING (active = true);

-- api_cache + usage_logs: no client-side access; service role bypasses RLS by design
-- Keep strict deny-by-default policies for non-service roles.

-- 5) Comments/documentation
COMMENT ON COLUMN public.users.referral_rewarded IS 'Prevents duplicate referral reward processing';
COMMENT ON COLUMN public.users.last_credit_reset IS 'Timestamp of the last daily credit refresh (24-hour cycle)';

-- 6) Seed FAQ data (idempotent)
INSERT INTO public.faqs (question, answer, category)
SELECT *
FROM (
  VALUES
    ('What is Flash AI?', 'Flash AI is a Telegram Mini App that uses artificial intelligence to analyze football matches and provide predictions and insights.', 'general'),
    ('How do I get more credits?', 'You can get more credits by upgrading your plan or by completing tasks in the Referral and Earn section.', 'general'),
    ('What are the differences between the plans?', 'Free plan gives limited daily credits. Paid plans increase daily credits and analysis capacity.', 'subscription'),
    ('How does the referral system work?', 'Share your referral link. When new users join through it, you receive bonus credits.', 'referral'),
    ('How accurate are the predictions?', 'Predictions are data-driven, but no prediction is guaranteed.', 'technical')
) AS seed(question, answer, category)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.faqs f
  WHERE f.question = seed.question
);

COMMIT;
