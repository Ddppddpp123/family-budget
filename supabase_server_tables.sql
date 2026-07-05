create table if not exists ledger_app_state (
  email text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists ledger_app_backups (
  id bigserial primary key,
  email text not null,
  reason text not null default 'manual',
  data jsonb not null,
  created_at timestamptz not null default now()
);

alter table ledger_app_state enable row level security;
alter table ledger_app_backups enable row level security;
-- No browser access is required. Netlify Function uses the service role key server-side.
