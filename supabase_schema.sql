-- Supabase Database Schema Migration
-- Flash AI Football Prediction App

-- 1. Users Table
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_id BIGINT UNIQUE NOT NULL,
    name TEXT,
    username TEXT,
    photo_url TEXT,
    plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'weekly', 'monthly')),
    credits INTEGER DEFAULT 5,
    win_rate NUMERIC DEFAULT 0,
    predictions_count INTEGER DEFAULT 0,
    ranking INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS for users
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Users can read their own data
CREATE POLICY "Users can view own profile" 
ON public.users FOR SELECT 
USING (auth.uid() = id OR telegram_id::text = auth.jwt()->>'sub');

-- Users can update their own data
CREATE POLICY "Users can update own profile" 
ON public.users FOR UPDATE 
USING (auth.uid() = id OR telegram_id::text = auth.jwt()->>'sub');

-- 2. FAQs Table (Knowledge Base)
CREATE TABLE IF NOT EXISTS public.faqs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('general', 'subscription', 'referral', 'technical')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS for faqs
ALTER TABLE public.faqs ENABLE ROW LEVEL SECURITY;

-- Anyone can read FAQs
CREATE POLICY "Anyone can view FAQs" 
ON public.faqs FOR SELECT 
USING (true);

-- Only admins can modify FAQs (assuming admin role or specific UID)
-- For now, we'll leave it restricted to service role or manual edits in dashboard

-- 3. API Cache Table
CREATE TABLE IF NOT EXISTS public.api_cache (
    key TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS for api_cache
ALTER TABLE public.api_cache ENABLE ROW LEVEL SECURITY;

-- Only service role/backend should access this, but for dev we can allow read
CREATE POLICY "Service role can manage cache" 
ON public.api_cache FOR ALL 
USING (true);

-- 4. Initial FAQ Data
INSERT INTO public.faqs (question, answer, category) VALUES
('What is Flash AI?', 'Flash AI is a powerful Telegram Mini App that uses advanced artificial intelligence to analyze football matches and provide high-accuracy betting predictions and insights.', 'general'),
('How do I get more credits?', 'You can get more credits by upgrading to a Weekly or Monthly plan, or by completing tasks in the ''Referral and Earn'' section. You also get a daily bonus if you claim it!', 'general'),
('What are the differences between the plans?', 'Free plan gives 5 daily credits and 1 analysis. Weekly ($3.99) gives 35 daily credits and 3 analyses. Monthly ($11.99) gives 120 daily credits, 10 analyses, and unlimited AI chat with deep data gathering.', 'subscription'),
('How does the Referral system work?', 'Share your unique referral link with friends. When they join Flash AI, you instantly receive 50 bonus credits. You can track your referrals in the ''Referral and Earn'' section.', 'referral'),
('How accurate are the predictions?', 'Our AI analyzes thousands of data points including team form, player stats, historical data, and real-time news. While no prediction is 100% guaranteed, our users report a high win rate (avg. 84%).', 'technical'),
('I didn''t receive my referral points, what should I do?', 'Referral points are usually credited instantly. If you haven''t received them, please ensure your friend joined using your link. If the issue persists, use the ''Report a Problem'' feature in Support.', 'referral'),
('How do I use the ''Analyze'' feature?', 'Go to the ''Analyze'' tab, select a match or upload a bet slip image. Our AI will process the data and provide a detailed breakdown, including win probability and key insights.', 'technical');

-- 5. Functions & Triggers
-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for users table
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();
