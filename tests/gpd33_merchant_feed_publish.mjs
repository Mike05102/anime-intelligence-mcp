import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {chmod,mkdtemp,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fingerprintPartnerReview,publishApprovedMerchantFeed} from '../scripts/gpd33_merchant_feed_publish.mjs';
import {prepareMerchantOfferFeed} from '../scripts/gpd33_merchant_offer_feed.mjs';
import {requestPinnedHttps} from '../scripts/gpd33_merchant_feed_fetch.mjs';

const now=Date.parse('2026-11-25T10:00:00Z');
const address='93.184.215.14';
const apiKey='mai_'+'a'.repeat(48);
const feedApproval={merchant_id:'10000000-0000-4000-8000-000000000001',feed_url:'https://feed.merchant.example/catalog.json',
  approved_until:'2026-12-25T00:00:00Z',product_origins:['https://merchant.example/']};
const offer={merchant_sku:'sku',manufacturer:'Example',part_number:'X-1',gtin:'4901234567894',title:'Product',
  currency:'JPY',price:'1200.00',stock_status:'in_stock',stock_quantity:3,condition:'refurbished',ships_to:['JP'],
  product_url:'https://merchant.example/x-1'};
const feed={schema:'gpd-merchant-offer-feed-input-v1',merchant_id:feedApproval.merchant_id,feed_url:feedApproval.feed_url,
  observed_at:'2026-11-25T09:00:00Z',offers:[offer]};
const report={schema:'gpd-partner-review-v1',status:'review_required',snapshot_id:'00000000-0000-4000-8000-000000000010',
  merchant_feed:prepareMerchantOfferFeed(feedApproval,feed,now),reconciliation:{scope:'test'}};
const writeApproval={schema:'gpd-merchant-feed-write-approval-v1',allow_publish:true,merchant_id:feedApproval.merchant_id,
  snapshot_id:report.snapshot_id,report_sha256:fingerprintPartnerReview(report),worker_origin:'https://gpd.example',
  approved_until:'2026-11-26T00:00:00Z'};
const response=(payload,statusCode=200,headers={'content-type':'application/json;charset=utf-8'})=>
  Object.assign(Readable.from([Buffer.from(JSON.stringify(payload))]),{statusCode,headers});
const calls=[];
const defaultDependencies={
  apiKey,now,
  resolve:async host=>{assert.equal(host,'gpd.example');return address;},
  request:async(url,options)=>{
    assert.equal(url.origin,writeApproval.worker_origin);
    assert.equal(options.headers['x-merchant-key'],apiKey);
    assert.equal(options.address,address);
    calls.push(url.pathname);
    if(url.pathname==='/v1/merchant/me')return response({ok:true,merchant:{id:feedApproval.merchant_id,verified:true}});
    assert.equal(url.pathname,'/v1/merchant/offers/feed-import');
    assert.equal(options.method,'POST');
    assert.equal(Number(options.headers['content-length']),Buffer.byteLength(options.body));
    assert.equal(options.body.includes(apiKey),false);
    const body=JSON.parse(options.body);
    assert.deepEqual(body,{merchant_id:feedApproval.merchant_id,offers:report.merchant_feed.upsert_payload.offers});
    assert.equal(body.offers[0].stock_quantity,3);
    assert.equal(body.offers[0].condition,'refurbished');
    return response({ok:true,merchant_id:body.merchant_id,offers_received:1,new_or_updated:0,ignored:1});
  }
};
assert.deepEqual(await publishApprovedMerchantFeed(report,feedApproval,writeApproval,defaultDependencies),{
  status:'import_confirmed',snapshot_id:report.snapshot_id,merchant_id:feedApproval.merchant_id,offers_received:1,new_or_updated:0,ignored:1
});
assert.deepEqual(calls,['/v1/merchant/me','/v1/merchant/offers/feed-import']);

const noNetwork={...defaultDependencies,resolve:async()=>assert.fail('approval failure must precede network')};
const stagedReport={...report,schema:'gpd-merchant-feed-review-v1'};
const stagedResult=await publishApprovedMerchantFeed(stagedReport,feedApproval,
  {...writeApproval,report_sha256:fingerprintPartnerReview(stagedReport)},defaultDependencies);
assert.equal(stagedResult.status,'import_confirmed');

await assert.rejects(publishApprovedMerchantFeed(report,feedApproval,{...writeApproval,allow_publish:false},noNetwork),/approval_required/);
await assert.rejects(publishApprovedMerchantFeed(report,feedApproval,{...writeApproval,report_sha256:'0'.repeat(64)},noNetwork),/approval_required/);
await assert.rejects(publishApprovedMerchantFeed(report,feedApproval,{...writeApproval,approved_until:'2026-11-20T00:00:00Z'},noNetwork),/approval_required/);
await assert.rejects(publishApprovedMerchantFeed(report,feedApproval,{...writeApproval,worker_origin:'https://gpd.example/altered'},noNetwork),/approval_required/);
await assert.rejects(publishApprovedMerchantFeed(report,{...feedApproval,feed_url:'https://feed.merchant.example/alternate'},writeApproval,noNetwork),/approval_required/);
const invalidFeed=structuredClone(report);
invalidFeed.merchant_feed.upsert_payload.offers[0].product_url='https://forged.example';
await assert.rejects(publishApprovedMerchantFeed(invalidFeed,feedApproval,
  {...writeApproval,report_sha256:fingerprintPartnerReview(invalidFeed)},noNetwork),/unapproved_product_origin/);
const invalidStock=structuredClone(report);
invalidStock.merchant_feed.upsert_payload.offers[0].stock_quantity='3';
await assert.rejects(publishApprovedMerchantFeed(invalidStock,feedApproval,
  {...writeApproval,report_sha256:fingerprintPartnerReview(invalidStock)},noNetwork),/invalid_stock_quantity/);
const invalidCondition=structuredClone(report);
invalidCondition.merchant_feed.upsert_payload.offers[0].condition='like_new';
await assert.rejects(publishApprovedMerchantFeed(invalidCondition,feedApproval,
  {...writeApproval,report_sha256:fingerprintPartnerReview(invalidCondition)},noNetwork),/invalid_condition/);
const noPublish=(mea)=>({...defaultDependencies,request:async url=>{
  assert.equal(url.pathname,'/v1/merchant/me','invalid identity or redirect stops the publish');
  return mea;
}});
await assert.rejects(publishApprovedMerchantFeed(report,feedApproval,writeApproval,noPublish(
  response({ok:true,merchant:{id:'other',verified:true}}))),/identity_mismatch/);
await assert.rejects(publishApprovedMerchantFeed(report,feedApproval,writeApproval,noPublish(
  response({ok:true,merchant:{id:feedApproval.merchant_id,verified:false}}))),/identity_mismatch/);
await assert.rejects(publishApprovedMerchantFeed(report,feedApproval,writeApproval,noPublish(
  response({},307,{location:'https://other.example'}))),/response_rejected/);

const transportBody='{"offers":[]}';
const options={address,signal:new AbortController().signal,method:'POST',body:transportBody,headers:{'x-merchant-key':apiKey}};
let posted;
await requestPinnedHttps(new URL(writeApproval.worker_origin),options,(_url,request,receive)=>{
  assert.equal(request.method,'POST');
  assert.equal(request.headers['x-merchant-key'],apiKey);
  const emitter=new EventEmitter();
  emitter.end=body=>{
    posted=body;
    receive(Object.assign(response({ok:true}),{socket:{remoteAddress:address}}));
  };
  return emitter;
});
assert.equal(posted,transportBody);

const directory=await mkdtemp(join(tmpdir(),'gpd-feed-receipt-'));
try{
  let signalFirst;
  let releaseFirst;
  const firstStarted=new Promise(resolve=>{signalFirst=resolve;});
  const firstContinue=new Promise(resolve=>{releaseFirst=resolve;});
  calls.length=0;
  const first=publishApprovedMerchantFeed(report,feedApproval,writeApproval,{
    ...defaultDependencies,receiptDirectory:directory,
    request:async(url,options)=>{
      if(url.pathname==='/v1/merchant/me'){
        signalFirst();
        await firstContinue;
      }
      return defaultDependencies.request(url,options);
    }
  });
  await firstStarted;
  assert.equal((await publishApprovedMerchantFeed(report,feedApproval,writeApproval,{
    ...noNetwork,receiptDirectory:directory
  })).status,'import_in_progress');
  releaseFirst();
  assert.equal((await first).status,'import_confirmed');

  const [receiptFile]= (await readdir(directory)).filter(name=>name.endsWith('.json'));
  const receiptPath=join(directory,receiptFile);
  assert.equal((await stat(receiptPath)).mode&0o077,0);
  const receipt=await readFile(receiptPath,'utf8');
  assert.ok(!receipt.includes(apiKey));
  assert.ok(!receipt.includes(offer.product_url));
  assert.deepEqual(await publishApprovedMerchantFeed(report,feedApproval,writeApproval,{
    ...noNetwork,apiKey:undefined,receiptDirectory:directory
  }),{status:'already_imported',snapshot_id:report.snapshot_id,merchant_id:feedApproval.merchant_id,
    offers_received:1,new_or_updated:0,ignored:1});
  assert.deepEqual(calls,['/v1/merchant/me','/v1/merchant/offers/feed-import']);
  await assert.rejects(publishApprovedMerchantFeed(report,feedApproval,{...writeApproval,allow_publish:false},{
    ...noNetwork,receiptDirectory:directory
  }),/write_approval_required/);
  const tampered=JSON.parse(receipt);
  tampered.worker_origin='https://other.example';
  await writeFile(receiptPath,JSON.stringify(tampered));
  await assert.rejects(publishApprovedMerchantFeed(report,feedApproval,writeApproval,{
    ...noNetwork,receiptDirectory:directory
  }),/invalid_publish_receipt/);
  await chmod(directory,0o755);
  await assert.rejects(publishApprovedMerchantFeed(report,feedApproval,writeApproval,{
    ...noNetwork,receiptDirectory:directory
  }),/private_receipt_directory_required/);
}finally{await rm(directory,{recursive:true,force:true});}
console.log('PASS approval, merchant binding, pinned POST, concurrent import guard and durable private receipt reuse');
