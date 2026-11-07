-- Explicit opt-in for tasks that cannot be verified automatically.
-- Without this flag, non-Telegram tasks are rejected at claim time so users
-- cannot earn credits from an unverifiable "I did it" confirmation.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS allow_self_report BOOLEAN NOT NULL DEFAULT FALSE;