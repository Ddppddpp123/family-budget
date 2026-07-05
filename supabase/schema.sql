create table if not exists public.ledger_user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.ledger_user_data enable row level security;

drop policy if exists "ledger user can read own data" on public.ledger_user_data;
drop policy if exists "ledger user can insert own data" on public.ledger_user_data;
drop policy if exists "ledger user can update own data" on public.ledger_user_data;

create policy "ledger user can read own data"
on public.ledger_user_data
for select
using (auth.uid() = user_id);

create policy "ledger user can insert own data"
on public.ledger_user_data
for insert
with check (auth.uid() = user_id);

create policy "ledger user can update own data"
on public.ledger_user_data
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
