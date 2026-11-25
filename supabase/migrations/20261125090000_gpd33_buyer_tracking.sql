begin;
set local lock_timeout='2s';

create function public.gpd33_buyer_handoff_status(handoff uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(
    (select jsonb_build_object('ok',true,'handoff_id',id,'handoff_state',status,
      'updated_at',updated_at,'evidence','merchant_reported')
     from public.gpd33_handoffs where id=handoff),
    jsonb_build_object('ok',false,'error','handoff_not_found')
  )
$$;

revoke execute on function public.gpd33_buyer_handoff_status(uuid) from public,anon,authenticated;
grant execute on function public.gpd33_buyer_handoff_status(uuid) to service_role;
commit;
