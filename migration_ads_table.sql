-- ============================================================
-- Flash AI — Ads Table Migration
-- Run this in your Supabase SQL editor (Dashboard → SQL Editor)
-- ============================================================

-- 1. Create the ads table with every column the app expects
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ads (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  title             text          NOT NULL,
  subtitle          text          NOT NULL,
  image_url         text,
  link              text,
  is_internal       boolean       NOT NULL DEFAULT false,
  internal_target   text,
  cta               text          NOT NULL DEFAULT 'Check Out',
  active            boolean       NOT NULL DEFAULT true,
  target_group      text          NOT NULL DEFAULT 'all',
  expires_at        timestamptz,

  -- Gradient / colour customisation
  primary_color     text          NOT NULL DEFAULT '#3b82f6',
  gradient_to       text          NOT NULL DEFAULT '#8b5cf6',

  -- Text colours
  hero_color        text          NOT NULL DEFAULT '#ffffff',
  sub_color         text          NOT NULL DEFAULT '#e4e4e7',
  button_color      text          NOT NULL DEFAULT '#ffffff',
  button_text_color text          NOT NULL DEFAULT '#111827',

  -- Typography sizes (px, stored as numeric)
  hero_size         numeric       NOT NULL DEFAULT 32,
  sub_size          numeric       NOT NULL DEFAULT 18,
  button_text_size  numeric       NOT NULL DEFAULT 14,

  -- Button shape
  button_radius     numeric       NOT NULL DEFAULT 999,
  button_pad_x      numeric       NOT NULL DEFAULT 20,
  button_pad_y      numeric       NOT NULL DEFAULT 8,

  -- Analytics
  views             integer       NOT NULL DEFAULT 0,
  clicks            integer       NOT NULL DEFAULT 0,

  created_at        timestamptz   NOT NULL DEFAULT now()
);

-- 2. Row Level Security — only the service role can write; anyone can read active ads
-- ------------------------------------------------------------
ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;

-- Allow the service-role key (used by the backend) to do everything
CREATE POLICY "service role full access" ON public.ads
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Optional: if you want the anon key to read active ads directly
-- (not needed if the backend always proxies requests)
-- CREATE POLICY "public read active ads" ON public.ads
--   FOR SELECT
--   USING (active = true);

-- 3. Indexes for common query patterns
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ads_active_created_at
  ON public.ads (active, created_at DESC);

CREATE INDEX IF NOT EXISTS ads_target_group
  ON public.ads (target_group);

CREATE INDEX IF NOT EXISTS ads_expires_at
  ON public.ads (expires_at)
  WHERE expires_at IS NOT NULL;

-- 4. If the table already exists but is missing the styling columns,
--    run these ALTER statements instead of the CREATE TABLE above.
--    Safe to run — each uses IF NOT EXISTS / does nothing if column exists.
-- ------------------------------------------------------------
DO $$
BEGIN
  -- Colours
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='gradient_to')        THEN ALTER TABLE public.ads ADD COLUMN gradient_to       text NOT NULL DEFAULT '#8b5cf6'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='hero_color')         THEN ALTER TABLE public.ads ADD COLUMN hero_color        text NOT NULL DEFAULT '#ffffff'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='sub_color')          THEN ALTER TABLE public.ads ADD COLUMN sub_color         text NOT NULL DEFAULT '#e4e4e7'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='button_color')       THEN ALTER TABLE public.ads ADD COLUMN button_color      text NOT NULL DEFAULT '#ffffff'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='button_text_color')  THEN ALTER TABLE public.ads ADD COLUMN button_text_color text NOT NULL DEFAULT '#111827'; END IF;
  -- Sizes
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='hero_size')          THEN ALTER TABLE public.ads ADD COLUMN hero_size         numeric NOT NULL DEFAULT 32;  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='sub_size')           THEN ALTER TABLE public.ads ADD COLUMN sub_size          numeric NOT NULL DEFAULT 18;  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='button_text_size')   THEN ALTER TABLE public.ads ADD COLUMN button_text_size  numeric NOT NULL DEFAULT 14;  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='button_radius')      THEN ALTER TABLE public.ads ADD COLUMN button_radius     numeric NOT NULL DEFAULT 999; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='button_pad_x')       THEN ALTER TABLE public.ads ADD COLUMN button_pad_x      numeric NOT NULL DEFAULT 20;  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='button_pad_y')       THEN ALTER TABLE public.ads ADD COLUMN button_pad_y      numeric NOT NULL DEFAULT 8;   END IF;
  -- Other
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='is_internal')        THEN ALTER TABLE public.ads ADD COLUMN is_internal       boolean NOT NULL DEFAULT false; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='internal_target')    THEN ALTER TABLE public.ads ADD COLUMN internal_target   text; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='cta')                THEN ALTER TABLE public.ads ADD COLUMN cta               text NOT NULL DEFAULT 'Check Out'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='target_group')       THEN ALTER TABLE public.ads ADD COLUMN target_group      text NOT NULL DEFAULT 'all'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='expires_at')         THEN ALTER TABLE public.ads ADD COLUMN expires_at        timestamptz; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='views')              THEN ALTER TABLE public.ads ADD COLUMN views             integer NOT NULL DEFAULT 0; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ads' AND column_name='clicks')             THEN ALTER TABLE public.ads ADD COLUMN clicks            integer NOT NULL DEFAULT 0; END IF;
END $$;
