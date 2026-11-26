import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {reconcileSignedGpd33X402Evidence} from '../scripts/gpd33_x402_reconcile.mjs';
import {readFile} from 'node:fs/promises';
import {testMerchantGtin} from './gpd33_merchant_gtin.mjs';

const source=await readFile(new URL('../releases/GPD33_0_COMPLETE_WORKER.js',import.meta.url),'utf8');
const api=await import('data:text/javascript;base64,'+Buffer.from(source+
  '\nexport {UNIVERSAL_GENERIC_DOMAINS,gpd33SelectDomain,gpd33UsdaRows,gpd33MarketRows,checkpointedUniversalDemandRefresh,normalizeUniversalIdentifiers,normalizeEbayGeneric,normalizeYahooGeneric,universalCandidateCommerceEvidence,evaluateGenericOffer,genericCommerceSearch,buildUniversalPurchaseDecision,x402Gate};').toString('base64'));
const worker=api.default;
await testMerchantGtin(worker,api.UNIVERSAL_GENERIC_DOMAINS);
const origin='https://gpd.example';
const fixtureKey=generateKeyPairSync('ed25519').privateKey.export({format:'jwk'});
const env={REFRESH_KEY:'fixture-admin',CDP_API_KEY_ID:'fixture',CDP_API_KEY_SECRET:Buffer.concat([Buffer.from(fixtureKey.d,'base64url'),Buffer.from(fixtureKey.x,'base64url')]).toString('base64'),SUPABASE_URL:'https://db.example',SUPABASE_SECRET_KEY:'test-key',
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

const shippingEstimate=api.normalizeEbayGeneric({estimatedAvailabilities:[
  {deliveryOptions:['IN_STORE_PICKUP'],estimatedAvailabilityStatus:'IN_STOCK',estimatedAvailableQuantity:99},
  {deliveryOptions:['SHIP_TO_HOME'],estimatedAvailabilityStatus:'LIMITED_STOCK',estimatedAvailableQuantity:3,estimatedRemainingQuantity:2}
]});
assert.equal(shippingEstimate.stock_status,'limited_stock');
assert.equal(shippingEstimate.stock_quantity_estimate,2);
assert.equal(shippingEstimate.stock_quantity,undefined);
assert.equal(api.normalizeEbayGeneric({itemEndDate:'2000-01-01T00:00:00Z',
  estimatedAvailabilities:[{estimatedAvailabilityStatus:'IN_STOCK'}]}).stock_status,'out_of_stock');
const pickupOnly=api.normalizeEbayGeneric({estimatedAvailabilities:[{deliveryOptions:['IN_STORE_PICKUP'],
  estimatedAvailabilityStatus:'IN_STOCK',estimatedAvailableQuantity:5}]});
assert.equal(pickupOnly.stock_status,null);
assert.equal(pickupOnly.stock_quantity_estimate,null);
for(const [stockStatus,usable] of [['low_stock',true],['unavailable',false]]){
  const checked=api.evaluateGenericOffer('food_grocery',{stock_status:stockStatus,stock_quantity:1},
    {quantity:1,requirements:{}}).purchase_evaluation;
  assert.equal(checked.stock_ok,usable);
  assert.equal(api.universalCandidateCommerceEvidence({stock_status:stockStatus}).stock_usable,usable);
}
assert.ok(api.evaluateGenericOffer('food_grocery',shippingEstimate,{quantity:2,requirements:{}})
  .purchase_evaluation.hard_blockers.includes('stock_quantity_unknown'));

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
  if(url.pathname==='/rest/v1/merchants'){
    if(mode==='directory-error')return Response.json({message:'unavailable'},{status:503});
    if(mode==='directory'){
      assert.equal(url.searchParams.get('select'),'id,slug,name,website_url,country_code');
      assert.equal(url.searchParams.get('verified'),'eq.true');
      assert.equal(url.searchParams.get('status'),'eq.active');
      assert.equal(url.searchParams.get('order'),'id.asc');
      assert.equal(url.searchParams.get('country_code'),'eq.JP');
      assert.equal(url.searchParams.get('limit'),'2');
      const rows=[
        {id:'10000000-0000-4000-8000-000000000001',slug:'first',name:'First',country_code:'JP',
          website_url:'https://merchant.example',merchant_api_key_hash:'must-not-leak'},
        {id:'10000000-0000-4000-8000-000000000002',slug:'second',name:'Second',country_code:'JP',
          website_url:'javascript:alert(1)'}
      ];
      return Response.json(url.searchParams.get('id')==='gt.'+rows[0].id?rows.slice(1):rows);
    }
    return Response.json([{id:'10000000-0000-4000-8000-000000000001',status:'active'}]);
  }
  if(url.pathname.startsWith('/rest/v1/rpc/gpd33_')&&/handoff/.test(url.pathname)){
    return Response.json({ok:true,fixture:JSON.parse(options.body)});
  }
  if(url.pathname==='/rest/v1/rpc/gpd33_business_outcomes'){
    return Response.json({verified_outcomes:{confirmed_goods_transactions:null}});
  }
  if(url.pathname==='/rest/v1/rpc/gpd33_health_events'){
    return Response.json({events:{},growth_24h:{read_ok:true},latest_expansion:null});
  }
  if(url.pathname==='/rest/v1/rpc/gpd33_coverage'||url.pathname==='/rest/v1/rpc/gpd33_run_metrics'){
    return Response.json({});
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
  if(url.pathname==='/rest/v1/products'&&mode.startsWith('decision')){
    return Response.json([{id:'10000000-0000-4000-8000-000000000005',manufacturer:'Example',
      product_type:'food_grocery',source_product_key:'universal:gtin:00012345678905',
      canonical_name_ja:'Example Pasta',gpd33_verified:mode==='decision_verified',
      metadata:{identifiers:{gtin:'012345678905'},gpd33_verified:mode==='decision_verified'}}]);
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
const mockPaymentChallenge=await call('/v1/purchase-decision');
const accepted=JSON.parse(Buffer.from(mockPaymentChallenge.headers.get('payment-required'),'base64')).accepts[0];
const signedPayment=new Request(origin+'/v1/purchase-decision',{
  headers:{'x-ai-test-mode':'x402_fixture','payment-signature':Buffer.from(JSON.stringify({x402Version:2,accepted,payload:{}})).toString('base64')}
});
const originalPaymentFetch=globalThis.fetch;
const recordedPayments=[];
const fixtureTransaction='1'.repeat(63)+'2';
let mockSettlementSuccess=true;
globalThis.fetch=async (target,options={})=>{
  const url=new URL(target);
  if(url.pathname.endsWith('/verify'))return Response.json({isValid:true});
  if(url.pathname.endsWith('/settle'))return Response.json({success:mockSettlementSuccess,transaction:fixtureTransaction});
  if(url.pathname==='/rest/v1/api_events'){
    recordedPayments.push(JSON.parse(options.body));
    return new Response(null,{status:204});
  }
  return originalPaymentFetch(target,options);
};
try {
  const gated=await api.x402Gate(signedPayment,env,Number(accepted.amount),'test',async()=>({ok:true}),ctx);
  assert.equal(gated.status,200);
  await Promise.all(pending);
  const [paid]=recordedPayments.filter(row=>row.event_type==='paid_call');
  assert.equal(paid.transaction_hash,fixtureTransaction);
  assert.equal(paid.metadata.test_mode,'test_x402_fixture');
  assert.equal(paid.amount_atomic,Number(accepted.amount));
  assert.equal(paid.payment_network,accepted.network);
  assert.deepEqual(paid.metadata.x402_reconciliation_v1,{mint:accepted.asset,payee:accepted.payTo});
  const environment='test', snapshot_id=randomUUID(), observed_at=Math.floor(Date.now()/1000);
  const bundle={schema_version:1,environment,envelopes:[]}, trust={schema_version:1,environment,issuers:{}};
  const chainTransfer={environment,transaction_hash:fixtureTransaction,payment_network:accepted.network,
    mint:accepted.asset,payee:accepted.payTo,amount_atomic:accepted.amount,instruction_index:'2.0',
    finality:'finalized',execution:'success'};
  for(const [issuer,context,rows] of [
    ['x402_expected','gpd33-x402-information-expected-v1',[{...paid,environment}]],
    ['x402_finalized','gpd33-x402-solana-finalized-v1',[chainTransfer]]
  ]){
    const {publicKey,privateKey}=generateKeyPairSync('ed25519');
    trust.issuers[issuer]={role:issuer,public_key:Buffer.from(publicKey.export({format:'jwk'}).x,'base64url').toString('hex')};
    const payload=Buffer.from(JSON.stringify({issuer,context,environment,snapshot_id,observed_at,rows}));
    bundle.envelopes.push({issuer,payload:payload.toString('base64url'),signature:sign(null,payload,privateKey).toString('base64url')});
  }
  const report=reconcileSignedGpd33X402Evidence(bundle,trust,snapshot_id);
  assert.equal(report.scope,'test_only');
  assert.equal(report.transactions.matched,1);
  assert.equal(report.matched_information_fee_atomic[accepted.network+'|'+accepted.asset],accepted.amount);
  mockSettlementSuccess=false;
  assert.equal((await api.x402Gate(signedPayment,env,Number(accepted.amount),'test',async()=>({ok:true}),ctx)).status,402);
  await Promise.all(pending);
  assert.equal(recordedPayments.filter(row=>row.event_type==='paid_call').length,1);
} finally {
  globalThis.fetch=originalPaymentFetch;
}
const directGtin='/v1/purchase-decision?gtin=012345678905&buyer_country=JP';
assert.equal((await call(directGtin)).status,402);
const invalidSignature={headers:{'payment-signature':'invalid-signature'}};
for(const gtinRequest of [await call(directGtin,invalidSignature),await call('/v1/purchase-decision',{
  method:'POST',headers:{'content-type':'application/json',...invalidSignature.headers},
  body:JSON.stringify({product:{gtin:'012345678905'},buyer_country:'JP'})
})]){
  assert.ok(gtinRequest.status>=400);
  const rejection=await gtinRequest.json();
  assert.match(rejection.error,/payment|x402/i);
  assert.notEqual(rejection.error,'purchase_query_or_product_required');
}
const invalidGtin=await call('/v1/purchase-decision?gtin=012345678906',invalidSignature);
assert.equal(invalidGtin.status,400);
assert.equal((await invalidGtin.json()).error,'purchase_query_or_product_required');
const participation=await (await call('/v1/merchant/participation')).json();
assert.equal(participation.registration.method,'POST');
assert.equal(participation.registration.initially_verified,false);
assert.equal(participation.supply.url,origin+'/v1/merchant/offers/feed-import');
assert.equal(participation.supply.auth_header,'x-merchant-key');
assert.equal(participation.buyer_preview.mcp_url,origin+'/mcp');
assert.equal(participation.merchant_workflow.handoff_inbox_url,origin+'/v1/merchant/handoffs');
assert.equal(participation.merchant_workflow.signed_handoff_events_url,origin+'/v1/merchant/handoffs/events');
assert.deepEqual(participation.merchant_workflow.handoff_signals,['accepted','order_reported','cancelled']);
const sellerLanding=await (await call('/merchant')).text();
assert.match(sellerLanding,/href="\/v1\/merchant\/participation"/);
const merchantOpenApi=await (await call('/openapi.json')).json();
assert.equal(merchantOpenApi.paths['/v1/merchant/participation'].get.operationId,'getMerchantParticipation');
for(const route of ['/v1/parts/status','/v1/merchant/search','/.well-known/x402','/openapi.json']){
  const response=await call(route);
  assert.ok(response.status<500,route+' '+response.status);
}
await Promise.allSettled(pending);

mode='catalog';
simulateFailure=true;
await assert.rejects(api.checkpointedUniversalDemandRefresh(env,1,'test',11*600000),/DB unavailable/);
assert.equal(staged.rows.length,1);
assert.equal(staged.metrics.query_family,'food_grocery:coffee');
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
assert.equal(staged.metrics.query_family,'food_grocery:pasta');
assert.equal(staged.metrics.catalog_errors,1);
assert.ok(staged.metrics.yahoo_calls>=1);
assert.equal(staged.metrics.ebay_calls,2);
assert.ok(requests.some(url=>url.searchParams.get('fieldgroups')==='PRODUCT'));
assert.ok(requests.length<=24,'Discovery used '+requests.length+' subrequests');
assert.equal(fallback.new,1);
const buildDecision=(quantity=1)=>api.buildUniversalPurchaseDecision(new Request(origin+'/v1/purchase-decision'),
  {...env,EBAY_CLIENT_ID:'e',EBAY_CLIENT_SECRET:'s'},
  {domain:'food_grocery',query:'Example Pasta',gtin:'012345678905',buyer_country:'JP',quantity},origin);
mode='decision_verified';
requests.length=0;
assert.equal((await buildDecision()).purchase.handoff_offer_lookup_url,
  origin+'/v1/merchant/search?gtin=00012345678905&buyer_country=JP');
assert.equal(requests.filter(url=>url.pathname==='/rest/v1/products').length,1);
assert.ok(!requests.some(url=>url.pathname==='/rest/v1/merchant_offers'));
const exactDecision=await api.buildUniversalPurchaseDecision(new Request(origin+'/v1/purchase-decision'),
  {...env,EBAY_CLIENT_ID:'e',EBAY_CLIENT_SECRET:'s'},
  {product:{gtin:'012345678905'},buyer_country:'JP'},origin);
assert.equal(exactDecision.normalized_intent.product.gtin,'012345678905');
assert.equal(exactDecision.purchase.handoff_offer_lookup_url,
  origin+'/v1/merchant/search?gtin=00012345678905&buyer_country=JP');
const decisionWithoutProviders=()=>api.buildUniversalPurchaseDecision(
  new Request(origin+'/v1/purchase-decision'),env,{gtin:'012345678905',buyer_country:'JP'},origin);
requests.length=0;
const catalogOnly=await decisionWithoutProviders();
assert.equal(catalogOnly.purchase.handoff_offer_lookup_url,
  origin+'/v1/merchant/search?gtin=00012345678905&buyer_country=JP');
assert.equal(catalogOnly.decision.can_purchase,false);
const catalogReads=requests.filter(url=>url.pathname==='/rest/v1/products');
assert.equal(catalogReads.length,1);
assert.equal(catalogReads[0].searchParams.get('select'),'source_product_key,manufacturer,product_type,gpd33_verified:metadata->gpd33_verified');
assert.equal(catalogReads[0].searchParams.get('source_product_key'),'eq.universal:gtin:00012345678905');
assert.ok(!requests.some(url=>url.hostname==='api.ebay.com'||url.hostname.endsWith('yahooapis.jp')));
const decisionWithManufacturer=(manufacturer)=>api.buildUniversalPurchaseDecision(
  new Request(origin+'/v1/purchase-decision'),env,
  {product:{gtin:'012345678905',manufacturer},buyer_country:'JP'},origin);
assert.equal((await decisionWithManufacturer('EXAMPLE')).purchase.handoff_offer_lookup_url,
  origin+'/v1/merchant/search?gtin=00012345678905&buyer_country=JP&manufacturer=EXAMPLE');
assert.equal((await decisionWithManufacturer('Other')).purchase.handoff_offer_lookup_url,null);
for(const [brand,matched] of [['Example',true],['Other',false],[null,false]]){
  const evaluation=api.evaluateGenericOffer('food_grocery',{brand,gtin:'012345678905'},
    {product:{manufacturer:'Example',identifiers:{gtin:'012345678905'}}}).purchase_evaluation;
  assert.equal(evaluation.identity.match,matched);
}
const decisionWithRequirements=(requirements)=>api.buildUniversalPurchaseDecision(
  new Request(origin+'/v1/purchase-decision'),env,{gtin:'012345678905',buyer_country:'JP',requirements},origin);
assert.equal((await decisionWithRequirements({condition:'used'})).purchase.handoff_offer_lookup_url,
  origin+'/v1/merchant/search?gtin=00012345678905&buyer_country=JP&condition=used');
for(const attribute of ['size','color','capacity','pack_size']){
  const constrained=await decisionWithRequirements({[attribute]:'explicit request'});
  assert.equal(constrained.purchase.handoff_offer_lookup_url,null);
  assert.equal(constrained.purchase.handoff_offer_lookup_blocker,'variant_verification_required');
}
const bulkDecision=await buildDecision(3);
assert.equal(bulkDecision.purchase.handoff_offer_lookup_url,
  origin+'/v1/merchant/search?gtin=00012345678905&buyer_country=JP&quantity=3');
assert.equal((await buildDecision(101)).purchase.handoff_offer_lookup_url,null);
for(const [quantity,status,blocker] of [
  [undefined,'unknown','stock_quantity_unknown'],[2,'insufficient','stock_quantity_insufficient'],[3,'sufficient',null]
]){
  const evaluation=api.evaluateGenericOffer('food_grocery',
    {stock_status:'in_stock',stock_quantity:quantity},{quantity:3,destination:{country:'JP'},requirements:{}}).purchase_evaluation;
  assert.equal(evaluation.stock_quantity_evidence,status);
  assert.equal(evaluation.hard_blockers.some(value=>value.startsWith('stock_quantity_')),Boolean(blocker));
  if(blocker)assert.ok(evaluation.hard_blockers.includes(blocker));
}
mode='decision_unverified';
assert.equal((await buildDecision()).purchase.handoff_offer_lookup_url,null);
assert.equal((await decisionWithoutProviders()).purchase.handoff_offer_lookup_url,null);
mode='http';
const adminRoute='/admin/business-outcomes';
assert.equal((await call(adminRoute)).status,401);
const businessResponse=await call(adminRoute,{headers:{'x-refresh-key':'fixture-admin'}});
assert.equal(businessResponse.status,200);
assert.equal(businessResponse.headers.get('cache-control'),'no-store');
assert.equal((await businessResponse.json()).metrics.verified_outcomes.confirmed_goods_transactions,null);
const handoff='10000000-0000-4000-8000-000000000003';
const offerId='10000000-0000-4000-8000-000000000004';
const handoffRequest=(path,body,headers={})=>call(path,{
  method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)
});
assert.equal((await handoffRequest('/admin/handoffs',{handoff_id:handoff})).status,401);
assert.equal((await handoffRequest('/admin/handoffs',{handoff_id:handoff,offer_id:offerId,quantity:1},{'x-refresh-key':'fixture-admin'})).status,400);
const authorizedHandoff=await handoffRequest('/admin/handoffs',{handoff_id:handoff,offer_id:offerId,quantity:1,buyer_authorized:true},{'x-refresh-key':'fixture-admin'});
assert.equal((await authorizedHandoff.json()).fixture.handoff,handoff);
assert.equal((await call('/v1/merchant/handoffs')).status,401);
const receivedEvent=await handoffRequest('/v1/merchant/handoffs/events',{handoff_id:handoff,event_id:offerId,
  state:'order_reported',order_reference:'private-reference',merchant_id:'caller-controlled'},{'x-merchant-key':'fixture'});
const recorded=(await receivedEvent.json()).fixture;
assert.equal(recorded.seller,'10000000-0000-4000-8000-000000000001');
assert.match(recorded.reference_hash,/^[0-9a-f]{64}$/);
assert.ok(!JSON.stringify(recorded).includes('private-reference'));
const cachedHealth=new Map();
globalThis.caches={default:{
  match:async request=>cachedHealth.get(request.url)?.clone(),
  put:async (request,response)=>cachedHealth.set(request.url,response)
}};
requests.length=0;
const firstHealth=await call('/v1/system/discovery-health?probe=1');
assert.match(firstHealth.headers.get('cache-control'),/max-age=300/);
assert.equal((await firstHealth.json()).growth_24h.read_ok,true);
await Promise.allSettled(pending);
const repeatHealth=await call('/v1/system/discovery-health?probe=2');
assert.equal((await repeatHealth.json()).growth_24h.read_ok,true);
assert.equal(requests.filter(url=>url.hostname==='db.example').length,3);
assert.ok(requests.every(url=>!url.pathname.endsWith('/api_events')));
delete globalThis.caches;
mode='directory';
const directory='/v1/merchant/directory?country=jp&limit=1';
requests.length=0;
assert.equal((await call(directory+'&after=bad')).status,400);
assert.equal((await call('/v1/merchant/directory?limit=51')).status,400);
assert.equal(requests.length,0,'Invalid directory parameters should not reach the database');
const firstPage=await call(directory);
assert.equal(firstPage.status,200);
assert.match(firstPage.headers.get('cache-control'),/max-age=60/);
const firstDirectory=await firstPage.json();
assert.equal(firstDirectory.merchant_country,'JP');
assert.equal(firstDirectory.merchants.length,1);
assert.match(firstDirectory.merchants[0].offer_feed_url,/\/v1\/merchant\/feed\?merchant=first$/);
assert.ok(!JSON.stringify(firstDirectory).includes('must-not-leak'));
const lastPage=await (await call(directory+'&after='+firstDirectory.next_cursor)).json();
assert.equal(lastPage.merchants[0].slug,'second');
assert.equal(lastPage.merchants[0].website_url,null);
assert.equal(lastPage.next_cursor,null);
assert.equal(requests.length,2,'A directory page should use one Supabase request');
const toolsResponse=await (await post('/mcp',{jsonrpc:'2.0',id:20,method:'tools/list',params:{}})).json();
assert.ok(toolsResponse.result.tools.some(tool=>tool.name==='merchant_directory'));
const mcpDirectory=await (await post('/mcp',{jsonrpc:'2.0',id:21,method:'tools/call',params:{
  name:'merchant_directory',arguments:{country:'JP',limit:1}
}})).json();
assert.deepEqual(mcpDirectory.result.structuredContent,firstDirectory);
mode='directory-error';
assert.equal((await call(directory)).status,503);
const directorySpec=await (await call('/openapi.json')).json();
assert.equal(directorySpec.paths['/v1/merchant/directory'].get.operationId,'listVerifiedMerchants');
console.log('PASS Worker routes, MCP, x402, identification, variants, source fallback, DB recovery and subrequest budget');
