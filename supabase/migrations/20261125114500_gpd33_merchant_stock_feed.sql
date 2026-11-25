begin;
set local lock_timeout='2s';

create function public.gpd33_import_merchant_stock_feed(seller uuid, offers jsonb)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='2s' as $$
declare
  received integer;
  applied integer;
begin
  if not exists(select 1 from public.merchants m where m.id=seller and m.status='active' and m.verified
    and to_jsonb(m)->'metadata'->>'system_managed' is distinct from 'true') then
    return jsonb_build_object('ok',false,'error','verified_merchant_required','status',403);
  end if;
  if jsonb_typeof(offers) is distinct from 'array' then
    return jsonb_build_object('ok',false,'error','invalid_feed','status',400);
  end if;
  received:=jsonb_array_length(offers);
  if received not between 1 and 200 then
    return jsonb_build_object('ok',false,'error','invalid_feed','status',400);
  end if;

  insert into public.merchant_offers as saved
    (id,merchant_id,merchant_sku,manufacturer,part_number,normalized_part_number,title,mpn,gtin,
     condition,price,currency,stock_status,stock_quantity,ships_to,product_url,active,source_updated_at,observed_at,updated_at,metadata)
  select gen_random_uuid(),seller,o.merchant_sku,o.manufacturer,o.part_number,o.normalized_part_number,o.title,o.mpn,o.gtin,
    o.condition,o.price,o.currency,o.stock_status,o.stock_quantity,o.ships_to,o.product_url,true,o.source_updated_at,now(),now(),'{}'::jsonb
  from jsonb_populate_recordset(null::public.merchant_offers,offers) o
  on conflict(merchant_id,merchant_sku) do update set
    title=excluded.title,gtin=coalesce(saved.gtin,excluded.gtin),price=excluded.price,currency=excluded.currency,
    stock_status=excluded.stock_status,stock_quantity=excluded.stock_quantity,ships_to=excluded.ships_to,product_url=excluded.product_url,
    source_updated_at=excluded.source_updated_at,observed_at=now(),updated_at=now()
  where (saved.source_updated_at is null or saved.source_updated_at<excluded.source_updated_at)
    and saved.active and saved.normalized_part_number=excluded.normalized_part_number
    and upper(trim(saved.manufacturer))=upper(trim(excluded.manufacturer))
    and (saved.gtin is null or excluded.gtin is null or lpad(saved.gtin,14,'0')=lpad(excluded.gtin,14,'0'));
  get diagnostics applied=row_count;
  return jsonb_build_object('ok',true,'merchant_id',seller,'offers_received',received,
    'new_or_updated',applied,'ignored',received-applied);
end
$$;

revoke execute on function public.gpd33_import_merchant_stock_feed(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.gpd33_import_merchant_stock_feed(uuid,jsonb) to service_role;
commit;
