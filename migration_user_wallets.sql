-- User connected wallets (TON and future chains).
-- Superseded by CONSOLIDATED_PRODUCTION_SCHEMA.sql, but kept as a standalone,
-- idempotent migration for existing deployments.

BEGIN;

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

CREATE UNIQUE INDEX IF NOT EXISTS user_wallets_telegram_wallet_uq
  ON public.user_wallets (telegram_id, wallet_address);

CREATE INDEX IF NOT EXISTS user_wallets_telegram_id_idx
  ON public.user_wallets (telegram_id);

CREATE INDEX IF NOT EXISTS user_wallets_active_idx
  ON public.user_wallets (telegram_id, is_active);

ALTER TABLE public.user_wallets ENABLE ROW LEVEL SECURITY;

-- Wallets are managed exclusively by the backend (service role bypasses RLS).
-- Wallets are only exposed through the authenticated API, so no client policy
-- is created: anon/authenticated access is denied by default.
DROP POLICY IF EXISTS "wallets_select_own" ON public.user_wallets;

COMMIT;
