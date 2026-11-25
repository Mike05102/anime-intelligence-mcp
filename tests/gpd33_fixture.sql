create role anon;
create role authenticated;
create role service_role bypassrls;
create table public.products(
  id bigint generated always as identity primary key,
  canonical_name_ja text not null,
  canonical_name_en text,
  manufacturer text,
  jan_code text,
  model_number text,
  image_status text,
  source_product_key text,
  product_type text,
  product_status text,
  identification_confidence numeric,
  source_last_checked_at timestamptz,
  created_at timestamptz default now(),
  metadata jsonb not null default '{}'
);
create table public.api_events(occurred_at timestamptz default now(), event_type text, metadata jsonb);
grant select,insert,update on public.products to service_role;
grant usage,select on all sequences in schema public to service_role;
grant select,delete on public.api_events to service_role;
