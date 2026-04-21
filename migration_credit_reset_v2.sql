-- Migration: Credit Reset System v2.0 (Midnight Reset)
-- This migration enhances the credit system for professional midnight resets
-- Safe to run multiple times (idempotent)

BEGIN;

-- 1. Ensure credit_transactions table exists for audit trail
CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT NOT NULL,
  amount INTEGER NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('daily_reset', 'referral_reward', 'purchase', 'deduction', 'bonus', 'admin_adjustment')),
  description TEXT,
  balance_before INTEGER,
  balance_after INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Enable RLS on credit_transactions
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

-- 3. Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_credit_transactions_telegram ON public.credit_transactions(telegram_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_type ON public.credit_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created ON public.credit_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_telegram_created ON public.credit_transactions(telegram_id, created_at DESC);

-- 4. Ensure users table has required columns for midnight reset
ALTER TABLE public.users 
  ADD COLUMN IF NOT EXISTS last_credit_reset TIMESTAMPTZ NOT NULL DEFAULT now();

-- 5. Create index for efficient reset queries
CREATE INDEX IF NOT EXISTS idx_users_last_credit_reset ON public.users(last_credit_reset);

-- 6. Create partial index for users needing reset (optimization)
CREATE INDEX IF NOT EXISTS idx_users_credit_reset_needed ON public.users(last_credit_reset) 
  WHERE last_credit_reset < now() - interval '1 day';

-- 7. Create function to safely reset user credits
CREATE OR REPLACE FUNCTION public.reset_daily_credits(
  user_telegram_id BIGINT,
  daily_amount INTEGER DEFAULT 5
)
RETURNS TABLE(success BOOLEAN, new_balance INTEGER, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_balance INTEGER;
  new_balance INTEGER;
BEGIN
  -- Get current balance
  SELECT credits INTO current_balance FROM public.users 
  WHERE telegram_id = user_telegram_id;
  
  IF current_balance IS NULL THEN
    RETURN QUERY SELECT false, 0, 'User not found'::TEXT;
    RETURN;
  END IF;

  -- Calculate new balance (preserve bonus credits)
  new_balance := GREATEST(current_balance, daily_amount);

  -- Update user
  UPDATE public.users
  SET credits = new_balance,
      last_credit_reset = now(),
      last_active = now(),
      updated_at = now()
  WHERE telegram_id = user_telegram_id;

  -- Log transaction
  INSERT INTO public.credit_transactions (
    telegram_id, 
    amount, 
    transaction_type, 
    description, 
    balance_before, 
    balance_after
  ) VALUES (
    user_telegram_id,
    daily_amount,
    'daily_reset',
    'Daily midnight credit refresh',
    current_balance,
    new_balance
  );

  RETURN QUERY SELECT true, new_balance, 'Credits reset successfully'::TEXT;
END;
$$;

-- 8. Create function to get users needing reset
CREATE OR REPLACE FUNCTION public.get_users_needing_reset()
RETURNS TABLE(
  telegram_id BIGINT,
  plan TEXT,
  credits INTEGER,
  created_at TIMESTAMPTZ,
  last_credit_reset TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.telegram_id,
    u.plan,
    u.credits,
    u.created_at,
    u.last_credit_reset
  FROM public.users u
  WHERE u.last_credit_reset < now()::date
  ORDER BY u.last_credit_reset ASC;
END;
$$;

-- 9. Create function to get credit reset statistics
CREATE OR REPLACE FUNCTION public.get_credit_reset_stats()
RETURNS TABLE(
  total_users BIGINT,
  users_needing_reset BIGINT,
  total_credits_distributed BIGINT,
  last_reset_time TIMESTAMPTZ,
  resets_today BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (SELECT COUNT(*) FROM public.users)::BIGINT,
    (SELECT COUNT(*) FROM public.users WHERE last_credit_reset < now()::date)::BIGINT,
    (SELECT COALESCE(SUM(amount), 0) FROM public.credit_transactions WHERE transaction_type = 'daily_reset' AND created_at >= now()::date)::BIGINT,
    (SELECT MAX(created_at) FROM public.credit_transactions WHERE transaction_type = 'daily_reset')::TIMESTAMPTZ,
    (SELECT COUNT(*) FROM public.credit_transactions WHERE transaction_type = 'daily_reset' AND created_at >= now()::date)::BIGINT;
END;
$$;

-- 10. Create RLS policies for credit_transactions
DROP POLICY IF EXISTS "Users can view own credit transactions" ON public.credit_transactions;
CREATE POLICY "Users can view own credit transactions" 
  ON public.credit_transactions FOR SELECT 
  TO authenticated 
  USING (telegram_id = (auth.jwt() ->> 'sub')::BIGINT);

DROP POLICY IF EXISTS "Service role can manage credit transactions" ON public.credit_transactions;
CREATE POLICY "Service role can manage credit transactions" 
  ON public.credit_transactions FOR ALL 
  TO service_role 
  USING (true);

-- 11. Update existing last_credit_reset values if NULL
UPDATE public.users 
SET last_credit_reset = COALESCE(last_active, created_at, now())
WHERE last_credit_reset IS NULL;

-- 12. Add comment for documentation
COMMENT ON COLUMN public.users.last_credit_reset IS 'Timestamp of the last daily credit reset at 00:00 UTC';
COMMENT ON TABLE public.credit_transactions IS 'Audit trail for all credit transactions including daily resets';
COMMENT ON FUNCTION public.reset_daily_credits IS 'Safely reset daily credits for a user, preserving bonus credits';
COMMENT ON FUNCTION public.get_users_needing_reset IS 'Get all users whose last reset was before today';
COMMENT ON FUNCTION public.get_credit_reset_stats IS 'Get statistics about credit resets';

COMMIT;

-- Verification
SELECT 'Migration completed successfully' AS status;
SELECT COUNT(*) as total_users, 
       COUNT(*) FILTER (WHERE last_credit_reset < now()::date) as users_needing_reset
FROM public.users;
