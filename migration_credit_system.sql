-- Migration: Add referral_rewarded and last_credit_reset columns to users table
-- Run this in your Supabase SQL Editor

-- Add referral_rewarded column to prevent duplicate referral rewards
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS referral_rewarded BOOLEAN DEFAULT FALSE;

-- Add last_credit_reset column for 24-hour credit refresh logic
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS last_credit_reset TIMESTAMP WITH TIME ZONE;

-- Create function for atomic credit increment (prevents race conditions)
CREATE OR REPLACE FUNCTION add_credits_to_user(user_telegram_id BIGINT, credits_amount INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE users 
  SET credits = COALESCE(credits, 0) + credits_amount,
      last_active = NOW()
  WHERE telegram_id = user_telegram_id;
END;
$$ LANGUAGE plpgsql;

-- Create function as alternative fallback
CREATE OR REPLACE FUNCTION increment_user_credits(target_telegram_id BIGINT, amount INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE users 
  SET credits = COALESCE(credits, 0) + amount,
      referral_rewarded = TRUE,
      last_active = NOW()
  WHERE telegram_id = target_telegram_id;
END;
$$ LANGUAGE plpgsql;

-- Set default value for existing users
UPDATE users SET referral_rewarded = FALSE WHERE referral_rewarded IS NULL;
UPDATE users SET last_credit_reset = last_active WHERE last_credit_reset IS NULL AND last_active IS NOT NULL;
UPDATE users SET last_credit_reset = created_at WHERE last_credit_reset IS NULL AND created_at IS NOT NULL;
UPDATE users SET last_credit_reset = NOW() WHERE last_credit_reset IS NULL;

-- Create index for better performance on credit reset queries
CREATE INDEX IF NOT EXISTS idx_users_last_credit_reset ON users(last_credit_reset);

COMMENT ON COLUMN users.referral_rewarded IS 'Prevents duplicate referral reward processing';
COMMENT ON COLUMN users.last_credit_reset IS 'Timestamp of last daily credit refresh (24-hour cycle)';
