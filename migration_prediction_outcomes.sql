-- Prediction outcomes log for calibration & backtesting.
-- Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS public.prediction_outcomes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id          TEXT NOT NULL,
  match_name        TEXT,
  league            TEXT,
  kickoff_at        TIMESTAMPTZ,
  market            TEXT NOT NULL,
  model_prob        NUMERIC(8, 6) NOT NULL,
  market_odds       NUMERIC(10, 4),
  implied_prob      NUMERIC(8, 6),
  edge              NUMERIC(8, 6),
  data_quality      NUMERIC(5, 4),
  confidence        INTEGER,
  result            TEXT CHECK (result IS NULL OR result IN ('win', 'loss', 'void', 'push')),
  settled_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta              JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_prediction_outcomes_match
  ON public.prediction_outcomes (match_id);

CREATE INDEX IF NOT EXISTS idx_prediction_outcomes_league_created
  ON public.prediction_outcomes (league, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prediction_outcomes_unsettled
  ON public.prediction_outcomes (settled_at)
  WHERE settled_at IS NULL;

ALTER TABLE public.prediction_outcomes ENABLE ROW LEVEL SECURITY;

COMMIT;
