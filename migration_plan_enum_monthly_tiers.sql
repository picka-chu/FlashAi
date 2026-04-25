-- Ensure users.plan supports the active paid tiers used by the app.
-- This migration is safe to run on environments where `plan` is either:
-- 1) an enum column (type `user_plan`), or
-- 2) a text column guarded by a CHECK constraint.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'user_plan'
  ) THEN
    ALTER TYPE user_plan ADD VALUE IF NOT EXISTS 'monthly_basic';
    ALTER TYPE user_plan ADD VALUE IF NOT EXISTS 'monthly_pro';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'plan'
  ) THEN
    ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_plan_check;
    ALTER TABLE public.users
      ADD CONSTRAINT users_plan_check
      CHECK (plan IN ('free', 'monthly_basic', 'monthly_pro', 'admin', 'weekly', 'monthly'));
  END IF;
END $$;
