-- Legacy -> Canonical Backfill
-- Run only after `supabase_production_migration.sql` has been applied.
-- Expected legacy sources:
--   legacy.profiles
--   legacy.predictions
--   legacy.api_cache

begin;

-- 1) Backfill users from legacy profiles table when available
-- Creates deterministic UUIDs from Telegram IDs to avoid duplicates across reruns.
insert into public.users (
  id,
  telegram_id,
  telegram_username,
  name,
  credits,
  referral_code,
  created_at,
  updated_at
)
select
  coalesce(u.id, gen_random_uuid()),
  p.id as telegram_id,
  p.username as telegram_username,
  trim(concat_ws(' ', p.first_name, p.last_name)) as name,
  coalesce(p.credits, 0) as credits,
  p.referral_code,
  p.created_at,
  timezone('utc', now())
from legacy.profiles p
left join public.users u on u.telegram_id = p.id
where p.id is not null
on conflict (telegram_id)
do update set
  telegram_username = excluded.telegram_username,
  name = coalesce(nullif(excluded.name, ''), public.users.name),
  credits = greatest(public.users.credits, excluded.credits),
  referral_code = coalesce(excluded.referral_code, public.users.referral_code),
  updated_at = timezone('utc', now());

-- 2) Restore referral linkage from legacy referred_by (profiles -> users)
update public.users child
set referred_by = parent.id,
    updated_at = timezone('utc', now())
from legacy.profiles legacy_child
join public.users parent on parent.telegram_id = legacy_child.referred_by
where child.telegram_id = legacy_child.id
  and legacy_child.referred_by is not null;

-- 3) Backfill legacy predictions into canonical predictions table
insert into public.predictions (
  id,
  user_id,
  match_id,
  home_team,
  away_team,
  league,
  market,
  confidence,
  odds,
  source,
  analysis,
  created_at
)
select
  lp.id,
  u.id as user_id,
  lp.match_id::text,
  lp.home_team,
  lp.away_team,
  lp.league,
  lp.prediction as market,
  lp.confidence,
  nullif(lp.odds, '')::numeric,
  'ai'::public.prediction_source,
  jsonb_build_object('legacy_analysis', lp.analysis),
  lp.created_at
from legacy.predictions lp
join public.users u on u.telegram_id = lp.user_id
where lp.user_id is not null
on conflict (id)
do nothing;

-- 4) Backfill old api_cache(endpoint, updated_at) -> canonical api_cache(key, expires_at)
insert into public.api_cache (
  key,
  data,
  expires_at,
  created_at,
  updated_at
)
select
  old.endpoint as key,
  old.data,
  coalesce(old.updated_at, timezone('utc', now())) + interval '10 minutes' as expires_at,
  coalesce(old.updated_at, timezone('utc', now())) as created_at,
  coalesce(old.updated_at, timezone('utc', now())) as updated_at
from (
  select endpoint, data, updated_at
  from legacy.api_cache
  where endpoint is not null
) old
on conflict (key)
do update set
  data = excluded.data,
  expires_at = greatest(public.api_cache.expires_at, excluded.expires_at),
  updated_at = timezone('utc', now());

commit;
