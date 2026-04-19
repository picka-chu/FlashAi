-- Adds explicit subscription expiry tracking for weekly/monthly plans.
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_users_plan_expires_at ON public.users(plan_expires_at);
