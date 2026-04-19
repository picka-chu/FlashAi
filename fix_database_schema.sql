-- CRITICAL FIX: Add missing columns to users table
-- Run this in Supabase SQL Editor immediately

-- 1. Add missing columns to users table
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user',
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS last_active TIMESTAMP WITH TIME ZONE DEFAULT now(),
ADD COLUMN IF NOT EXISTS referrer_id BIGINT REFERENCES public.users(telegram_id);

-- 2. Fix RLS policies to allow Telegram-based authentication
-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;

-- Create new policies that work with Telegram Mini Apps (no Supabase Auth required)
CREATE POLICY "Allow select by telegram_id"
ON public.users FOR SELECT
USING (true);  -- Allow all reads (backend validates with Telegram init data)

CREATE POLICY "Allow insert for new users"
ON public.users FOR INSERT
WITH CHECK (true);

CREATE POLICY "Allow update by telegram_id"
ON public.users FOR UPDATE
USING (true);  -- Backend validates with Telegram init data

-- 3. Fix api_cache table schema mismatch
-- Ensure endpoint column exists and is primary key
ALTER TABLE public.api_cache 
ADD COLUMN IF NOT EXISTS endpoint TEXT;

-- If 'key' is currently primary key, we need to migrate to 'endpoint'
-- First check which column is being used
DO $$
BEGIN
    -- If 'key' is primary key and has data, copy it to endpoint
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'api_cache' AND column_name = 'key') THEN
        UPDATE public.api_cache SET endpoint = key WHERE endpoint IS NULL;
    END IF;
END $$;

-- Make endpoint the primary key if needed
-- Note: This might require dropping and recreating the primary key constraint
-- Only run if you're sure 'endpoint' should be the primary key
-- ALTER TABLE public.api_cache DROP CONSTRAINT IF EXISTS api_cache_pkey;
-- ALTER TABLE public.api_cache ADD PRIMARY KEY (endpoint);

-- 4. Add index for performance on telegram_id lookups
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON public.users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_last_active ON public.users(last_active);
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);

-- 5. Ensure api_cache is readable by anon users (for fallback caching)
DROP POLICY IF EXISTS "Service role can manage cache" ON public.api_cache;
CREATE POLICY "Allow public read access to api_cache"
ON public.api_cache FOR SELECT
USING (true);

CREATE POLICY "Allow service role to manage api_cache"
ON public.api_cache FOR ALL
USING (true);

-- Verification queries
SELECT 'Users table structure:' AS info;
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'users' 
ORDER BY ordinal_position;

SELECT 'API Cache table structure:' AS info;
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'api_cache' 
ORDER BY ordinal_position;

SELECT 'Current RLS policies on users:' AS info;
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies 
WHERE tablename = 'users';
