begin;
set local lock_timeout='2s';

create function public.gpd33_bulk_quantity_unreported(units int,reported_quantity numeric)
returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce(units between 2 and 100,false) and reported_quantity is null;
$$;

revoke execute on function public.gpd33_bulk_quantity_unreported(int,numeric) from public,anon,authenticated;
grant execute on function public.gpd33_bulk_quantity_unreported(int,numeric) to service_role;

create or replace function public.gpd33_request_buyer_handoff(buyer uuid,request_key uuid,offer uuid,units int,country text,expected_gtin text)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='2s' as $$
declare
  result jsonb;
  domain text;
  report_at timestamptz;
  reported_quantity numeric;
  reported_gtin text;
  system_managed boolean;
begin
  -- The same lock serializes request-key retries in gpd33_create_buyer_handoff.
  perform pg_advisory_xact_lock(17844933,1);
  select o.source_updated_at,o.gtin,o.stock_quantity,to_jsonb(m)->'metadata'->>'system_managed'='true'
    into report_at,reported_gtin,reported_quantity,system_managed
    from public.merchant_offers o join public.merchants m on m.id=o.merchant_id
    where o.id=offer for share of o;
  if system_managed then
    return jsonb_build_object('ok',false,'error','merchant_handoff_unavailable','status',404);
  end if;
  if expected_gtin is not null then
    select p.product_type into domain from public.merchant_offers o
    join public.products p on p.source_product_key='universal:gtin:'||expected_gtin
    where o.id=offer and expected_gtin ~ '^[0-9]{14}$'
      and o.gtin ~ '^([0-9]{8}|[0-9]{12,14})$' and lpad(o.gtin,14,'0')=expected_gtin
      and p.metadata->>'gpd33_verified'='true'
      and nullif(trim(p.manufacturer),'') is not null
      and regexp_replace(upper(trim(normalize(p.manufacturer,NFKC))),'[[:space:]]+',' ','g')
          =regexp_replace(upper(trim(normalize(to_jsonb(o)->>'manufacturer',NFKC))),'[[:space:]]+',' ','g')
    order by p.id limit 1;
    if domain is null then
      return jsonb_build_object('ok',false,'error','offer_identity_changed','status',409);
    end if;
  end if;
  if (expected_gtin is not null or reported_gtin is not null) and not exists(
    select 1 from public.gpd33_buyer_handoffs b where b.buyer_id=buyer and b.request_id=request_key
  ) then
    if not public.gpd33_offer_source_fresh(report_at) then
      return jsonb_build_object('ok',false,'error','offer_source_not_fresh','status',409);
    end if;
    if public.gpd33_bulk_quantity_unreported(units,reported_quantity) then
      return jsonb_build_object('ok',false,'error','offer_stock_quantity_unavailable','status',409);
    end if;
  end if;
  result:=public.gpd33_create_buyer_handoff(buyer,request_key,offer,units,country);
  if domain ~ '^[a-z_]{1,40}$' and result->>'ok'='true' and result->>'replayed' is distinct from 'true' then
    update public.gpd33_buyer_handoffs set catalog_domain=domain
      where buyer_id=buyer and request_id=request_key;
  end if;
  return result;
end
$$;

commit;
