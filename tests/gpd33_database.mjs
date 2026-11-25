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
for(const file of ['tests/gpd33_fixture.sql','supabase/migrations/20261125053000_gpd33_catalog.sql']){
  await db.query(await readFile(new URL('../'+file,import.meta.url),'utf8'));
}
const sql=async(q,args=[])=>(await db.query(q,args)).rows;
const one=async(q,args=[])=>(await sql(q,args))[0].result;
const tokenA='00000000-0000-0000-0000-000000000001';
const tokenB='00000000-0000-0000-0000-000000000002';
const action=(name,token,slot,payload={})=>one('select public.gpd33_discovery($1,$2,$3,$4) result',
  [name,token,slot,JSON.stringify(payload)]);
function product(gtin,title='Pasta'){
  return {source_product_key:'universal:gtin:'+gtin.padStart(14,'0'), canonical_name_ja:title,
    manufacturer:'Example', product_type:'food_grocery', source_last_checked_at:new Date().toISOString(),
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
await Promise.all([db.end(),concurrent.end()]);
console.log('PASS PostgreSQL migration, RLS, batch rollback, lease recovery, aliases and diagnostics');
