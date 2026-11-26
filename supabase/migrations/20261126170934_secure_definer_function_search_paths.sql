-- Keep privileged RPCs on a fixed, empty search_path. All table references
-- in these functions are schema-qualified; built-ins resolve from pg_catalog.
ALTER FUNCTION public.add_credits_to_user(bigint, integer) SET search_path = '';
ALTER FUNCTION public.apply_plan_purchase(bigint, text, integer, integer) SET search_path = '';
ALTER FUNCTION public.claim_task_reward(bigint, uuid, integer) SET search_path = '';
ALTER FUNCTION public.increment_ad_metric(uuid, boolean) SET search_path = '';
