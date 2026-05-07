-- Stores user connected wallets (TON and future chains)
create table if not exists public.user_wallets (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  wallet_address text not null,
  chain text,
  wallet_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_wallets_telegram_wallet_uq
  on public.user_wallets (telegram_id, wallet_address);

create index if not exists user_wallets_telegram_id_idx
  on public.user_wallets (telegram_id);

create index if not exists user_wallets_active_idx
  on public.user_wallets (telegram_id, is_active);

-- Helpful FK if users.telegram_id is unique in your schema
-- alter table public.user_wallets
--   add constraint user_wallets_telegram_fk
--   foreign key (telegram_id) references public.users (telegram_id) on delete cascade;

alter table public.user_wallets enable row level security;

-- Service role/backend writes; clients should not write directly.
create policy if not exists "wallets_select_own"
  on public.user_wallets
  for select
  using (true);
