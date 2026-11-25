import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../releases/GPD33_0_COMPLETE_WORKER.js',import.meta.url),'utf8');
const api=await import('data:text/javascript;base64,'+Buffer.from(source+
  '\nexport {gpd33SelectDomain,gpd33UsdaRows,gpd33MarketRows,checkpointedUniversalDemandRefresh,normalizeUniversalIdentifiers,normalizeEbayGeneric,normalizeYahooGeneric,evaluateGenericOffer,genericCommerceSearch};').toString('base64'));
const worker=api.default;
const origin='https://gpd.example';
const fixtureKey=generateKeyPairSync('ed25519').privateKey.export({format:'jwk'});
const env={CDP_API_KEY_ID:'fixture',CDP_API_KEY_SECRET:Buffer.concat([Buffer.from(fixtureKey.d,'base64url'),Buffer.from(fixtureKey.x,'base64url')]).toString('base64'),SUPABASE_URL:'https://db.example',SUPABASE_SECRET_KEY:'test-key',
  X402_WALLET_ADDRESS:'9YLxx6HtrN4HFd2wBTcBX5Uwn2rtMUYxcUwohzG9aBGT',X402_FACILITATOR_URL:'https://pay.example'};
const pending=[];
const ctx={waitUntil(task){pending.push(task);}};
const call=(path,init)=>worker.fetch(new Request(origin+path,init),env,ctx);
const post=(path,body)=>call(path,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify(body)});
const selftest=await call('/selftest');
const results=await selftest.json();
assert.equal(selftest.status,200,JSON.stringify(results.checks.filter(c=>!c.ok)));
assert.equal(results.embedded_parts_collector.ok,true);
assert.equal(results.checks.length,116);
assert.equal(results.embedded_parts_collector.checks,61);

assert.equal(api.normalizeUniversalIdentifiers({isbn:'0-306-40615-2'}).gtin,'9780306406157');
assert.equal(api.normalizeUniversalIdentifiers({gtin:'012345678905',ean:'0012345678905'}).gtin,'012345678905');
assert.deepEqual(api.normalizeUniversalIdentifiers({gtin:'012345678905',ean:'4901234567894'}),{});
assert.equal(api.normalizeYahooGeneric({janCode:'barcode: 4901234567894'}).gtin,null);
const ebay=api.normalizeEbayGeneric({title:'4901234567894',buyingOptions:['FIXED_PRICE'],
  price:{value:'5',currency:'USD'},shippingOptions:[{shippingCost:{value:'2',currency:'EUR'}}]});
assert.equal(ebay.stock_status,null);
assert.equal(ebay.gtin,null);
assert.equal(ebay.shipping_cost,null);
const assessed=api.evaluateGenericOffer('fashion',{...ebay,size:'XL'},{
  product:{identifiers:{}},requirements:{size:'L',condition:'new'},destination:{country:'JP'}
});
assert.equal(assessed.purchase_evaluation.known_total,null);
assert.ok(assessed.purchase_evaluation.hard_blockers.includes('size_variant_unverified'));
assert.ok(assessed.purchase_evaluation.hard_blockers.includes('condition_unknown'));

const branded={dataType:'Branded',fdcId:1,gtinUpc:'012345678905',brandName:'Example',
  description:'Pasta',packageWeight:'500 g',foodCategory:'Pasta'};
assert.equal(api.gpd33UsdaRows([branded],'2026-11-25').length,1);
assert.equal(api.gpd33UsdaRows([branded,{...branded,fdcId:2,packageWeight:'1 kg'}],'2026-11-25').length,0);
const offer={provider:'ebay',id:'listing',gtin:'012345678905',brand:'Example',title:'Example Pasta 500 g'};
assert.equal(api.gpd33MarketRows('food_grocery',[offer],'2026-11-25').length,0);
assert.equal(api.gpd33MarketRows('food_grocery',[offer,{...offer,provider:'yahoo_japan',id:'peer',gtin:'0012345678905'}],'2026-11-25').length,1);
assert.equal(api.gpd33MarketRows('parts',[offer,{...offer,provider:'yahoo_japan'}],'2026-11-25').length,0);
assert.equal(new Set(Array.from({length:24},(_,i)=>api.gpd33SelectDomain(i,{}))).size,24);
assert.equal(api.gpd33SelectDomain(24,{food_grocery:{remaining:10000},general_commerce:{remaining:100}}),'food_grocery');

const requests=[];
assert.equal(api.gpd33MarketRows('food_grocery',[{...offer,_catalogDetail:{
  gtin:offer.gtin,product:{title:offer.title,brand:offer.brand,gtins:['0012345678905']}
}}],'2026-11-25').length,1);
let mode='http';
let staged;
let simulateFailure=false;
globalThis.fetch=async (target,options={})=>{
  const url=new URL(typeof target==='string'?target:target.url||target.href);
  requests.push(url);
  if(url.pathname.endsWith('/supported')){
    return Response.json({kinds:[{x402Version:2,scheme:'exact',
      network:'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',extra:{feePayer:env.X402_WALLET_ADDRESS}}]});
  }
  if(url.pathname==='/rest/v1/rpc/gpd33_discovery'){
    const body=JSON.parse(options.body);
    switch(body.action){
      case 'claim': return Response.json({claimed:true,slot:11,plan:{domain:'food_grocery',query:'pasta',catalog:true,page:0},staged:mode==='resume'?staged:null});
      case 'stage': staged=body.payload;return Response.json({staged:true});
      case 'commit':
        if(simulateFailure)return Response.json({message:'DB unavailable'},{status:503});
        return Response.json({new:staged.rows.length,updated:0,duplicate:0,rejected:0});
      case 'failed': return Response.json({released:true});
      case 'reserve_catalog': return Response.json({allowed:true});
      case 'catalog_limited': return Response.json({recorded:true});
      default: throw new Error('unexpected RPC action');
    }
  }
  if(url.hostname==='api.nal.usda.gov'){
    if(mode==='fallback')return Response.json({error:'rate_limit'},{status:429});
    return Response.json({foods:[branded]});
  }
  if(url.hostname.endsWith('yahooapis.jp')){
    return Response.json({hits:[{code:'y1',name:'Example Pasta 500 g',brand:{name:'Example'},janCode:'0012345678905',price:5}]});
  }
  if(url.hostname==='api.ebay.com'&&url.pathname.includes('oauth2')){
    return Response.json({access_token:'fixture',expires_in:3600});
  }
  if(url.hostname==='api.ebay.com'&&url.searchParams.get('fieldgroups')==='PRODUCT'){
    return Response.json({itemId:'e1',title:offer.title,brand:offer.brand,product:{title:offer.title,brand:offer.brand,gtins:[offer.gtin]}});
  }
  if(url.hostname==='api.ebay.com'){
    return Response.json({itemSummaries:[{itemId:'e1',title:'Example Pasta 500 g'}]});
  }
  if(url.pathname==='/rest/v1/parts_catalog')return Response.json([{id:'fixture-part',manufacturer:'OMRON',part_number:'E2E-X5ME1',normalized_part_number:'E2EX5ME1',name:'Proximity sensor'}]);
  if(url.hostname==='db.example')return Response.json([]);
  throw new Error('unexpected request '+url);
};
const init=await (await post('/mcp',{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}})).json();
assert.equal(init.result.protocolVersion,'2025-11-25');
const tools=await (await post('/mcp',{jsonrpc:'2.0',id:2,method:'tools/list',params:{}})).json();
assert.ok(tools.result.tools.length>5);
assert.ok(tools.result.tools.some(t=>/purchase_decision/.test(t.name)));
for(const route of ['/v1/purchase-decision','/v1/buy-wait','/v1/full-intelligence','/v1/parts-intelligence?part_number=E2E-X5ME1&manufacturer=OMRON']){
  const response=await call(route);
  assert.equal(response.status,402,route+' '+await response.clone().text());
  const header=response.headers.get('payment-required');
  const challenge=header?JSON.parse(Buffer.from(header,'base64')):await response.json();
  assert.equal(challenge.x402Version,2);
  assert.match(challenge.accepts[0].network,/^solana:/);
}
for(const route of ['/v1/parts/status','/v1/merchant/search','/.well-known/x402','/openapi.json']){
  const response=await call(route);
  assert.ok(response.status<500,route+' '+response.status);
}
await Promise.allSettled(pending);

mode='catalog';
simulateFailure=true;
await assert.rejects(api.checkpointedUniversalDemandRefresh(env,1,'test',11*600000),/DB unavailable/);
assert.equal(staged.rows.length,1);
mode='resume';
simulateFailure=false;
requests.length=0;
const resumed=await api.checkpointedUniversalDemandRefresh(env,1,'test',12*600000);
assert.equal(resumed.resumed,true);
assert.equal(resumed.new,1);
assert.equal(requests.some(x=>x.hostname==='api.nal.usda.gov'),false);
mode='fallback';
requests.length=0;
const fallback=await api.checkpointedUniversalDemandRefresh({...env,YAHOO_CLIENT_ID:'y',EBAY_CLIENT_ID:'e',EBAY_CLIENT_SECRET:'s'},1,'test',13*600000);
assert.equal(staged.catalog_limited,true);
assert.equal(staged.metrics.catalog_errors,1);
assert.ok(staged.metrics.yahoo_calls>=1);
assert.equal(staged.metrics.ebay_calls,2);
assert.ok(requests.some(url=>url.searchParams.get('fieldgroups')==='PRODUCT'));
assert.ok(requests.length<=24,'Discovery used '+requests.length+' subrequests');
assert.equal(fallback.new,1);
console.log('PASS Worker routes, MCP, x402, identification, variants, source fallback, DB recovery and subrequest budget');
