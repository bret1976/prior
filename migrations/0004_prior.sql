create table if not exists policies (
  id text primary key,
  name text not null,
  max_single_usd integer not null,
  max_daily_usd integer not null,
  approval_above_usd integer not null,
  blocked_categories jsonb not null,
  allowed_vendors jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists decisions (
  id text primary key,
  policy_id text not null,
  agent text not null,
  vendor text not null,
  category text not null,
  amount_usd integer not null,
  verdict text not null,
  reasons jsonb not null,
  created_at timestamptz not null default now()
);
