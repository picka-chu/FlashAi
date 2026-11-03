-- Keep the Render web service awake from Supabase (always-on infrastructure).
--
-- Render's free tier suspends a web service after 15 minutes without inbound
-- traffic, which makes the first request afterwards take 30-60s. Supabase is
-- always on, so pg_cron + pg_net can ping /api/health once a minute with no
-- third-party account.
--
-- Run this once in the Supabase Dashboard -> SQL Editor (pg_cron and pg_net are
-- available on the free plan). Safe to re-run: the existing job is replaced.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  PERFORM cron.unschedule('keep-render-awake');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT cron.schedule(
  'keep-render-awake',
  '* * * * *',
  $job$
  SELECT net.http_get(
    url := 'https://flash-6tuz.onrender.com/api/health',
    timeout_milliseconds := 60000
  );
  $job$
);

COMMIT;

-- Verify after a minute:
--   SELECT jobid, jobname, schedule, active FROM cron.job;
--   SELECT status_code, created FROM net._http_response ORDER BY created DESC LIMIT 5;
--   SELECT status, return_message, start_time FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;
--
-- Stop the keepalive:
--   SELECT cron.unschedule('keep-render-awake');
