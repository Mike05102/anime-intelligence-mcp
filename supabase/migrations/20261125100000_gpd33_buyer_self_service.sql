begin;
set local lock_timeout='2s';

create table public.gpd33_buyer_handoffs(
  buyer_id uuid not null,
  request_id uuid not null,
  handoff_id uuid not null unique references public.gpd33_handoffs(id),
  destination text not null check(destination ~ '^[A-Z]{2}$'),
  created_at timestamptz not null default now(),
  primary key(buyer_id,request_id)
);
create index gpd33_buyer_handoffs_created_at on public.gpd33_buyer_handoffs(created_at);
alter table public.gpd33_buyer_handoffs enable row level security;
revoke all on public.gpd33_buyer_handoffs from public,anon,authenticated;
grant select,insert on public.gpd33_buyer_handoffs to service_role;

create function public.gpd33_create_buyer_handoff(buyer uuid,request_key uuid,offer uuid,units int,country text)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='2s' as $$
declare
  existing record;
  outcome jsonb;
  new_handoff uuid;
  day_start timestamptz:=date_trunc('day',now(),'UTC');
begin
  if buyer is null or request_key is null or offer is null or units is null or units not between 1 and 100
    or country is null or country !~ '^[A-Z]{2}$' then
    return jsonb_build_object('ok',false,'error','invalid_buyer_handoff','status',400);
  end if;

  -- Serialize the small pilot quota and make retry checks atomic with insertion.
  perform pg_advisory_xact_lock(17844933,1);
  select b.destination,h.id,h.offer_id,h.quantity,h.status into existing
    from public.gpd33_buyer_handoffs b join public.gpd33_handoffs h on h.id=b.handoff_id
    where b.buyer_id=buyer and b.request_id=request_key;
  if found then
    if existing.offer_id<>offer or existing.quantity<>units or existing.destination<>country then
      return jsonb_build_object('ok',false,'error','request_id_conflict','status',409);
    end if;
    return jsonb_build_object('ok',true,'handoff_id',existing.id,'handoff_state',existing.status,'replayed',true);
  end if;

  if (select count(*) from public.gpd33_buyer_handoffs where created_at>=day_start)>=30 or
    (select count(*) from public.gpd33_buyer_handoffs where buyer_id=buyer and created_at>=day_start)>=3 then
    return jsonb_build_object('ok',false,'error','buyer_handoff_daily_limit','status',429);
  end if;

  perform 1 from public.merchant_offers o
    cross join lateral (select to_jsonb(o) as fields) f
    where o.id=offer and o.active and f.fields->>'stock_status' in ('in_stock','low_stock')
      and jsonb_typeof(f.fields->'ships_to')='array'
      and (f.fields->'ships_to' ?| array[country,'WORLDWIDE','ALL'])
      and (f.fields->>'stock_quantity' is null
        or (f.fields->>'stock_quantity')::numeric>=units);
  if not found then
    return jsonb_build_object('ok',false,'error','offer_destination_or_stock_unavailable','status',404);
  end if;
  new_handoff:=gen_random_uuid();
  outcome:=public.gpd33_create_handoff(new_handoff,offer,units);
  if outcome->>'ok'='true' then
    insert into public.gpd33_buyer_handoffs(buyer_id,request_id,handoff_id,destination)
      values (buyer,request_key,new_handoff,country);
  end if;
  return outcome;
end
$$;

create or replace function public.gpd33_merchant_handoffs(seller uuid,lookup uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('ok',true,'handoffs',coalesce(jsonb_agg(to_jsonb(q) order by created_at desc,handoff_id),'[]'::jsonb))
  from (
    select h.id as handoff_id,h.offer_id,h.quantity,h.status as handoff_state,h.created_at,h.updated_at,b.destination
    from public.gpd33_handoffs h left join public.gpd33_buyer_handoffs b on b.handoff_id=h.id
    where h.merchant_id=seller and (lookup is null or h.id=lookup)
    order by h.created_at desc,h.id limit 30
  ) q
$$;

revoke execute on function public.gpd33_create_buyer_handoff(uuid,uuid,uuid,int,text) from public,anon,authenticated;
grant execute on function public.gpd33_create_buyer_handoff(uuid,uuid,uuid,int,text) to service_role;
commit;
