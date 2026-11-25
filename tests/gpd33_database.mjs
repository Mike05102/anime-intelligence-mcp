import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const pgPath=process.env.GPD33_PG_MODULE;
const {default:pg}=await import(pgPath?pathToFileURL(pgPath).href:'pg');
const connection={host:process.env.PGHOST,port:process.env.PGPORT,user:process.env.PGUSER,
  password:process.env.PGPASSWORD,database:process.env.PGDATABASE};
const db=new pg.Client(connection);
const concurrent=new pg.Client(connection);
await Promise.all([db.connect(),concurrent.connect()]);
const readSql=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');
await db.query(await readSql('tests/gpd33_fixture.sql'));
await db.query(`insert into api_events(event_type,occurred_at,metadata)
  values ('universal_expansion_run',now()-interval '40 days','{"version":"33.0.0"}')`);
const preflight=JSON.parse((await db.query(await readSql('supabase/gpd33_production_preflight.sql'))).rows[0].gpd33_preflight);
assert.equal(preflight.tables.products.columns.metadata.type,'jsonb');
assert.equal(preflight.tables.products.columns.id.type,'uuid');
assert.equal(preflight.tables.products.indexes.products_pkey.valid,true);
assert.deepEqual(preflight.gpd33_relation_names,[]);
await db.query(await readSql('supabase/migrations/20261125053000_gpd33_catalog.sql'));
const indexCheck=await db.query("select to_regclass('public.gpd33_source_product_key')::text as extra, to_regclass('public.fixture_product_key_idx')::text as existing");
assert.deepEqual(indexCheck.rows[0],{extra:null,existing:'fixture_product_key_idx'});
const sql=async(q,args=[])=>(await db.query(q,args)).rows;
const one=async(q,args=[])=>(await sql(q,args))[0].result;
const tokenA='00000000-0000-0000-0000-000000000001';
const tokenB='00000000-0000-0000-0000-000000000002';
const action=(name,token,slot,payload={})=>one('select public.gpd33_discovery($1,$2,$3,$4) result',
  [name,token,slot,JSON.stringify(payload)]);
function product(gtin,title='Pasta'){
  return {source_product_key:'universal:gtin:'+gtin.padStart(14,'0'), canonical_name_ja:title,
    manufacturer:'Example', product_type:'food_grocery', product_status:'active', image_status:'pending',
    identification_confidence:0.9, jan_code:gtin.length===13?gtin:null, source_last_checked_at:new Date().toISOString(),
    metadata:{universal_commerce:true,domain:'food_grocery',gpd33_verified:true,
      evidence_level:'usda_fdc_branded_package',provider:'usda_fdc',identifiers:{gtin}}};
}
const rows=[product('012345678905'),product('12345670')];
await sql("insert into products(canonical_name_ja,jan_code,source_product_key,product_type) values('Specialist','0012345678905','anime:1','figure')");
await db.query('set role service_role');
await concurrent.query('set role service_role');
const claims=await Promise.all([action('claim',tokenA,100),
  concurrent.query("select public.gpd33_discovery('claim',$1,100) result",[tokenB]).then(r=>r.rows[0].result)]);
assert.equal(claims.filter(x=>x.claimed).length,1);
const owner=claims[0].claimed?tokenA:tokenB, other=claims[0].claimed?tokenB:tokenA;
await action('plan',owner,100,{plan:{domain:'food_grocery',query:'pasta'}});
await action('stage',owner,100,{rows,metrics:{provider:'usda_fdc',calls:1,provider_errors:0,candidates:2,identified:2},catalog_advance:true});
await assert.rejects(action('commit',other,100),/lease expired/);
await db.query('reset role');
await db.query("alter table public.products add check (source_product_key not like '%12345670')");
await db.query('set role service_role');
await assert.rejects(action('commit',owner,100),/check constraint/);
assert.equal(await one('select count(*)::int result from products'),1);
await db.query('reset role');
await db.query("alter table public.products drop constraint products_source_product_key_check");
await db.query("update public.gpd33_job set expires_at=now()-interval '1 second'");
await db.query('set role service_role');
const resumed=await action('claim',other,101);
assert.equal(resumed.slot,100);
assert.deepEqual(resumed.staged.rows,rows);
const outcome=await action('commit',other,101);
assert.deepEqual(outcome,{new:1,updated:0,duplicate:1,rejected:0});
assert.equal((await action('claim',owner,101)).claimed,false);
assert.equal((await action('claim',owner,102)).source_page,1);
assert.equal(await one("select count(*)::int result from products where source_product_key='anime:1' and metadata='{}'"),1);
const second=await one('select public.gpd33_catalog_batch($1) result',[JSON.stringify(rows)]);
assert.equal(second.new,0);
assert.equal(second.duplicate,2);
assert.equal(second.updated,1);
const collision=product('12345670','Completely different variant');
const rejected=await one('select public.gpd33_catalog_batch($1) result',[JSON.stringify([collision])]);
assert.equal(rejected.updated,0);
const coverage=await one("select public.gpd33_coverage(array['food_grocery','books_media']) result");
assert.equal(coverage.food_grocery.canonical,1);
assert.equal(coverage.food_grocery.new_24h,1);
assert.equal(coverage.food_grocery.new_7d,1);
assert.equal(coverage.books_media.canonical,0);
const metrics=await one('select public.gpd33_run_metrics() result');
assert.equal(metrics.jobs_completed_24h,1);
assert.equal(metrics.providers_7d.usda_fdc.new,1);
await db.query('reset role; set role anon');
await assert.rejects(sql('select public.gpd33_run_metrics()'),/permission denied/);
await db.query('reset role; set role service_role');
const racePayload=JSON.stringify([product('4901234567894')]);
const concurrentWrites=await Promise.all([one('select public.gpd33_catalog_batch($1) result',[racePayload]),
  concurrent.query('select public.gpd33_catalog_batch($1) result',[racePayload]).then(r=>r.rows[0].result)]);
assert.equal(concurrentWrites.reduce((sum,x)=>sum+x.new,0),1);
assert.equal(await one("select count(*)::int result from products where source_product_key='universal:gtin:04901234567894'"),1);
await db.query("reset role; revoke delete on api_events from service_role; update gpd33_job set expires_at=now()-interval '1 second'; set role service_role");
assert.equal((await action('claim',owner,120)).claimed,true);
await action('plan',owner,120,{plan:{domain:'food_grocery'}});
await action('stage',owner,120,{rows:[],metrics:{}});
await action('commit',owner,120);
assert.equal(await one('select count(*)::int result from api_events'),1);
await db.query('reset role');
await db.query(await readSql('supabase/migrations/20261125060000_gpd33_event_retention.sql'));
await db.query(`insert into api_events(event_type,endpoint,occurred_at,metadata)
  select 'universal_discovery_batch','autonomous_discovery',now()-interval '30 days',
    jsonb_build_object('fixture', (select string_agg(md5(n::text || '-' || i::text),'') from generate_series(1,90) i))
  from generate_series(1,6000) n`);
await db.query(`insert into api_events(event_type,endpoint,occurred_at,metadata,amount_usdc,product_id)
  values
  ('paid_call',null,now()-interval '40 days','{}',0.1,null),
  ('universal_product_snapshot',null,now()-interval '40 days','{}',null,null),
  ('universal_discovery_batch','purchase_decision_live',now()-interval '40 days','{}',null,null),
  ('universal_discovery_batch','autonomous_discovery',now()-interval '40 days','{"payment":true}',null,null),
  ('universal_discovery_batch','autonomous_discovery',now()-interval '40 days','{}',null,'important'),
  ('universal_discovery_batch','autonomous_discovery',now(),'{}',null,null)`);
const audit=async()=>JSON.parse((await db.query(await readSql('supabase/maintenance/gpd33_storage_audit.sql'))).rows[0].gpd33_storage_audit);
const before=await audit();
assert.equal(before.events.reduce((sum,event)=>sum+event.eligible_rows,0),6001);
await db.query('set role anon');
await assert.rejects(sql('select public.gpd33_prune_events()'),/permission denied/);
await db.query('reset role; set role service_role');
assert.equal(await one('select public.gpd33_prune_events() result'),1500);
await db.query('reset role');
assert.equal(await one('select gpd33_maintenance.prune_events(5000) result'),4501);
assert.equal(await one('select gpd33_maintenance.prune_events(5000) result'),0);
assert.equal(await one('select count(*)::integer result from api_events'),6);
for(const predicate of ["event_type='universal_product_snapshot'","endpoint='purchase_decision_live'",
  "metadata ? 'payment'","product_id='important'","occurred_at>=now()-interval '1 day'"]){
  assert.equal(await one('select count(*)::integer result from api_events where '+predicate),1);
}
assert.equal(await one("select amount_usdc::text result from api_events where event_type='paid_call'"),'0.100000');
await db.query(await readSql('supabase/maintenance/gpd33_reclaim_events.sql'));
const after=await audit();
assert.equal(after.events.reduce((sum,event)=>sum+event.eligible_rows,0),0);
assert.ok(after.events_total_bytes<before.events_total_bytes/2);
console.log(`PASS retention protection and physical compaction (${before.events_total_bytes} -> ${after.events_total_bytes} bytes)`);
await db.query(await readSql('supabase/migrations/20261125063000_gpd33_compact_telemetry.sql'));
const ingress={method:'GET',payment_header_present:false,query_present:false,id_present:false,response_status:402};
for(const [eventType,metadata] of [['payment_required',ingress],['payment_required',{...ingress,request_id:'paid'}],
  ['paid_call',{request_id:'paid'}],['payment_required',{...ingress,method:'POST'}],
  ['payment_required',{...ingress,query_present:true}],['payment_required',{...ingress,payment_header_present:true}]]) {
  await db.query("insert into api_events(event_type,occurred_at,metadata,amount_atomic,payment_network) values ($1,now()-interval '20 days',$2,100,'solana')",[eventType,metadata]);
}
await db.query("insert into api_events(event_type,occurred_at) select 'dynamic_catalog_pool',now()-n*interval '20 days' from generate_series(1,3) n");
const ingressAudit=await db.query(await readSql('supabase/maintenance/gpd33_ingress_audit.sql'));
assert.equal(Number(ingressAudit.rows[0].candidate_rows),1);
await db.query('set role service_role');
assert.equal(await one('select public.gpd33_prune_events() result'),2);
assert.equal(await one('select public.gpd33_prune_events() result'),0);
assert.equal((await one('select public.gpd33_ingress_rollup() result'))[0].events,1);
assert.equal(await one("select count(*)::int result from api_events where event_type='payment_required'"),4);
assert.equal(await one("select count(*)::int result from api_events where event_type='dynamic_catalog_pool'"),2);
await db.query('reset role');
await db.query(await readSql('supabase/migrations/20261125070000_gpd33_storage_control.sql'));
await db.query('set role service_role');
await db.query(`insert into api_events(event_type,metadata) values
  ('api_call','{"payment_header_present":false,"query_present":true}'),
  ('payment_required','{"payment_header_present":false,"response_status":402}'),
  ('paid_call','{"payment_header_present":true}')`);
assert.equal(await one("select count(*)::int result from api_events where event_type='api_call'"),0);
assert.equal(await one("select count(*)::int result from api_events where event_type='paid_call'"),3);
assert.equal(await one("select (public.gpd33_storage_status()->>'target_bytes')::int result"),400000000);
await db.query('reset role');
await db.query(`insert into api_events(event_type,occurred_at,metadata) values
  ('gpd_cron_heartbeat',now()-interval '2 days','{}'),
  ('scheduled_growth_run',now()-interval '2 days','{"ok":false}'),
  ('x402_configuration_error',now()-interval '6 days','{}'),
  ('x402_configuration_error',now()-interval '8 days','{}')`);
await db.query('set role service_role');
assert.equal(await one('select public.gpd33_prune_events() result'),2);
assert.equal(await one("select count(*)::int result from api_events where event_type='x402_configuration_error'"),1);
assert.equal(await one("select count(*)::int result from api_events where event_type='scheduled_growth_run'"),1);
await db.query('reset role; update gpd33_maintenance.storage_sample set database_bytes=451000000; set role service_role');
await db.query(`insert into api_events(event_type,metadata) values
  ('gpd_cron_heartbeat','{}'), ('scheduled_growth_run','{"ok":false}'),
  ('paid_call','{"payment_header_present":true}')`);
assert.equal(await one("select count(*)::int result from api_events where event_type='gpd_cron_heartbeat'"),0);
assert.equal(await one("select count(*)::int result from api_events where event_type='scheduled_growth_run'"),2);
assert.equal(await one("select count(*)::int result from api_events where event_type='paid_call'"),4);
await db.query('reset role');
await db.query(await readSql('supabase/migrations/20261125073000_gpd33_egress.sql'));
await sql('select public.gpd33_storage_status()');
await db.query(`insert into api_events(event_type,metadata) values
  ('universal_discovery_attempt','{"phase":"completed"}'),
  ('universal_expansion_run','{"refreshed":[{"domain":"food_grocery","canonical_new":3}]}'),
  ('universal_discovery_batch','{"private_marker":"must not leave the DB"}')`);
await db.query('set role service_role');
const health=await one('select public.gpd33_health_events() result');
assert.equal(health.events.universal_discovery_attempt.recent_phases.completed,1);
assert.equal(health.growth_24h.by_domain.food_grocery,3);
assert.ok(!JSON.stringify(health).includes('private_marker'));
await db.query('reset role');
await db.query(`insert into api_events(event_type,metadata) values
  ('universal_product_demand','{"domain":"food_grocery"}'),
  ('universal_product_snapshot','{"domain":"food_grocery","identity_key":"example","offers":[{"provider":"fixture","price":123}]}')`);
await db.query('set role service_role');
const coverageEvents=await one('select public.gpd33_coverage_events() result');
assert.equal(coverageEvents.domain_metrics.food_grocery.demands_7d,1);
assert.equal(coverageEvents.offers_observed_24h,1);
assert.deepEqual(coverageEvents.market_providers_observed,['fixture']);
assert.ok(!JSON.stringify(coverageEvents).includes('price'));
await db.query('reset role; set role anon');
await assert.rejects(sql('select public.gpd33_health_events()'),/permission denied/);
await db.query('reset role');
await db.query(await readSql('supabase/migrations/20261125080000_gpd33_business_outcomes.sql'));
await db.query(`insert into api_events(event_type,payment_network,transaction_hash,amount_usdc,metadata) values
  ('paid_call','fixture-network','shared-receipt',0.10,'{"test_mode":"test_fixture"}'),
  ('paid_call','fixture-network','shared-receipt',0.10,'{"test_mode":"test_fixture"}'),
  ('paid_call','fixture-network','conflict',0.20,'{}'),
  ('paid_call','fixture-network','conflict',0.30,'{}'),
  ('purchase_confirmed',null,null,null,'{}'),
  ('universal_purchase_decision_served',null,null,null,'{}')`);
await db.query('set role service_role');
const business=await one('select public.gpd33_business_outcomes() result');
assert.equal(business.settlement_telemetry.distinct_consistent_receipts,1);
assert.equal(business.settlement_telemetry.duplicate_receipt_records,2);
assert.equal(business.settlement_telemetry.inconsistent_receipts,1);
assert.equal(business.settlement_telemetry.recorded_receipt_usdc,0.1);
assert.equal(business.recorded_events.purchase_confirmation_events,1);
assert.equal(business.recorded_events.purchase_decisions,1);
assert.equal(business.verified_outcomes.confirmed_goods_transactions,null);
assert.equal(business.verified_outcomes.reconciled_external_revenue_usdc,null);
assert.ok(!JSON.stringify(business).includes('shared-receipt'));
await db.query('reset role; set role anon');
await assert.rejects(sql('select public.gpd33_business_outcomes()'),/permission denied/);
{
  await db.query('reset role');
  await db.query(await readSql('supabase/migrations/20261125083000_gpd33_merchant_handoffs.sql'));
  const ids=Array.from({length:10},(_,i)=>'10000000-0000-4000-8000-'+String(i+1).padStart(12,'0'));
  const [seller,other,offer,ineligible,handoff,second,accept,order,cancel,decline]=ids;
  await db.query("insert into merchants values ($1,'active',true),($2,'active',false)",[seller,other]);
  await db.query('insert into merchant_offers values ($1,$3,true),($2,$4,true)',[offer,ineligible,seller,other]);
  await db.query('set role service_role');
  const create=async(id,offerId,units=1)=>one('select public.gpd33_create_handoff($1,$2,$3) result',[id,offerId,units]);
  const update=async(merchant,id,event,state,ref=null)=>one('select public.gpd33_record_handoff_event($1,$2,$3,$4,$5) result',[merchant,id,event,state,ref]);
  assert.equal((await create(handoff,ineligible)).error,'offer_not_eligible');
  assert.equal((await create(handoff,offer)).handoff_state,'requested');
  assert.equal((await create(handoff,offer)).ok,true);
  assert.equal((await create(handoff,offer,2)).error,'handoff_id_conflict');
  assert.deepEqual((await one('select public.gpd33_merchant_handoffs($1,$2) result',[other,handoff])).handoffs,[]);
  assert.equal((await update(other,handoff,accept,'accepted')).status,404);
  assert.equal((await update(seller,handoff,order,'order_reported','a'.repeat(64))).status,409);
  assert.equal((await update(seller,handoff,accept,'accepted')).handoff_state,'accepted');
  assert.equal((await update(seller,handoff,accept,'declined')).error,'event_id_conflict');
  assert.equal((await update(seller,handoff,order,'order_reported','a'.repeat(64))).ok,true);
  assert.equal((await update(seller,handoff,cancel,'cancelled','b'.repeat(64))).status,409);
  assert.equal((await update(seller,handoff,cancel,'cancelled','a'.repeat(64))).ok,true);
  assert.equal((await update(seller,handoff,order,'order_reported','a'.repeat(64))).replayed,true);
  assert.equal((await create(second,offer)).ok,true);
  assert.equal((await update(seller,second,accept,'accepted')).ok,true);
  assert.equal((await update(seller,second,order,'order_reported','a'.repeat(64))).error,'order_reference_conflict');
  assert.equal((await update(seller,second,decline,'declined')).status,409);
  const handoffOutcomes=await one('select public.gpd33_handoff_outcomes() result');
  assert.deepEqual(handoffOutcomes,{scope:'merchant_authenticated_reports',window_days:30,
    handoffs_created:2,merchant_acceptances:2,orders_reported_by_merchants:1,cancellations_reported_by_merchants:1});
  await db.query('reset role; set role anon');
  await assert.rejects(sql('select public.gpd33_handoff_outcomes()'),/permission denied/);
}
await Promise.all([db.end(),concurrent.end()]);
console.log('PASS PostgreSQL migration, RLS, batch rollback, lease recovery, aliases and diagnostics');
