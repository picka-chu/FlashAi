-- User analysis history table for Flash AI
-- Compatible with Supabase/Postgres, safe for repeated runs

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT NOT NULL,
  fixture_id TEXT,
  match TEXT NOT NULL,
  home TEXT NOT NULL,
  away TEXT NOT NULL,
  prediction_market TEXT NOT NULL,
  confidence NUMERIC(5,2) NOT NULL DEFAULT 0,
  reasoning TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'won', 'lost')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_history_telegram_id_created_at
  ON public.user_history (telegram_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_history_status
  ON public.user_history (status);

ALTER TABLE public.user_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_history_select_own" ON public.user_history;
CREATE POLICY "user_history_select_own"
ON public.user_history
FOR SELECT
TO authenticated
USING (telegram_id::text = auth.jwt()->>'sub');

COMMIT;
