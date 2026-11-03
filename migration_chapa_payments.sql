-- Chapa (Ethiopian Birr) payment support.
--
-- Stores each hosted-checkout attempt so webhook/verify callbacks can be tied
-- back to the Telegram user and plan, and so amounts can be checked before a
-- plan is activated. Run once in the Supabase Dashboard -> SQL Editor.
-- Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS public.chapa_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT NOT NULL,
  plan_id TEXT NOT NULL,
  merchant_reference TEXT NOT NULL UNIQUE,
  chapa_reference TEXT,
  amount_etb NUMERIC(18, 2) NOT NULL,
  amount_cents BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ETB',
  rate NUMERIC(18, 4) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'success', 'failed', 'cancelled', 'incomplete', 'expired')),
  checkout_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_chapa_payments_telegram
  ON public.chapa_payments(telegram_id, created_at DESC);

ALTER TABLE public.chapa_payments ENABLE ROW LEVEL SECURITY;

COMMIT;
