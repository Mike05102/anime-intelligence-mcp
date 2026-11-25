import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {readApprovedSellerDiscoverySource,runSellerDiscoveryTick} from '../scripts/gpd33_seller_discovery_tick.mjs';

const now=Date.parse('2026-11-25T12:00:00Z');
const HOUR=3600000;
const iso=value=>new Date(value).toISOString();
const origin='https://catalog.example.com';
const source=(id,domains,buyerCountries,extra={})=>({
  id,kind:'merchant_feed',domains,buyer_countries:buyerCountries,
  endpoint:`${origin}/feeds/${id}.json`,terms_url:origin+'/terms',
  approved_for:'public_seller_discovery',no_cost_public_read:true,approved_until:iso(now+48*HOUR),
  evidence_origins:[origin],consent_origins:[origin],...extra
});
const registry={schema:'gpd-seller-discovery-registry-v1',environment:'test',max_reads:2,sources:[
  source('alpha',['tools_hardware'],['CA']),
  source('market',['fashion'],[],{kind:'ebay_browse',consent_origins:[]}),
  source('de',['food_grocery'],['DE']),
  source('jp',['food_grocery'],['JP']),
  source('expired',['food_grocery'],['JP'],{approved_until:iso(now-1)})
]};
const demand={schema:'gpd-seller-discovery-demand-v1',environment:'test',observed_at:iso(now),rows:[
  {domain:'food_grocery',buyer_country:'JP',request_count:30},
  {domain:'food_grocery',buyer_country:'DE',request_count:12}
]};
const seller={source_seller_id:'merchant',public_name:'Fixture Merchant',merchant_country:'US',
  evidence_url:origin+'/merchant?q=private',observed_at:iso(now),opt_in_evidence_url:origin+'/merchant/consent?secret=123',
  opt_in_observed_at:iso(now),approval:true,email:'private@example.com'};
const manifest={schema:'gpd-seller-discovery-feed-v1',sellers:[
  seller,{...seller,source_seller_id:'outside',evidence_url:'https://unapproved.example.com/escape'},
  {...seller,source_seller_id:'external-consent',opt_in_evidence_url:'https://unapproved.example.com/claim'}
]};
const dir=await mkdtemp(join(tmpdir(),'gpd-seller-discovery-tick-'));
try{
  const registryFile=join(dir,'registry.json'),demandFile=join(dir,'demand.json');
  const stateFile=join(dir,'seller-discovery-state.json'),reportFile=join(dir,'seller-discovery-report.json');
  const store=(path,value)=>writeFile(path,JSON.stringify(value),{mode:0o600});
  await Promise.all([store(registryFile,registry),store(demandFile,demand)]);
  const attempts=[];
  const load=path=>readFile(path,'utf8').then(JSON.parse);
  await assert.rejects(runSellerDiscoveryTick(registryFile,demandFile,dir,{now}),/test_discovery_requires_fixture_reader/);
  const tick=(at)=>runSellerDiscoveryTick(registryFile,demandFile,dir,{now:at,readSource:async selected=>{
    attempts.push(selected.id);
    assert.equal(selected.url.href,`${origin}/feeds/${selected.id}.json`);
    assert.ok(!selected.url.search);
    const state=await load(stateFile);
    assert.equal(state.last_tick_ms,at,'budget was claimed before reading a source');
    if(at===now&&selected.id==='jp'){
      const other=await runSellerDiscoveryTick(registryFile,demandFile,dir,{
        now:at,readSource:async()=>{throw new Error('parallel read must not happen');}
      });
      assert.equal(other.status,'discovery_in_progress');
    }
    if(selected.id==='alpha')throw Object.assign(new Error('seller_source_rate_limited'),{retryAfter:new Date(now+36*HOUR).toUTCString()});
    return manifest;
  }});

  assert.deepEqual(await tick(now),{status:'discovery_review_ready',sources_attempted:2,candidates:2});
  assert.deepEqual(attempts,['jp','alpha']);
  assert.equal((await load(stateFile)).sources.alpha.cooldown_until_ms,now+36*HOUR);
  const first=await load(reportFile),firstJson=JSON.stringify(first);
  assert.deepEqual(first.results,[{source:'jp',status:'observed',scope_excluded:1},{source:'alpha',status:'rate_limited'}]);
  assert.equal(first.discovery.candidates.find(row=>row.source_seller_id==='jp.merchant').review_status,'review_opt_in_evidence');
  assert.equal(first.discovery.candidates.find(row=>row.source_seller_id==='jp.external-consent').review_status,'review_discovery_evidence');
  assert.ok(!firstJson.includes('private@example.com')&&!firstJson.includes('secret=')&&!firstJson.includes('request_count'));
  assert.equal((await stat(reportFile)).mode&0o777,0o600);
  assert.equal((await tick(now+10)).status,'discovery_not_due');
  assert.deepEqual(attempts,['jp','alpha']);

  await tick(now+HOUR);
  assert.deepEqual(attempts.slice(2),['jp','de']);
  await tick(now+2*HOUR);
  assert.deepEqual(attempts.slice(4),['jp','market']);
  assert.ok((await load(reportFile)).discovery.candidates
    .filter(row=>row.source==='ebay_browse').every(row=>row.review_status==='review_discovery_evidence'&&!row.opt_in_evidence_url));
  assert.ok(!attempts.includes('expired'));
  await store(registryFile,{...registry,sources:[source('unapproved',['food_grocery'],[],{no_cost_public_read:false})]});
  await assert.rejects(tick(now+3*HOUR),/invalid_approved_seller_discovery_source/);
  assert.equal(attempts.length,6);
}finally{
  await rm(dir,{recursive:true,force:true});
}

const approved={url:new URL(origin+'/approved.json')};
let networkCalls=0;
const response=(body,status=200,headers={'content-type':'application/json'})=>{
  const stream=Readable.from([Buffer.from(body)]);
  stream.statusCode=status;
  stream.headers=headers;
  return stream;
};
const fetchMock=(stream,resolve=async()=>['8.8.8.8'])=>readApprovedSellerDiscoverySource(approved,{
  resolve,request:async(url,{address,signal})=>{
    networkCalls++;
    assert.equal(url.href,approved.url.href);
    assert.equal(address,'8.8.8.8');
    assert.equal(signal.aborted,false);
    return stream;
  }
});
assert.deepEqual(await fetchMock(response(JSON.stringify(manifest))),manifest);
await assert.rejects(fetchMock(response('{}',302)),/seller_source_response_rejected/);
await assert.rejects(fetchMock(response('{}',429,{'retry-after':'86400'})),
  error=>error.message==='seller_source_rate_limited'&&error.retryAfter==='86400');
await assert.rejects(fetchMock(response(Buffer.alloc(64*1024+1))),/response_too_large/);
await assert.rejects(fetchMock(response('{}'),async()=>['127.0.0.1']),/public_ipv4/);
assert.equal(networkCalls,4);
console.log('PASS demand-directed seller discovery, private claims, fairness, consent scope, cooldown and pinned mock reads');
