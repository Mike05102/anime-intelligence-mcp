import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {fetchApprovedMerchantOfferFeed,requestPinnedHttps} from '../scripts/gpd33_merchant_feed_fetch.mjs';

const now=Date.parse('2026-11-25T10:00:00Z');
const approval={merchant_id:'10000000-0000-4000-8000-000000000001',feed_url:'https://feed.merchant.example/catalog.json',
  approved_until:'2026-12-25T00:00:00Z',product_origins:['https://merchant.example/']};
const offer={merchant_sku:'sku',manufacturer:'Example',part_number:'X-1',gtin:'4901234567894',title:'Product',
  currency:'JPY',price:'1200.00',stock_status:'in_stock',ships_to:['JP'],product_url:'https://merchant.example/x-1'};
const manifest={schema:'gpd-merchant-offer-feed-input-v1',merchant_id:approval.merchant_id,feed_url:approval.feed_url,
  observed_at:'2026-11-25T09:00:00Z',offers:[offer]};
const payload=Buffer.from(JSON.stringify(manifest));
const address='93.184.215.14';
const calls=[];
const okResponse=(chunks=[payload],statusCode=200,headers={'content-type':'application/json;charset=utf-8'})=>
  Object.assign(Readable.from(chunks),{statusCode,headers});
const defaultDependencies={
  now,resolve:async(host,signal)=>{
    assert.ok(signal instanceof AbortSignal);
    calls.push(['resolve',host]);
    return [address];
  },
  request:async(url,options)=>{
    assert.ok(options.signal instanceof AbortSignal);
    calls.push(['request',url.href,options.address]);
    return okResponse();
  }
};
const preview=await fetchApprovedMerchantOfferFeed(approval,defaultDependencies);
assert.equal(preview.status,'operator_review_required');
assert.equal(preview.upsert_payload.offers[0].product_url,offer.product_url);
assert.deepEqual(calls,[['resolve','feed.merchant.example'],['request',approval.feed_url,address]]);
const transportUrl=new URL(approval.feed_url);
const transportSignal=new AbortController().signal;
const mockHttps=(remoteAddress)=>(url,options,receive)=>{
  assert.equal(url.href,approval.feed_url);
  assert.equal(options.signal,transportSignal);
  assert.equal(options.rejectUnauthorized,true);
  assert.equal(options.agent,false);
  assert.deepEqual(options.headers,{accept:'application/json','accept-encoding':'identity'});
  options.lookup(url.hostname,{},(error,selected,family)=>{
    assert.equal(error,null);
    assert.equal(selected,address);
    assert.equal(family,4);
  });
  receive(Object.assign(okResponse(),{socket:{remoteAddress}}));
  return new EventEmitter();
};
const pinned=await requestPinnedHttps(transportUrl,{address,signal:transportSignal},mockHttps(address));
assert.equal(pinned.statusCode,200);
pinned.destroy();
await assert.rejects(requestPinnedHttps(transportUrl,{address,signal:transportSignal},mockHttps('127.0.0.1')),/unexpected_feed_peer_address/);
calls.length=0;
await assert.rejects(fetchApprovedMerchantOfferFeed({...approval,approved_until:'2026-11-20T00:00:00Z'},defaultDependencies),/feed_approval_required/);
assert.deepEqual(calls,[]);
await assert.rejects(fetchApprovedMerchantOfferFeed({...approval,feed_url:'https://feed.merchant.example/?token=secret'},defaultDependencies),/invalid_https_url/);
assert.deepEqual(calls,[]);
for(const resolved of ['127.0.0.1','10.12.0.3','169.254.169.254','192.168.0.1','100.64.0.1','::1','::ffff:127.0.0.1']){
  await assert.rejects(fetchApprovedMerchantOfferFeed(approval,{
    ...defaultDependencies,resolve:async()=>[address,resolved],request:async()=>assert.fail('unsafe connection')
  }),/public_ipv4/);
}

const redirect=okResponse([],302,{location:'http://127.0.0.1/internal'});
let requests=0;
await assert.rejects(fetchApprovedMerchantOfferFeed(approval,{
  ...defaultDependencies,request:async()=>{requests++;return redirect;}
}),/http_status/);
assert.equal(requests,1);
assert.equal(redirect.destroyed,true);

for(const [response,pattern] of [
  [okResponse([payload],200,{'content-type':'text/html'}),/expected_uncompressed/],
  [okResponse([payload],200,{'content-type':'application/json','content-encoding':'gzip'}),/expected_uncompressed/],
  [okResponse([payload],200,{'content-type':'application/json','content-length':'262145'}),/256_KiB/],
  [okResponse([Buffer.alloc(262144),Buffer.from('x')]),/256_KiB/],
  [okResponse([payload],200,{'content-type':'application/json','content-length':'1'}),/length_mismatch/],
  [okResponse([Buffer.from(JSON.stringify({...manifest,feed_url:'https://spoof.example/catalog.json'}))]),/feed_approval_required/],
  [okResponse([Buffer.from([0xc0,0xaf])]),/invalid_feed_json/]
]){
  await assert.rejects(fetchApprovedMerchantOfferFeed(approval,{...defaultDependencies,request:async()=>response}),pattern);
  assert.equal(response.destroyed,true);
}
console.log('PASS approved merchant HTTPS source binding, DNS address pinning, no redirects, and bounded payloads');
