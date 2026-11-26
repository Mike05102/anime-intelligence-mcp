import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

export async function testCatalogPlanning(one) {
  const planning = await one('select public.gpd33_catalog_planning() result');
  assert.deepEqual(planning.efficiency, {food_grocery:{new:1,runs:1}});
  assert.equal(planning.queries.food_grocery['food_grocery:pasta'].new, 1);
  assert.equal(planning.queries.food_grocery['food_grocery:pasta'].calls, 1);
  assert.ok(Date.parse(planning.queries.food_grocery['food_grocery:pasta'].last_at));

  const source = await readFile(new URL('../releases/GPD33_0_COMPLETE_WORKER.js',import.meta.url),'utf8');
  const worker = await import('data:text/javascript;base64,' + Buffer.from(source +
    '\nexport {gpd33Plan, gpd33PlanPhase, gpd33SelectDomain, gpd33SelectQuery, UNIVERSAL_GENERIC_DOMAINS};').toString('base64'));
  const {gpd33Plan, gpd33PlanPhase, gpd33SelectDomain, gpd33SelectQuery, UNIVERSAL_GENERIC_DOMAINS: domains} = worker;
  const growth = Object.fromEntries(domains.map(d=>[d,{remaining:10000}]));
  assert.equal(domains.length, 24);
  assert.equal(gpd33SelectDomain(24,growth,planning.efficiency),'food_grocery');
  for (let index=0; index<domains.length; index++) {
    const slots = Array.from({length:4},(_,cycle)=>index+cycle*domains.length*2);
    assert.ok(slots.every(slot=>gpd33SelectDomain(slot,growth,planning.efficiency)===domains[index]));
    assert.deepEqual(slots.map(slot=>gpd33PlanPhase(slot).phase).sort(),[0,1,2,3]);
  }
  const demandDomain=domains[1];
  assert.equal(gpd33SelectDomain(0,growth,{}, {[demandDomain]:{buyers:50,responsive_sellers:20}}),domains[0]);
  assert.equal(gpd33SelectDomain(24,growth,{}, {[demandDomain]:{buyers:2,responsive_sellers:1}}),demandDomain);
  assert.equal(gpd33SelectDomain(24,growth,{}, {[demandDomain]:{buyers:1,responsive_sellers:1}}),domains[0]);
  const orderQualitySignals={[demandDomain]:{confirmed_orders:2,reconciled_invoices:0}};
  assert.equal(gpd33SelectDomain(0,growth,{}, {},orderQualitySignals),domains[0]);
  assert.equal(gpd33SelectDomain(24,growth,{}, {},orderQualitySignals),demandDomain);
  assert.equal(gpd33SelectDomain(24,growth,{}, {},{[demandDomain]:{confirmed_orders:50,reconciled_invoices:0}}),demandDomain);
  assert.equal(gpd33SelectDomain(24,growth,{}, {},{[demandDomain]:{confirmed_orders:0,reconciled_invoices:10}}),domains[0]);
  const now = Date.parse('2026-11-25T05:00:00Z');
  const query = ['pasta','coffee'];
  const freshHistory = {'food_grocery:pasta':{new:9,calls:1,last_at:'2026-11-25T04:59:00Z'}};
  assert.equal(gpd33SelectQuery('food_grocery',query,{},now,freshHistory),'coffee');
  const oldHistory = {'food_grocery:pasta':{new:9,calls:1,last_at:'2026-11-23T04:59:00Z'}};
  assert.equal(gpd33SelectQuery('food_grocery',query.toReversed(),{},now,oldHistory),'pasta');

  const originalFetch = globalThis.fetch;
  const calls = [];
  let rpcAvailable = true;
  globalThis.fetch = async input=>{
    const url = new URL(input);
    calls.push(url);
    if(url.pathname.endsWith('/rpc/gpd33_catalog_planning_reconciled')){
      return Response.json({efficiency:{},reconciled_transaction_signals:orderQualitySignals});
    }
    if(url.pathname.endsWith('/rpc/gpd33_catalog_planning')) {
      return rpcAvailable ? Response.json(planning) : Response.json({message:'unavailable'},{status:503});
    }
    if(url.pathname.endsWith('/api_events') && url.searchParams.get('event_type')==='eq.paid_call') {
      return Response.json([{metadata:{query_family:'food_grocery:coffee'}}]);
    }
    if(url.pathname.endsWith('/products') && url.searchParams.get('product_type')==='eq.food_grocery') {
      return Response.json([{metadata:{identifiers:{gtin:'012345678905'}}}]);
    }
    throw new Error('Unexpected catalog planning request: '+url.pathname);
  };
  try {
    const env = {SUPABASE_URL:'https://db.example',SUPABASE_SECRET_KEY:'fixture'};
    const coordinator = {slot:11,coverage:growth,source_page:4};
    const {plan} = await gpd33Plan(env,coordinator);
    assert.deepEqual(plan,{domain:'food_grocery',query:'GTIN 012345678905',catalog:false,page:4});
    assert.equal(calls.length,3);
    assert.ok(!calls.some(url=>url.searchParams.get('event_type')==='eq.universal_discovery_batch'));
    calls.length=0;
    const withCommerce=await gpd33Plan({...env,GPD_RECONCILED_GROWTH_SIGNALS:'1'},
      {...coordinator,slot:24});
    assert.equal(withCommerce.plan.domain,demandDomain);
    assert.equal(calls.filter(url=>url.pathname.includes('/rpc/')).length,1);
    rpcAvailable=false;
    const fallback = await gpd33Plan(env,coordinator);
    assert.deepEqual(fallback.plan,plan);
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log('PASS compact catalog planning, all-domain refresh rotation, cooldown and RPC fallback');
}
