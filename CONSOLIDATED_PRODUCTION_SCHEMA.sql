-- Consolidated Production-ready Supabase migration for Flash AI
-- This script merges all necessary columns, tables, and security policies.
-- It is designed to be idempotent (safe to run multiple times).

BEGIN;

-- 0) Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Core Tables

-- Users Table
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT UNIQUE NOT NULL,
  name TEXT,
  username TEXT,
  phone TEXT,
  photo_url TEXT,
  referrer_id BIGINT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'weekly', 'monthly', 'monthly_basic', 'monthly_pro', 'admin')),
  credits INTEGER NOT NULL DEFAULT 5 CHECK (credits >= 0),
  win_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (win_rate >= 0 AND win_rate <= 100),
  predictions_count INTEGER NOT NULL DEFAULT 0 CHECK (predictions_count >= 0),
  ranking INTEGER NOT NULL DEFAULT 0 CHECK (ranking >= 0),
  referral_rewarded BOOLEAN NOT NULL DEFAULT FALSE,
  last_credit_reset TIMESTAMPTZ NOT NULL DEFAULT now(),
  plan_expires_at TIMESTAMPTZ,
  last_active TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- FAQs Table
CREATE TABLE IF NOT EXISTS public.faqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('general', 'subscription', 'referral', 'technical')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- API Cache Table
CREATE TABLE IF NOT EXISTS public.api_cache (
  endpoint TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User History Table
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

-- Tasks Table
CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  reward INTEGER NOT NULL DEFAULT 10 CHECK (reward >= 0),
  url TEXT,
  buttonLabel TEXT DEFAULT 'Start Task',
  image_url TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ads Table
CREATE TABLE IF NOT EXISTS public.ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT,
  subtitle TEXT,
  image_url TEXT NOT NULL,
  link TEXT,
  cta TEXT DEFAULT 'Check Out',
  target_group TEXT DEFAULT 'all',
  primary_color TEXT DEFAULT '#3b82f6',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2) Indexes
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON public.users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);
CREATE INDEX IF NOT EXISTS idx_user_history_telegram_id ON public.user_history(telegram_id);
CREATE INDEX IF NOT EXISTS idx_user_history_created_at ON public.user_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_cache_updated_at ON public.api_cache(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_active ON public.tasks(active);
CREATE INDEX IF NOT EXISTS idx_ads_active ON public.ads(active);

-- 3) Functions & Triggers

-- Updated At Trigger Function
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Apply Updated At to Users
DROP TRIGGER IF EXISTS set_updated_at ON public.users;
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- Credit Management Functions (Security Definer to bypass RLS when called by backend)
CREATE OR REPLACE FUNCTION public.add_credits_to_user(user_telegram_id BIGINT, credits_amount INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.users
  SET credits = GREATEST(0, COALESCE(credits, 0) + credits_amount),
      last_active = now(),
      updated_at = now()
  WHERE telegram_id = user_telegram_id;
END;
$$;

-- 4) Row Level Security (RLS)
-- The backend uses the Service Role Key, so it bypasses RLS.
-- These policies are for the frontend (Anon Key) to safely read public data.

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to ensure clean state
DO $$ 
DECLARE 
    pol record;
BEGIN
    FOR pol IN (SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public') 
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, pol.tablename);
    END LOOP;
END $$;

-- Users: No direct client access to users table (all via backend)
-- FAQs: Publicly readable
CREATE POLICY "faqs_read_public" ON public.faqs FOR SELECT TO anon, authenticated USING (true);

-- Tasks: Publicly readable if active
CREATE POLICY "tasks_read_public" ON public.tasks FOR SELECT TO anon, authenticated USING (active = true);

-- Ads: Publicly readable if active
CREATE POLICY "ads_read_public" ON public.ads FOR SELECT TO anon, authenticated USING (active = true);

-- User History: No direct client access (all via backend)
-- API Cache: No direct client access (all via backend)

-- 5) Seed Data
INSERT INTO public.faqs (question, answer, category)
SELECT * FROM (
  VALUES
    ('What is Flash AI?', 'Flash AI is a powerful Telegram Mini App that uses advanced artificial intelligence to analyze football matches and provide high-accuracy betting predictions and insights.', 'general'),
    ('How do I get more credits?', 'You can get more credits by upgrading to a Weekly or Monthly plan, or by completing tasks in the Referral and Earn section.', 'general'),
    ('What are the differences between the plans?', 'Free plan gives 5 daily credits. Weekly gives 35 daily credits. Monthly gives 120 daily credits and unlimited AI chat.', 'subscription'),
    ('How does the Referral system work?', 'Share your unique referral link. When friends join, you receive bonus credits.', 'referral'),
    ('How accurate are the predictions?', 'Our AI analyzes thousands of data points. While no prediction is 100% guaranteed, our models aim for high accuracy.', 'technical')
) AS seed(question, answer, category)
WHERE NOT EXISTS (SELECT 1 FROM public.faqs f WHERE f.question = seed.question);

COMMIT;
