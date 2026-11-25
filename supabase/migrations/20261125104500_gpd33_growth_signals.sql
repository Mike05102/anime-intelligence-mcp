begin;
set local lock_timeout='2s';

alter table public.gpd33_buyer_handoffs add column catalog_domain text
  check(catalog_domain is null or catalog_domain ~ '^[a-z_]{1,40}$');
grant update(catalog_domain) on public.gpd33_buyer_handoffs to service_role;

create or replace function public.gpd33_request_buyer_handoff(buyer uuid,request_key uuid,offer uuid,units int,country text,expected_gtin text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  result jsonb;
  domain text;
begin
  if exists(
    select 1 from public.merchant_offers o join public.merchants m on m.id=o.merchant_id
    where o.id=offer and to_jsonb(m)->'metadata'->>'system_managed'='true'
  ) then
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
  result:=public.gpd33_create_buyer_handoff(buyer,request_key,offer,units,country);
  if domain ~ '^[a-z_]{1,40}$' and result->>'ok'='true' and result->>'replayed' is distinct from 'true' then
    update public.gpd33_buyer_handoffs set catalog_domain=domain
      where buyer_id=buyer and request_id=request_key;
  end if;
  return result;
end
$$;

create function public.gpd33_catalog_planning_growth() returns jsonb
language sql stable security invoker set search_path='' as $$
  with recent as (
    select b.catalog_domain,count(distinct b.buyer_id) as buyers,
      count(distinct h.merchant_id) filter(where h.status in ('accepted','order_reported')) as responsive_sellers
    from public.gpd33_buyer_handoffs b join public.gpd33_handoffs h on h.id=b.handoff_id
    where b.created_at>=now()-interval '7 days' and b.catalog_domain is not null
    group by b.catalog_domain
    having count(distinct b.buyer_id)>=2
  )
  select public.gpd33_catalog_planning()||jsonb_build_object(
    'account_handoff_signals',coalesce((select jsonb_object_agg(catalog_domain,
      jsonb_build_object('buyers',buyers,'responsive_sellers',responsive_sellers)) from recent),'{}'::jsonb));
$$;

revoke execute on function public.gpd33_catalog_planning_growth() from public,anon,authenticated;
grant execute on function public.gpd33_catalog_planning_growth() to service_role;
commit;
