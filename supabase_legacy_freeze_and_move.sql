-- Freeze legacy tables into `legacy` schema to avoid contract drift.
-- Run BEFORE backfill script when migrating existing environments.

begin;

create schema if not exists legacy;

-- Move old tables only if they exist in public and not yet moved.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'profiles'
  ) and not exists (
    select 1 from information_schema.tables
    where table_schema = 'legacy' and table_name = 'profiles'
  ) then
    execute 'alter table public.profiles set schema legacy';
  end if;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'predictions'
  ) and not exists (
    select 1 from information_schema.tables
    where table_schema = 'legacy' and table_name = 'predictions'
  ) then
    execute 'alter table public.predictions set schema legacy';
  end if;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'api_cache'
  ) and not exists (
    select 1 from information_schema.tables
    where table_schema = 'legacy' and table_name = 'api_cache'
  ) then
    execute 'alter table public.api_cache set schema legacy';
  end if;
end $$;

-- Lock writes to legacy tables for application roles (service role can still access as needed).
revoke insert, update, delete on all tables in schema legacy from anon, authenticated;

commit;
