-- Lock down the public Data API to the application's intended access model.
-- The browser can read only public catalogue content; all personal, payment,
-- operational and audit tables are accessed by the backend service_role.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
GRANT SELECT ON TABLE public.ads, public.faqs, public.tasks TO anon, authenticated;

REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- All public-schema RPCs are backend-only in this application.
-- Existing service_role grants are deliberately preserved.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- Apply the same least-privilege defaults to future objects created by
-- postgres migrations. Existing service_role defaults remain untouched.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- The timestamp trigger uses only built-ins; prevent caller-controlled
-- search-path resolution.
ALTER FUNCTION public.handle_updated_at() SET search_path = pg_catalog;
