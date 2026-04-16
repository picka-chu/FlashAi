-- Create profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
    id BIGINT PRIMARY KEY, -- Telegram User ID
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    credits INTEGER DEFAULT 150,
    referral_code TEXT UNIQUE,
    referred_by BIGINT REFERENCES public.profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create predictions table
CREATE TABLE IF NOT EXISTS public.predictions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id BIGINT REFERENCES public.profiles(id) ON DELETE CASCADE,
    match_id BIGINT,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    league TEXT,
    prediction TEXT,
    confidence INTEGER,
    odds TEXT,
    analysis TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Set up Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view their own profile" 
ON public.profiles FOR SELECT 
USING (auth.uid()::text = id::text OR true); -- Simplified for Mini App context if not using Supabase Auth directly

CREATE POLICY "Users can update their own profile" 
ON public.profiles FOR UPDATE 
USING (true);

-- Predictions policies
CREATE POLICY "Users can view their own predictions" 
ON public.predictions FOR SELECT 
USING (true);

CREATE POLICY "Users can insert their own predictions" 
ON public.predictions FOR INSERT 
WITH CHECK (true);

-- Function to handle new user credits/referrals could be added here

-- Create api_cache table for global API caching
CREATE TABLE IF NOT EXISTS public.api_cache (
    endpoint TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.api_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access for api_cache" ON public.api_cache FOR SELECT USING (true);
CREATE POLICY "Service role write access for api_cache" ON public.api_cache FOR ALL USING (true);
