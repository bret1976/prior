create table if not exists latch_keys (
  id text primary key,
  label text not null,
  token text not null unique,
  role text not null,
  created_at timestamptz not null default now()
);

create table if not exists venues (
  id text primary key,
  name text not null,
  kind text not null,
  neighborhood text not null,
  cuisine text not null,
  price_usd integer not null,
  outdoor boolean not null,
  dress text not null,
  deposit_usd integer not null,
  cancel_hours integer not null,
  noise text not null,
  note text not null,
  created_at timestamptz not null default now()
);

create table if not exists slots (
  id text primary key,
  venue_id text not null references venues(id),
  label text not null,
  party_max integer not null,
  left_count integer not null
);

create table if not exists jobs (
  id text primary key,
  status text not null,
  principal text not null,
  agent text not null,
  cap_usd integer not null,
  request jsonb not null,
  shortlist jsonb not null,
  hold jsonb,
  receipt jsonb,
  created_at timestamptz not null default now()
);

create table if not exists job_events (
  id text primary key,
  job_id text not null references jobs(id),
  at timestamptz not null default now(),
  type text not null,
  detail text not null
);

create table if not exists idempotency (
  key text primary key,
  status integer not null,
  body jsonb not null
);
