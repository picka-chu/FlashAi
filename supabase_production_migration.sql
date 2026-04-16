-- Flash AI Production Migration (Supabase/Postgres)
-- Date: 2026-04-16
-- Purpose: production-grade schema for Telegram mini app, payments, admin, analytics, and support.

begin;

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Utility functions / triggers
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('admin', 'super_admin')
      and u.status = 'active'
  );
$$;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('user', 'support', 'admin', 'super_admin');
  end if;

  if not exists (select 1 from pg_type where typname = 'user_status') then
    create type public.user_status as enum ('active', 'suspended', 'deleted');
  end if;

  if not exists (select 1 from pg_type where typname = 'plan_code') then
    create type public.plan_code as enum ('free', 'weekly', 'monthly', 'yearly');
  end if;

  if not exists (select 1 from pg_type where typname = 'subscription_status') then
    create type public.subscription_status as enum ('trial', 'active', 'past_due', 'canceled', 'expired');
  end if;

  if not exists (select 1 from pg_type where typname = 'payment_provider') then
    create type public.payment_provider as enum ('telegram_stars', 'stripe', 'crypto', 'manual');
  end if;

  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type public.payment_status as enum ('pending', 'succeeded', 'failed', 'refunded', 'canceled');
  end if;

  if not exists (select 1 from pg_type where typname = 'prediction_source') then
    create type public.prediction_source as enum ('ai', 'model', 'manual');
  end if;

  if not exists (select 1 from pg_type where typname = 'ticket_status') then
    create type public.ticket_status as enum ('open', 'in_progress', 'resolved', 'closed');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Core identity & user profile
-- -----------------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  telegram_id bigint unique,
  telegram_username text,
  name text,
  phone text,
  photo_url text,
  role public.user_role not null default 'user',
  status public.user_status not null default 'active',
  plan public.plan_code not null default 'free',
  credits integer not null default 0 check (credits >= 0),
  win_rate numeric(5,2) not null default 0 check (win_rate >= 0 and win_rate <= 100),
  predictions_count integer not null default 0 check (predictions_count >= 0),
  ranking integer,
  referral_code text unique,
  referred_by uuid references public.users(id) on delete set null,
  last_active_at timestamptz,
  marketing_opt_in boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_users_telegram_id on public.users (telegram_id);
create index if not exists idx_users_auth_user_id on public.users (auth_user_id);
create index if not exists idx_users_role_status on public.users (role, status);
create unique index if not exists idx_users_referral_code_unique
  on public.users (lower(referral_code))
  where referral_code is not null;

create trigger trg_users_updated_at
before update on public.users
for each row
execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Plans / subscriptions / payments
-- -----------------------------------------------------------------------------
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  code public.plan_code unique not null,
  display_name text not null,
  price_usd numeric(10,2) not null default 0,
  credits_per_day integer not null default 0,
  max_betslip_analyses integer not null default 0,
  max_image_uploads integer not null default 0,
  ai_chat_enabled boolean not null default false,
  deep_analysis_enabled boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger trg_plans_updated_at
before update on public.plans
for each row
execute function public.set_updated_at();

insert into public.plans (code, display_name, price_usd, credits_per_day, max_betslip_analyses, max_image_uploads, ai_chat_enabled, deep_analysis_enabled)
values
  ('free', 'Free', 0, 5, 1, 1, false, false),
  ('weekly', 'Weekly', 3.99, 35, 3, 2, true, false),
  ('monthly', 'Monthly', 11.99, 120, 10, 5, true, true),
  ('yearly', 'Yearly', 99.00, 150, 15, 8, true, true)
on conflict (code) do update set
  display_name = excluded.display_name,
  price_usd = excluded.price_usd,
  credits_per_day = excluded.credits_per_day,
  max_betslip_analyses = excluded.max_betslip_analyses,
  max_image_uploads = excluded.max_image_uploads,
  ai_chat_enabled = excluded.ai_chat_enabled,
  deep_analysis_enabled = excluded.deep_analysis_enabled,
  is_active = true,
  updated_at = timezone('utc', now());

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  status public.subscription_status not null default 'active',
  started_at timestamptz not null default timezone('utc', now()),
  current_period_start timestamptz,
  current_period_end timestamptz,
  canceled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_subscriptions_user on public.subscriptions (user_id, status);
create index if not exists idx_subscriptions_period_end on public.subscriptions (current_period_end);

create trigger trg_subscriptions_updated_at
before update on public.subscriptions
for each row
execute function public.set_updated_at();

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  provider public.payment_provider not null,
  provider_payment_id text,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'USD',
  status public.payment_status not null default 'pending',
  paid_at timestamptz,
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (provider, provider_payment_id)
);

create index if not exists idx_payments_user_status on public.payments (user_id, status);
create index if not exists idx_payments_created_at on public.payments (created_at desc);

create trigger trg_payments_updated_at
before update on public.payments
for each row
execute function public.set_updated_at();

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  delta integer not null,
  reason text not null,
  ref_type text,
  ref_id uuid,
  created_by uuid references public.users(id),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_credit_ledger_user_created on public.credit_ledger (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Prediction & match activity
-- -----------------------------------------------------------------------------
create table if not exists public.match_cache (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_match_id text not null,
  league text,
  home_team text,
  away_team text,
  starts_at timestamptz,
  payload jsonb not null,
  fetched_at timestamptz not null default timezone('utc', now()),
  unique (provider, provider_match_id)
);

create index if not exists idx_match_cache_starts_at on public.match_cache (starts_at);

create table if not exists public.predictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  match_cache_id uuid references public.match_cache(id) on delete set null,
  match_id text,
  home_team text not null,
  away_team text not null,
  league text,
  market text,
  confidence integer check (confidence >= 0 and confidence <= 100),
  odds numeric(8,3),
  source public.prediction_source not null default 'ai',
  analysis jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_predictions_user_created on public.predictions (user_id, created_at desc);
create index if not exists idx_predictions_match_id on public.predictions (match_id);

create table if not exists public.user_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_user_actions_user_created on public.user_actions (user_id, created_at desc);
create index if not exists idx_user_actions_action_created on public.user_actions (action, created_at desc);

-- -----------------------------------------------------------------------------
-- Support & admin operations
-- -----------------------------------------------------------------------------
create table if not exists public.faqs (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text not null,
  category text not null check (category in ('general', 'subscription', 'referral', 'technical', 'billing', 'policy')),
  is_published boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_faqs_published_category on public.faqs (is_published, category, sort_order);

create trigger trg_faqs_updated_at
before update on public.faqs
for each row
execute function public.set_updated_at();

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  subject text,
  status public.ticket_status not null default 'open',
  priority smallint not null default 2 check (priority between 1 and 5),
  assigned_to uuid references public.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz
);

create index if not exists idx_support_tickets_user on public.support_tickets (user_id, created_at desc);
create index if not exists idx_support_tickets_status on public.support_tickets (status, priority);

create trigger trg_support_tickets_updated_at
before update on public.support_tickets
for each row
execute function public.set_updated_at();

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  sender_id uuid references public.users(id),
  sender_role text not null check (sender_role in ('user', 'agent', 'system', 'ai')),
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_support_messages_ticket_created on public.support_messages (ticket_id, created_at);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users(id),
  action text not null,
  target_table text,
  target_id text,
  before jsonb,
  after jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_admin_audit_logs_actor_created on public.admin_audit_logs (actor_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Background jobs / cache
-- -----------------------------------------------------------------------------
create table if not exists public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  channel text not null check (channel in ('telegram', 'email', 'push')),
  template text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'processing', 'sent', 'failed', 'canceled')),
  scheduled_at timestamptz not null default timezone('utc', now()),
  sent_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_notification_jobs_status_schedule on public.notification_jobs (status, scheduled_at);

create trigger trg_notification_jobs_updated_at
before update on public.notification_jobs
for each row
execute function public.set_updated_at();

create table if not exists public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  refresh_token_hash text not null unique,
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_app_sessions_user_expires on public.app_sessions (user_id, expires_at);

create table if not exists public.api_cache (
  key text primary key,
  data jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_api_cache_expires_at on public.api_cache (expires_at);

create trigger trg_api_cache_updated_at
before update on public.api_cache
for each row
execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security (RLS)
-- -----------------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.match_cache enable row level security;
alter table public.predictions enable row level security;
alter table public.user_actions enable row level security;
alter table public.faqs enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.notification_jobs enable row level security;
alter table public.api_cache enable row level security;

-- users
create policy if not exists users_select_own
  on public.users for select
  using (id = auth.uid() or public.current_user_is_admin());

create policy if not exists users_update_own
  on public.users for update
  using (id = auth.uid() or public.current_user_is_admin())
  with check (id = auth.uid() or public.current_user_is_admin());

create policy if not exists users_insert_self
  on public.users for insert
  with check (id = auth.uid() or public.current_user_is_admin());

-- plans (public readable)
create policy if not exists plans_read_all
  on public.plans for select
  using (true);

create policy if not exists plans_admin_write
  on public.plans for all
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- subscriptions
create policy if not exists subscriptions_read_own
  on public.subscriptions for select
  using (user_id = auth.uid() or public.current_user_is_admin());

create policy if not exists subscriptions_admin_write
  on public.subscriptions for all
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- payments
create policy if not exists payments_read_own
  on public.payments for select
  using (user_id = auth.uid() or public.current_user_is_admin());

create policy if not exists payments_admin_write
  on public.payments for all
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- credit ledger
create policy if not exists credit_ledger_read_own
  on public.credit_ledger for select
  using (user_id = auth.uid() or public.current_user_is_admin());

create policy if not exists credit_ledger_admin_write
  on public.credit_ledger for all
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- match cache
create policy if not exists match_cache_read_all
  on public.match_cache for select
  using (true);

create policy if not exists match_cache_admin_write
  on public.match_cache for all
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- predictions
create policy if not exists predictions_read_own
  on public.predictions for select
  using (user_id = auth.uid() or public.current_user_is_admin());

create policy if not exists predictions_insert_own
  on public.predictions for insert
  with check (user_id = auth.uid() or public.current_user_is_admin());

create policy if not exists predictions_admin_manage
  on public.predictions for update
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- user actions
create policy if not exists user_actions_read_own
  on public.user_actions for select
  using (user_id = auth.uid() or public.current_user_is_admin());

create policy if not exists user_actions_insert_own
  on public.user_actions for insert
  with check (user_id = auth.uid() or public.current_user_is_admin());

-- faqs
create policy if not exists faqs_read_published
  on public.faqs for select
  using (is_published = true or public.current_user_is_admin());

create policy if not exists faqs_admin_write
  on public.faqs for all
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- support tickets
create policy if not exists support_tickets_read_own
  on public.support_tickets for select
  using (user_id = auth.uid() or assigned_to = auth.uid() or public.current_user_is_admin());

create policy if not exists support_tickets_insert_own
  on public.support_tickets for insert
  with check (user_id = auth.uid() or public.current_user_is_admin());

create policy if not exists support_tickets_update_own_or_admin
  on public.support_tickets for update
  using (user_id = auth.uid() or assigned_to = auth.uid() or public.current_user_is_admin())
  with check (user_id = auth.uid() or assigned_to = auth.uid() or public.current_user_is_admin());

-- support messages
create policy if not exists support_messages_read_ticket
  on public.support_messages for select
  using (
    exists (
      select 1
      from public.support_tickets t
      where t.id = support_messages.ticket_id
        and (t.user_id = auth.uid() or t.assigned_to = auth.uid() or public.current_user_is_admin())
    )
  );

create policy if not exists support_messages_insert_ticket
  on public.support_messages for insert
  with check (
    exists (
      select 1
      from public.support_tickets t
      where t.id = support_messages.ticket_id
        and (t.user_id = auth.uid() or t.assigned_to = auth.uid() or public.current_user_is_admin())
    )
  );

-- admin logs
create policy if not exists admin_audit_admin_only
  on public.admin_audit_logs for select
  using (public.current_user_is_admin());

create policy if not exists admin_audit_insert_admin
  on public.admin_audit_logs for insert
  with check (public.current_user_is_admin());

-- notification jobs
create policy if not exists notification_read_own
  on public.notification_jobs for select
  using (user_id = auth.uid() or public.current_user_is_admin());

create policy if not exists notification_admin_write
  on public.notification_jobs for all
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- app sessions
create policy if not exists app_sessions_read_own
  on public.app_sessions for select
  using (
    user_id in (
      select u.id
      from public.users u
      where u.id = auth.uid() or u.auth_user_id = auth.uid()
    )
    or public.current_user_is_admin()
  );

create policy if not exists app_sessions_admin_write
  on public.app_sessions for all
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- api cache (server/admin only)
create policy if not exists api_cache_admin_only
  on public.api_cache for all
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

commit;
