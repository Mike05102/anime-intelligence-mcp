import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {measureSignedGpd33AcquisitionFunnel} from '../scripts/gpd33_acquisition_funnel.mjs';

const window_start=1795656000;
const window_end=window_start+86400;
const cohort_id='00000000-0000-4000-8000-000000000001';
const contexts={
  journeys:'gpd33-acquisition-journeys-v1',outcomes:'gpd33-acquisition-outcomes-v1'
};
const roles=Object.keys(contexts);
function fixture(environment){
  const issuers=Object.fromEntries(roles.map(role=>[role,generateKeyPairSync('ed25519')]));
  const channels={mcp_registry:{authorized_free_work:true},openapi_docs:{authorized_free_work:true},
    seller_directory:{authorized_free_work:true},paid_ads:{authorized_free_work:false}};
  const trust={schema_version:1,environment,channels,issuers:Object.fromEntries(roles.map(role=>[role,{
    role,public_key:Buffer.from(issuers[role].publicKey.export({format:'jwk'}).x,'base64url').toString('hex')
  }]))};
  const seal=(role,rows,more={})=>{
    const bytes=Buffer.from(JSON.stringify({issuer:role,context:contexts[role],environment,cohort_id,window_start,window_end,
      attribution:'verified_first_touch',rows,...more}));
    return {issuer:role,payload:bytes.toString('base64url'),signature:sign(null,bytes,issuers[role].privateKey).toString('base64url')};
  };
  const bundle=(visits,outcomes)=>({schema_version:1,environment,envelopes:[seal('journeys',visits),seal('outcomes',outcomes)]});
  return {trust,bundle,seal,run:(visits,outcomes,budget)=>measureSignedGpd33AcquisitionFunnel(bundle(visits,outcomes),trust,{budget})};
}
const test=fixture('test');
const live=fixture('live');
const visits=[
  {channel:'mcp_registry',visits:100,activations:25,handoffs:20},
  {channel:'openapi_docs',visits:40,activations:10,handoffs:2},
  {channel:'paid_ads',visits:120,activations:120,handoffs:120}
];
const outcomes=[
  {channel:'mcp_registry',verified_orders:5,x402_information_usdc_atomic:'10000',brokerage_usdc_atomic:'2300'},
  {channel:'openapi_docs',verified_orders:null,x402_information_usdc_atomic:'0',brokerage_usdc_atomic:null}
];
const result=test.run(visits,outcomes,8);
assert.equal(result.scope,'test_only');
assert.equal(result.attribution,'independently_signed_linked_aggregates');
const mcp=result.channels.find(row=>row.channel==='mcp_registry');
assert.deepEqual(mcp,{...visits[0],...outcomes[0]});
const openapi=result.channels.find(row=>row.channel==='openapi_docs');
assert.deepEqual(openapi,{...visits[1],...outcomes[1]});
assert.equal(result.channels.find(row=>row.channel==='seller_directory').visits,null);
const allocation=new Map(result.planning_only.allocations.map(row=>[row.channel,row]));
assert.equal(result.planning_only.environment,'test');
assert.equal(allocation.get('mcp_registry').units,4);
assert.equal(allocation.get('mcp_registry').basis,'verified_orders_and_handoffs');
assert.equal(allocation.get('openapi_docs').basis,'measured_handoffs');
assert.equal(allocation.get('seller_directory').basis,'limited_or_missing_sample');
assert.equal(allocation.has('paid_ads'),false);
assert.equal(result.planning_only.unallocated_units,0);
assert.equal(test.run(visits,outcomes,24).planning_only.unallocated_units,12);
assert.equal(test.run(visits,outcomes,0).planning_only.allocations.length,0);
assert.equal(live.run(visits,outcomes,3).scope,'supplied_live_evidence_only');

assert.throws(()=>test.run([{...visits[0],handoffs:90}],[],1),/journey counts/);
assert.throws(()=>test.run([visits[0]],[{...outcomes[0],verified_orders:30}],1),/outcome counts/);
assert.throws(()=>test.run([visits[0]],[{...outcomes[0],verified_orders:0}],1),/outcome counts/);
assert.throws(()=>test.run([visits[0]],[{...outcomes[0],x402_information_usdc_atomic:10}],1),/outcome counts/);
assert.throws(()=>test.run([],[outcomes[0]],1),/unlinked/);
assert.throws(()=>test.run([{...visits[0],channel:'invented'}],[],1),/measurement channel/);
assert.throws(()=>test.run([visits[0],visits[0]],[],1),/measurement channel/);
assert.throws(()=>test.run(visits,outcomes,25),/planning budget/);
const bundle=test.bundle(visits,outcomes);
const badSignature=structuredClone(bundle);
badSignature.envelopes[0].payload=Buffer.from(Buffer.from(bundle.envelopes[0].payload,'base64url').toString()
  .replace('"visits":100','"visits":999')).toString('base64url');
assert.throws(()=>measureSignedGpd33AcquisitionFunnel(badSignature,test.trust),/signature/);
const staleCohort={...bundle,envelopes:[bundle.envelopes[0],test.seal('outcomes',outcomes,{window_end:window_end+1})]};
assert.throws(()=>measureSignedGpd33AcquisitionFunnel(staleCohort,test.trust),/does not match/);
const heuristicAttribution={...bundle,envelopes:[bundle.envelopes[0],test.seal('outcomes',outcomes,{attribution:'guessed'})]};
assert.throws(()=>measureSignedGpd33AcquisitionFunnel(heuristicAttribution,test.trust),/Invalid signed acquisition cohort/);
assert.throws(()=>measureSignedGpd33AcquisitionFunnel(bundle,live.trust),/Pinned acquisition evidence policy/);
const reused=structuredClone(test.trust);
reused.issuers.outcomes.public_key=reused.issuers.journeys.public_key;
assert.throws(()=>measureSignedGpd33AcquisitionFunnel(bundle,reused),/different pinned keys/);
const partial=test.run([{channel:'mcp_registry',visits:100,activations:20,handoffs:null}],[],8);
assert.equal(partial.channels.find(row=>row.channel==='mcp_registry').handoffs,null);
assert.equal(partial.planning_only.allocations.find(row=>row.channel==='mcp_registry').basis,'limited_or_missing_sample');
assert.throws(()=>test.run([{channel:'mcp_registry',visits:100,activations:null,handoffs:1}],[],5),/journey counts/);
assert.throws(()=>test.run([{...visits[0],activations:0,handoffs:0}],[{...outcomes[0],verified_orders:null,
  brokerage_usdc_atomic:null}],5),/outcome counts/);
assert.throws(()=>measureSignedGpd33AcquisitionFunnel(bundle,test.trust,{expectedCohortId:'wrong'}),/Requested acquisition cohort/);
const liveBundle=live.bundle(visits,outcomes);
const fresh=measureSignedGpd33AcquisitionFunnel(liveBundle,live.trust,{budget:4,now:()=>window_end*1000,expectedCohortId:cohort_id});
assert.equal(fresh.planning_only.status,'preview');
assert.equal(fresh.planning_only.allocations.length,3);
for(const now of [()=> (window_end-301)*1000,()=> (window_end+7*86400+1)*1000]){
  const outside=measureSignedGpd33AcquisitionFunnel(liveBundle,live.trust,{budget:4,now});
  assert.equal(outside.planning_only.status,'outside_live_freshness_window');
  assert.equal(outside.planning_only.unallocated_units,4);
  assert.equal(outside.channels.find(row=>row.channel==='mcp_registry').verified_orders,5);
}
console.log('PASS signed verified acquisition funnel, separated revenue stages and bounded free-channel priorities');
