begin;
set local lock_timeout='2s';

create index gpd33_buyer_handoff_recent
  on public.gpd33_buyer_handoffs(buyer_id,created_at desc,request_id);

create function public.gpd33_list_buyer_handoffs(
  buyer uuid, lookup uuid, page_size integer
) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('ok',true,'handoffs',
    coalesce(jsonb_agg(to_jsonb(q) order by created_at desc,request_id),'[]'::jsonb))
  from (
    select b.request_id,h.id as handoff_id,h.offer_id,h.quantity,h.status as handoff_state,
      b.destination,b.expected_condition,b.created_at,h.updated_at
    from public.gpd33_buyer_handoffs b join public.gpd33_handoffs h on h.id=b.handoff_id
    where b.buyer_id=buyer and (lookup is null or b.request_id=lookup)
    order by b.created_at desc,b.request_id
    limit least(30,greatest(1,coalesce(page_size,10)))
  ) q
$$;

revoke execute on function public.gpd33_list_buyer_handoffs(uuid,uuid,int) from public,anon,authenticated;
grant execute on function public.gpd33_list_buyer_handoffs(uuid,uuid,int) to service_role;
commit;
