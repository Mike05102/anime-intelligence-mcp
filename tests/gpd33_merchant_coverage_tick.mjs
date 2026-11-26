import assert from 'node:assert/strict';
import {chmod,mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareMerchantOfferFeed} from '../scripts/gpd33_merchant_offer_feed.mjs';
import {publishApprovedMerchantFeed} from '../scripts/gpd33_merchant_feed_publish.mjs';
import {runMerchantCoverageTick} from '../scripts/gpd33_merchant_coverage_tick.mjs';

const now=Date.parse('2026-11-25T10:00:00Z');
const hour=3600000;
const directory=await mkdtemp(join(tmpdir(),'gpd-coverage-'));
const registryPath=join(directory,'approved-registry.json');
const destination=join(directory,'merchant-coverage.json');
const writeJson=(path,value)=>writeFile(path,JSON.stringify(value),{mode:0o600});
const sourceNames=['bravo','charlie','delta','echo','alpha'];
const registry={schema:'gpd-merchant-coverage-registry-v1',max_feeds_per_tick:2,
  sources:sourceNames.map(source=>({source,approval_file:source+'.json'}))};
const buildApproval=(name)=>({merchant_id:'10000000-0000-4000-8000-000000000001',
  feed_url:'https://'+name+'.example/feed.json',approved_until:'2026-12-25T00:00:00Z',
  product_origins:['https://'+name+'.example/']});
const baseOffer={merchant_sku:'private-sku',manufacturer:'Example',part_number:'X-1',gtin:'4901234567894',
  title:'private product title',currency:'JPY',price:'1200.00',stock_status:'in_stock',stock_quantity:3,
  ships_to:['JP','US']};
const requests=[];
function simulatedFeed(approval,{now:tickTime}){
  const url=new URL(approval.feed_url);
  requests.push(url.hostname);
  if(url.hostname==='charlie.example')throw new Error('provider URL or secret must not appear in the report');
  const offer={...baseOffer,product_url:url.origin+'/private-product'};
  return prepareMerchantOfferFeed(approval,{
    schema:'gpd-merchant-offer-feed-input-v1',merchant_id:approval.merchant_id,feed_url:approval.feed_url,
    observed_at:new Date(tickTime-60000).toISOString(),offers:[offer,
      {...offer,merchant_sku:'zero-stock',stock_quantity:0,ships_to:['DE']},
      {...offer,merchant_sku:'no-qty',stock_quantity:null,ships_to:[]}]
  },tickTime);
}
try{
  await writeJson(registryPath,{...registry,max_feeds_per_tick:5});
  const forbiddenNetwork=()=>assert.fail('No egress expected');
  await assert.rejects(runMerchantCoverageTick(registryPath,directory,{now,fetchFeed:forbiddenNetwork}),/invalid_coverage_registry/);
  await writeJson(registryPath,registry);
  for(const source of sourceNames){
    if(source!=='echo')await writeJson(join(directory,source+'.json'),buildApproval(source));
  }
  const first=await runMerchantCoverageTick(registryPath,directory,{now,fetchFeed:simulatedFeed});
  assert.deepEqual(first,{status:'coverage_checked',configured:5,attempted:2,observed:2,unavailable:0});
  assert.deepEqual(requests,['alpha.example','bravo.example']);
  assert.equal((await stat(destination)).mode&0o077,0);
  const persisted=await readFile(destination,'utf8');
  assert.doesNotMatch(persisted,/example|private-sku|private product|1200/);
  const state=JSON.parse(persisted);
  assert.equal(state.scope,'approved_merchant_preview_claims');
  assert.equal(state.last_source,'bravo');
  assert.deepEqual(state.results[0].evidence,{offers:3,offers_with_structured_gtin:3,quantity_unknown:1,
    claimed_in_stock_gtin_with_destinations:1,claimed_destination_count:2,claimed_offer_currency_count:1,
    feed_observed_at:'2026-11-25T09:59:00.000Z'});
  assert.deepEqual(await runMerchantCoverageTick(registryPath,directory,{now:now+hour-1,fetchFeed:forbiddenNetwork}),{status:'coverage_not_due'});

  let began;
  let resume;
  const started=new Promise(resolve=>{began=resolve;});
  const continuation=new Promise(resolve=>{resume=resolve;});
  const second=runMerchantCoverageTick(registryPath,directory,{now:now+hour,fetchFeed:async(...args)=>{
    began();
    await continuation;
    return simulatedFeed(...args);
  }});
  await started;
  assert.equal(JSON.parse(await readFile(destination,'utf8')).last_source,'delta');
  assert.deepEqual(await runMerchantCoverageTick(registryPath,directory,{now:now+hour,fetchFeed:forbiddenNetwork}),{status:'coverage_in_progress'});
  resume();
  assert.deepEqual(await second,{status:'coverage_checked',configured:5,attempted:2,observed:1,unavailable:1});
  assert.deepEqual(requests,['alpha.example','bravo.example','charlie.example','delta.example']);
  assert.equal(JSON.parse(await readFile(destination,'utf8')).results.find(row=>row.source==='charlie').status,'feed_unavailable');

  assert.deepEqual(await runMerchantCoverageTick(registryPath,directory,{now:now+2*hour,fetchFeed:simulatedFeed}),
    {status:'coverage_checked',configured:5,attempted:2,observed:1,unavailable:1});
  assert.equal(requests.at(-1),'alpha.example');
  assert.equal(JSON.parse(await readFile(destination,'utf8')).results.find(row=>row.source==='echo').status,'approval_unavailable');

  await writeJson(registryPath,{...registry,stage_previews:true});
  await runMerchantCoverageTick(registryPath,directory,{now:now+3*hour,fetchFeed:simulatedFeed});
  const staged=JSON.parse(await readFile(destination,'utf8')).results.find(row=>row.source==='bravo');
  const previewPath=join(directory,staged.preview_file);
  const report=JSON.parse(await readFile(previewPath,'utf8'));
  assert.equal(report.schema,'gpd-merchant-feed-review-v1');
  assert.equal(report.snapshot_id,staged.snapshot_id);
  assert.equal(report.merchant_feed.offer_count,3);
  assert.equal((await stat(previewPath)).mode&0o077,0);
  await assert.rejects(publishApprovedMerchantFeed(report,buildApproval('bravo'),{},
    {now:now+3*hour,resolve:forbiddenNetwork,request:forbiddenNetwork}),/write_approval_required/);
  await chmod(registryPath,0o644);
  await assert.rejects(runMerchantCoverageTick(registryPath,directory,{now:now+3*hour,fetchFeed:forbiddenNetwork}),/private_coverage_file_required/);
}finally{
  await rm(directory,{recursive:true,force:true});
}
console.log('PASS private recurring merchant coverage, bounded reads, rotation, rate limiting, failures and overlap');
