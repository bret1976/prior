alter table venues add column if not exists source text not null default 'manual';
alter table venues add column if not exists external_id text;
create unique index if not exists venues_source_external_idx on venues (source, external_id);
