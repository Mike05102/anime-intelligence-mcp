begin;
set local lock_timeout='2s';

create table public.gpd33_handoffs(
  id uuid primary key,
  merchant_id uuid not null references public.merchants(id),
  offer_id uuid not null references public.merchant_offers(id),
  quantity int not null check(quantity between 1 and 1000),
  status text not null default 'requested'
    check(status in ('requested','accepted','declined','order_reported','cancelled')),
  order_ref_hash text check(order_ref_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index gpd33_handoff_merchant_recent on public.gpd33_handoffs(merchant_id,created_at desc);
create unique index gpd33_handoff_order_reference on public.gpd33_handoffs(merchant_id,order_ref_hash)
  where order_ref_hash is not null;

create table public.gpd33_handoff_events(
  handoff_id uuid not null references public.gpd33_handoffs(id),
  event_id uuid not null,
  status text not null check(status in ('accepted','declined','order_reported','cancelled')),
  order_ref_hash text check(order_ref_hash ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz not null default now(),
  primary key(handoff_id,event_id)
);
alter table public.gpd33_handoffs enable row level security;
alter table public.gpd33_handoff_events enable row level security;
revoke all on public.gpd33_handoffs,public.gpd33_handoff_events from public,anon,authenticated;
grant select,insert,update on public.gpd33_handoffs to service_role;
grant select,insert on public.gpd33_handoff_events to service_role;

create function public.gpd33_create_handoff(handoff uuid,offer uuid,units int) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  existing public.gpd33_handoffs%rowtype;
  seller uuid;
begin
  if handoff is null or offer is null or units is null or units not between 1 and 1000 then
    return jsonb_build_object('ok',false,'error','invalid_handoff','status',400);
  end if;
  select * into existing from public.gpd33_handoffs where id=handoff;
  if not found then
    select o.merchant_id into seller from public.merchant_offers o join public.merchants m on m.id=o.merchant_id
    where o.id=offer and o.active and m.status='active' and m.verified;
    if not found then return jsonb_build_object('ok',false,'error','offer_not_eligible','status',404); end if;
    insert into public.gpd33_handoffs(id,merchant_id,offer_id,quantity) values(handoff,seller,offer,units)
      on conflict(id) do nothing;
    select * into strict existing from public.gpd33_handoffs where id=handoff;
  end if;
  if existing.offer_id<>offer or existing.quantity<>units then
    return jsonb_build_object('ok',false,'error','handoff_id_conflict','status',409);
  end if;
  return jsonb_build_object('ok',true,'handoff_id',existing.id,'handoff_state',existing.status);
end
$$;

create function public.gpd33_merchant_handoffs(seller uuid,lookup uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('ok',true,'handoffs',coalesce(jsonb_agg(to_jsonb(q) order by created_at desc),'[]'::jsonb))
  from (
    select id as handoff_id,offer_id,quantity,status as handoff_state,created_at,updated_at
    from public.gpd33_handoffs
    where merchant_id=seller and (lookup is null or id=lookup)
    order by created_at desc,id limit 30
  ) q
$$;

create function public.gpd33_record_handoff_event(seller uuid,handoff uuid,event uuid,new_state text,reference_hash text)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='2s' as $$
declare
  current_handoff public.gpd33_handoffs%rowtype;
  previous public.gpd33_handoff_events%rowtype;
begin
  if event is null or new_state is null or new_state not in ('accepted','declined','order_reported','cancelled')
    or (new_state='order_reported' and reference_hash is null)
    or (reference_hash is not null and (reference_hash !~ '^[0-9a-f]{64}$' or new_state not in ('order_reported','cancelled'))) then
    return jsonb_build_object('ok',false,'error','invalid_handoff_event','status',400);
  end if;
  select * into current_handoff from public.gpd33_handoffs where id=handoff and merchant_id=seller for update;
  if not found then return jsonb_build_object('ok',false,'error','handoff_not_found','status',404); end if;

  select * into previous from public.gpd33_handoff_events where handoff_id=handoff and event_id=event;
  if found then
    if previous.status<>new_state or previous.order_ref_hash is distinct from reference_hash then
      return jsonb_build_object('ok',false,'error','event_id_conflict','status',409);
    end if;
    return jsonb_build_object('ok',true,'handoff_id',handoff,'handoff_state',previous.status,'replayed',true);
  end if;

  if not ((current_handoff.status='requested' and new_state in ('accepted','declined'))
    or (current_handoff.status='accepted' and new_state in ('order_reported','cancelled'))
    or (current_handoff.status='order_reported' and new_state='cancelled'))
    or (new_state='cancelled' and reference_hash is distinct from current_handoff.order_ref_hash) then
    return jsonb_build_object('ok',false,'error','invalid_handoff_transition','status',409);
  end if;
  begin
    update public.gpd33_handoffs set status=new_state,order_ref_hash=coalesce(reference_hash,order_ref_hash),updated_at=now()
      where id=handoff;
    insert into public.gpd33_handoff_events(handoff_id,event_id,status,order_ref_hash)
      values(handoff,event,new_state,reference_hash);
  exception when unique_violation then
    return jsonb_build_object('ok',false,'error','order_reference_conflict','status',409);
  end;
  return jsonb_build_object('ok',true,'handoff_id',handoff,'handoff_state',new_state,'replayed',false);
end
$$;

create function public.gpd33_handoff_outcomes() returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'scope','merchant_authenticated_reports',
    'window_days',30,
    'handoffs_created',(select count(*) from public.gpd33_handoffs where created_at>=now()-interval '30 days'),
    'merchant_acceptances',count(distinct handoff_id) filter(where status='accepted'),
    'orders_reported_by_merchants',count(distinct handoff_id) filter(where status='order_reported'),
    'cancellations_reported_by_merchants',count(distinct handoff_id) filter(where status='cancelled')
  ) from public.gpd33_handoff_events where occurred_at>=now()-interval '30 days'
$$;

revoke execute on function public.gpd33_create_handoff(uuid,uuid,int),public.gpd33_merchant_handoffs(uuid,uuid),
  public.gpd33_record_handoff_event(uuid,uuid,uuid,text,text),public.gpd33_handoff_outcomes() from public,anon,authenticated;
grant execute on function public.gpd33_create_handoff(uuid,uuid,int),public.gpd33_merchant_handoffs(uuid,uuid),
  public.gpd33_record_handoff_event(uuid,uuid,uuid,text,text),public.gpd33_handoff_outcomes() to service_role;
commit;
