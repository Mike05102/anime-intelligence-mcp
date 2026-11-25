begin;
set local lock_timeout='2s';

create function public.gpd33_export_handoff_evidence(observed_at bigint,bindings jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare
  current_seconds bigint:=floor(extract(epoch from now()))::bigint;
  uid constant text:='^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$';
  invalid_bindings constant jsonb:='{"ok":false,"error":"invalid_handoff_evidence_bindings","status":400}';
  domains constant text[]:=array[
    'consumer_electronics','automotive_parts','home_appliances','fashion','books_media','toys_hobbies',
    'beauty_personal_care','sports_outdoors','home_living','office_business','medical_supplies','food_grocery',
    'baby_kids','pet_supplies','tools_hardware','garden_outdoor','musical_instruments','jewelry_watches',
    'arts_crafts','industrial_supplies','scientific_lab','restaurant_hospitality','safety_security','general_commerce'
  ];
  binding jsonb;
  evidence jsonb;
begin
  if observed_at is null or jsonb_typeof(bindings) is distinct from 'array' or pg_column_size(bindings)>32768 then
    return invalid_bindings;
  end if;
  if observed_at<current_seconds-86400 or observed_at>current_seconds+300 then
    return jsonb_build_object('ok',false,'error','handoff_evidence_snapshot_not_current','status',409);
  end if;
  if jsonb_array_length(bindings)>100 then return invalid_bindings; end if;
  for binding in select value from jsonb_array_elements(bindings) loop
    if jsonb_typeof(binding) is distinct from 'object' then return invalid_bindings; end if;
    if binding-array['handoff_id','merchant_id','order_reference_hash']<>'{}'::jsonb
      or jsonb_typeof(binding->'handoff_id') is distinct from 'string' or binding->>'handoff_id'!~uid
      or jsonb_typeof(binding->'merchant_id') is distinct from 'string' or binding->>'merchant_id'!~uid
      or jsonb_typeof(binding->'order_reference_hash') is distinct from 'string'
      or binding->>'order_reference_hash'!~'^[0-9a-f]{64}$' then
      return invalid_bindings;
    end if;
  end loop;
  if jsonb_array_length(bindings)<>(select count(distinct value->>'handoff_id') from jsonb_array_elements(bindings)) then
    return invalid_bindings;
  end if;

  -- Probe only explicit IDs. The saved category was bound to a verified canonical GTIN at handoff time.
  select coalesce(jsonb_agg(jsonb_build_object(
    'handoff_id',h.id,'merchant_id',h.merchant_id,'order_reference_hash',h.order_ref_hash,
    'state',h.status,'product_domain',b.catalog_domain,'catalog_identity','verified_canonical'
  ) order by h.id),'[]'::jsonb) into evidence
  from jsonb_to_recordset(bindings) as requested(handoff_id uuid,merchant_id uuid,order_reference_hash text)
  join public.gpd33_handoffs h on h.id=requested.handoff_id and h.merchant_id=requested.merchant_id
    and h.order_ref_hash=requested.order_reference_hash
  join public.gpd33_buyer_handoffs b on b.handoff_id=h.id
  where h.status in ('order_reported','cancelled') and b.catalog_domain=any(domains)
    and h.updated_at>=to_timestamp(observed_at-604800) and h.updated_at<to_timestamp(observed_at+1);

  return jsonb_build_object('ok',true,'rows',evidence);
end
$$;

revoke execute on function public.gpd33_export_handoff_evidence(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.gpd33_export_handoff_evidence(bigint,jsonb) to service_role;
commit;
