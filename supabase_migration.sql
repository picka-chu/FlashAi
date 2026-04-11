-- Migration file for Flash AI Supabase Database

-- 1. Create the users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_id BIGINT UNIQUE NOT NULL,
    username TEXT,
    full_name TEXT,
    phone_number TEXT,
    role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Enable Row Level Security (Optional but recommended)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- 3. Create basic policies (Adjust based on your security needs)
-- Note: Since the Telegram bot handles registration server-side, 
-- you might want to use the Service Role Key to bypass RLS in server.ts.
-- If using the Anon Key, these policies allow basic operations:

-- Allow anyone to check if a user exists (needed for bot start)
CREATE POLICY "Allow public select" ON users FOR SELECT USING (true);

-- Allow anyone to register (needed for bot contact handler)
CREATE POLICY "Allow public insert" ON users FOR INSERT WITH CHECK (true);

-- Allow users to update their own info (if needed later)
-- This is a simple policy; in production, you'd want more strict checks.
CREATE POLICY "Allow individual update" ON users FOR UPDATE USING (true);

-- 4. (Optional) Create a matches table if you want to store fixtures in the DB later
/*
CREATE TABLE IF NOT EXISTS matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    league TEXT NOT NULL,
    match_time TIMESTAMPTZ NOT NULL,
    home_logo TEXT,
    away_logo TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
*/
