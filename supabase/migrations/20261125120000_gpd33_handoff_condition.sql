begin;
set local lock_timeout='2s';

alter table public.gpd33_buyer_handoffs
  add column expected_condition text check(length(expected_condition) between 1 and 40);
grant update(expected_condition) on public.gpd33_buyer_handoffs to service_role;

create function public.gpd33_request_condition_bound_handoff(
  buyer uuid,request_key uuid,offer uuid,units int,country text,expected_gtin text,expected_condition text
) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='2s' as $$
declare
  requested text:=btrim(regexp_replace(upper(normalize(expected_condition,NFKC)),'[[:space:]]+',' ','g'));
  saved text;
  observed text;
  result jsonb;
begin
  if requested is not null and length(requested) not between 1 and 40 then
    return jsonb_build_object('ok',false,'error','invalid_offer_condition','status',400);
  end if;

  -- Acquire the request lock before the offer row lock, as the existing buyer RPC does.
  perform pg_advisory_xact_lock(17844933,1);
  select b.expected_condition into saved from public.gpd33_buyer_handoffs b
    where b.buyer_id=buyer and b.request_id=request_key;
  if found then
    if saved is distinct from requested then
      return jsonb_build_object('ok',false,'error','request_id_conflict','status',409);
    end if;
  elsif requested is not null then
    select btrim(regexp_replace(upper(normalize(o.condition,NFKC)),'[[:space:]]+',' ','g')) into observed
      from public.merchant_offers o where o.id=offer for share of o;
    if found and observed is distinct from requested then
      return jsonb_build_object('ok',false,'error','offer_condition_changed','status',409);
    end if;
  end if;

  result:=public.gpd33_request_buyer_handoff(buyer,request_key,offer,units,country,expected_gtin);
  if requested is not null and result->>'ok'='true' and result->>'replayed' is distinct from 'true' then
    update public.gpd33_buyer_handoffs b set expected_condition=requested
      where b.buyer_id=buyer and b.request_id=request_key;
  end if;
  return result;
end
$$;

create or replace function public.gpd33_merchant_handoffs(seller uuid,lookup uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('ok',true,'handoffs',coalesce(jsonb_agg(to_jsonb(q) order by created_at desc,handoff_id),'[]'::jsonb))
  from (
    select h.id as handoff_id,h.offer_id,h.quantity,h.status as handoff_state,h.created_at,h.updated_at,
      b.destination,b.expected_condition
    from public.gpd33_handoffs h left join public.gpd33_buyer_handoffs b on b.handoff_id=h.id
    where h.merchant_id=seller and (lookup is null or h.id=lookup)
    order by h.created_at desc,h.id limit 30
  ) q
$$;

revoke execute on function public.gpd33_request_condition_bound_handoff(uuid,uuid,uuid,int,text,text,text)
  from public,anon,authenticated;
grant execute on function public.gpd33_request_condition_bound_handoff(uuid,uuid,uuid,int,text,text,text) to service_role;

commit;
