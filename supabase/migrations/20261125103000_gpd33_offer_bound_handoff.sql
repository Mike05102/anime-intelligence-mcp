begin;
set local lock_timeout='2s';

create function public.gpd33_request_buyer_handoff(buyer uuid,request_key uuid,offer uuid,units int,country text,expected_gtin text)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  if exists(
    select 1 from public.merchant_offers o join public.merchants m on m.id=o.merchant_id
    where o.id=offer and to_jsonb(m)->'metadata'->>'system_managed'='true'
  ) then
    return jsonb_build_object('ok',false,'error','merchant_handoff_unavailable','status',404);
  end if;
  if expected_gtin is not null and not exists(
    select 1 from public.merchant_offers o
    join public.products p on p.source_product_key='universal:gtin:'||expected_gtin
    where o.id=offer and expected_gtin ~ '^[0-9]{14}$'
      and o.gtin ~ '^([0-9]{8}|[0-9]{12,14})$' and lpad(o.gtin,14,'0')=expected_gtin
      and p.metadata->>'gpd33_verified'='true'
      and nullif(trim(p.manufacturer),'') is not null
      and regexp_replace(upper(trim(normalize(p.manufacturer,NFKC))),'[[:space:]]+',' ','g')
          =regexp_replace(upper(trim(normalize(to_jsonb(o)->>'manufacturer',NFKC))),'[[:space:]]+',' ','g')
  ) then
    return jsonb_build_object('ok',false,'error','offer_identity_changed','status',409);
  end if;
  return public.gpd33_create_buyer_handoff(buyer,request_key,offer,units,country);
end
$$;

revoke execute on function public.gpd33_request_buyer_handoff(uuid,uuid,uuid,int,text,text) from public,anon,authenticated;
grant execute on function public.gpd33_request_buyer_handoff(uuid,uuid,uuid,int,text,text) to service_role;
commit;
