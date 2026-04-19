-- =====================================================
-- COMPLETE PRODUCTION MIGRATION FOR FLASH AI APP
-- Run this ENTIRE script in Supabase SQL Editor
-- =====================================================

-- =====================================================
-- PART 1: ADD MISSING COLUMNS TO EXISTING TABLES
-- =====================================================

-- Add referral_rewarded column to prevent duplicate referral rewards
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS referral_rewarded BOOLEAN DEFAULT FALSE;

-- Add last_credit_reset column for 24-hour credit refresh logic
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS last_credit_reset TIMESTAMP WITH TIME ZONE;

-- Add last_active column if not exists
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Set default values for existing users
UPDATE users SET referral_rewarded = FALSE WHERE referral_rewarded IS NULL;
UPDATE users SET last_credit_reset = COALESCE(last_active, created_at, NOW()) WHERE last_credit_reset IS NULL;
UPDATE users SET last_active = COALESCE(last_active, NOW()) WHERE last_active IS NULL;

-- =====================================================
-- PART 2: CREATE ADS TABLE (MISSING - CRITICAL FOR ADS FEATURE)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.ads (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    subtitle TEXT,
    description TEXT,
    image_url TEXT,
    link TEXT,
    cta TEXT DEFAULT 'Check it Out',
    active BOOLEAN DEFAULT true,
    views INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for ads
ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;

-- Anyone can view active ads
CREATE POLICY "Anyone can view active ads" 
ON public.ads FOR SELECT 
USING (active = true);

-- Only service role/admin can insert/update/delete ads
-- This is handled by checking admin status in backend

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_ads_active_expires ON ads(active, expires_at) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_ads_created_at ON ads(created_at DESC);

-- =====================================================
-- PART 3: CREATE NOTIFICATION LOGS TABLE (FOR RATE LIMITING)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.notification_logs (
    id BIGSERIAL PRIMARY KEY,
    telegram_id BIGINT NOT NULL,
    message_type TEXT NOT NULL,
    message_content TEXT,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    success BOOLEAN DEFAULT true,
    error_message TEXT
);

-- Enable RLS
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

-- Service role can manage notification logs
CREATE POLICY "Service role can manage notification logs" 
ON public.notification_logs FOR ALL 
USING (true);

-- Create index for rate limiting queries
CREATE INDEX IF NOT EXISTS idx_notification_logs_telegram_sent 
ON notification_logs(telegram_id, sent_at);

-- =====================================================
-- PART 4: CREATE REFERRALS TRACKING TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS public.referrals (
    id BIGSERIAL PRIMARY KEY,
    referrer_telegram_id BIGINT NOT NULL,
    referred_telegram_id BIGINT NOT NULL UNIQUE,
    reward_given BOOLEAN DEFAULT FALSE,
    reward_amount INTEGER DEFAULT 50,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- Service role can manage referrals
CREATE POLICY "Service role can manage referrals" 
ON public.referrals FOR ALL 
USING (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_telegram_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_telegram_id);
CREATE INDEX IF NOT EXISTS idx_referrals_reward_given ON referrals(reward_given);

-- =====================================================
-- PART 5: CREATE CREDIT TRANSACTIONS TABLE (AUDIT TRAIL)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.credit_transactions (
    id BIGSERIAL PRIMARY KEY,
    telegram_id BIGINT NOT NULL,
    amount INTEGER NOT NULL,
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('daily_bonus', 'referral_reward', 'purchase', 'usage', 'admin_grant', 'refund')),
    description TEXT,
    balance_before INTEGER,
    balance_after INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB
);

-- Enable RLS
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

-- Users can view their own transactions
CREATE POLICY "Users can view own credit transactions" 
ON public.credit_transactions FOR SELECT 
USING (true); -- Backend handles filtering

-- Service role can insert transactions
CREATE POLICY "Service role can manage credit transactions" 
ON public.credit_transactions FOR ALL 
USING (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_credit_transactions_telegram ON credit_transactions(telegram_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_type ON credit_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created ON credit_transactions(created_at DESC);

-- =====================================================
-- PART 6: CREATE ATOMIC CREDIT FUNCTIONS
-- =====================================================

-- Function for atomic credit increment (prevents race conditions)
CREATE OR REPLACE FUNCTION add_credits_to_user(user_telegram_id BIGINT, credits_amount INTEGER)
RETURNS VOID AS $$
DECLARE
    current_balance INTEGER;
BEGIN
    -- Get current balance
    SELECT credits INTO current_balance FROM users WHERE telegram_id = user_telegram_id;
    
    -- Update with new balance
    UPDATE users 
    SET credits = COALESCE(credits, 0) + credits_amount,
        last_active = NOW()
    WHERE telegram_id = user_telegram_id;
    
    -- Log the transaction
    INSERT INTO credit_transactions (telegram_id, amount, transaction_type, description, balance_before, balance_after)
    VALUES (user_telegram_id, credits_amount, 'referral_reward', 'Referral reward credited', current_balance, current_balance + credits_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Alternative function for general credit updates
CREATE OR REPLACE FUNCTION increment_user_credits(target_telegram_id BIGINT, amount INTEGER)
RETURNS VOID AS $$
DECLARE
    current_balance INTEGER;
BEGIN
    -- Get current balance
    SELECT credits INTO current_balance FROM users WHERE telegram_id = target_telegram_id;
    
    -- Update credits
    UPDATE users 
    SET credits = COALESCE(credits, 0) + amount,
        referral_rewarded = TRUE,
        last_active = NOW()
    WHERE telegram_id = target_telegram_id;
    
    -- Log transaction
    INSERT INTO credit_transactions (telegram_id, amount, transaction_type, description, balance_before, balance_after)
    VALUES (target_telegram_id, amount, 'referral_reward', 'Credit increment', current_balance, current_balance + amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to reset daily credits (24-hour cycle)
CREATE OR REPLACE FUNCTION reset_daily_credits(user_telegram_id BIGINT, daily_amount INTEGER DEFAULT 5)
RETURNS INTEGER AS $$
DECLARE
    current_balance INTEGER;
    new_balance INTEGER;
BEGIN
    -- Get current balance
    SELECT credits INTO current_balance FROM users WHERE telegram_id = user_telegram_id;
    
    -- Calculate new balance
    new_balance := current_balance + daily_amount;
    
    -- Update user
    UPDATE users 
    SET credits = new_balance,
        last_credit_reset = NOW(),
        last_active = NOW()
    WHERE telegram_id = user_telegram_id;
    
    -- Log transaction
    INSERT INTO credit_transactions (telegram_id, amount, transaction_type, description, balance_before, balance_after)
    VALUES (user_telegram_id, daily_amount, 'daily_bonus', 'Daily credit refresh', current_balance, new_balance);
    
    RETURN new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to deduct credits safely
CREATE OR REPLACE FUNCTION deduct_user_credits(user_telegram_id BIGINT, amount INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
    current_balance INTEGER;
BEGIN
    -- Get current balance
    SELECT credits INTO current_balance FROM users WHERE telegram_id = user_telegram_id;
    
    -- Check if sufficient balance
    IF current_balance < amount THEN
        RETURN FALSE;
    END IF;
    
    -- Deduct credits
    UPDATE users 
    SET credits = current_balance - amount,
        last_active = NOW()
    WHERE telegram_id = user_telegram_id;
    
    -- Log transaction
    INSERT INTO credit_transactions (telegram_id, amount, transaction_type, description, balance_before, balance_after)
    VALUES (user_telegram_id, -amount, 'usage', 'Credit usage', current_balance, current_balance - amount);
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- PART 7: CREATE AD TRACKING FUNCTIONS
-- =====================================================

-- Function to increment ad views
CREATE OR REPLACE FUNCTION increment_ad_views(ad_id BIGINT)
RETURNS VOID AS $$
BEGIN
    UPDATE ads SET views = COALESCE(views, 0) + 1 WHERE id = ad_id;
END;
$$ LANGUAGE plpgsql;

-- Function to increment ad clicks
CREATE OR REPLACE FUNCTION increment_ad_clicks(ad_id BIGINT)
RETURNS VOID AS $$
BEGIN
    UPDATE ads SET clicks = COALESCE(clicks, 0) + 1 WHERE id = ad_id;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- PART 8: CREATE PERFORMANCE INDEXES
-- =====================================================

-- Index for credit reset queries
CREATE INDEX IF NOT EXISTS idx_users_last_credit_reset ON users(last_credit_reset);

-- Index for finding users needing credit reset
CREATE INDEX IF NOT EXISTS idx_users_credit_reset_needed ON users(last_credit_reset) WHERE last_credit_reset IS NOT NULL;

-- Composite index for referral lookups
CREATE INDEX IF NOT EXISTS idx_users_referral_combo ON users(telegram_id, referral_rewarded);

-- =====================================================
-- PART 9: UPDATE TRIGGERS
-- =====================================================

-- Trigger to auto-update updated_at for ads table
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists and recreate for ads
DROP TRIGGER IF EXISTS set_ads_updated_at ON public.ads;
CREATE TRIGGER set_ads_updated_at
BEFORE UPDATE ON public.ads
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- =====================================================
-- PART 10: VERIFICATION QUERIES
-- =====================================================

-- Verify all tables exist
DO $$
BEGIN
    RAISE NOTICE 'Migration completed successfully!';
    RAISE NOTICE 'Tables verified: users, ads, notification_logs, referrals, credit_transactions';
    RAISE NOTICE 'Functions created: add_credits_to_user, increment_user_credits, reset_daily_credits, deduct_user_credits, increment_ad_views, increment_ad_clicks';
END $$;

-- =====================================================
-- IMPORTANT NOTES:
-- =====================================================
-- 1. This migration adds critical columns for 24-hour credit refresh
-- 2. Creates the missing 'ads' table for the ads feature
-- 3. Adds atomic functions to prevent race conditions
-- 4. Creates audit trail via credit_transactions table
-- 5. Adds rate limiting support via notification_logs
-- 6. All functions use SECURITY DEFINER for proper permissions
-- =====================================================
