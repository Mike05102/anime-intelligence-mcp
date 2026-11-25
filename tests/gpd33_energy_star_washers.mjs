import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {collectEnergyStarWasherEvidence,fetchEnergyStarWasherEvidence} from '../scripts/gpd33_energy_star_washers.mjs';

const now=Date.parse('2026-11-25T12:00:00Z');
const exact={pd_id:'2545602',brand_name:'AEG',model_number:'W14120',upc:'051497390297',
  intended_market:'Residential',markets:'Canada',energy_star_model_identifier:'ES_1149287_W14120_06222023145097_1536512',
  price:'10',retailer:'not evidence',delivery_country:'US'};
const sourceRows=[
  exact,{...exact,pd_id:'3705407',model_number:'WHP120',upc:undefined},
  {...exact,pd_id:'2331773',model_number:'NFW5800H**',upc:'883049453552'},
  {...exact,pd_id:'2309900',model_number:'W2084.W.U',upc:'578206'},
  {...exact,pd_id:'4510830',model_number:'W3LW.U',upc:'746408'},
  {...exact,upc:'051497390296'}, {...exact,upc:'051497390297, 012345678905'},
  {...exact,upc:'000000000000'}, {...exact,upc:51497390297},
  {...exact,model_number:'W14120/W14121'}, {...exact,energy_star_model_identifier:''},
  {...exact,intended_market:'Commercial'}, {...exact,markets:'Global'},
];
const parsed=collectEnergyStarWasherEvidence(sourceRows,now);
assert.equal(parsed.rows_seen,sourceRows.length);
assert.equal(parsed.evidence_origin,'local_sample');
assert.equal(parsed.observed_at,undefined);
assert.equal(parsed.processed_at,new Date(now).toISOString());
assert.equal(parsed.scope,'product_identity_only');
assert.deepEqual(parsed.rejected_rows,{missing_upc:1,ambiguous_brand_or_model:2,invalid_or_multiple_upc:6,
  missing_or_ambiguous_source_id:1,not_residential:1,unknown_market_scope:1});
assert.deepEqual(parsed.products,[{
  domain:'home_appliances',product_kind:'residential_clothes_washer',brand:'AEG',model:'W14120',
  gtin:'00051497390297',source_upc:'051497390297',source_record_id:'2545602',
  source_model_id:exact.energy_star_model_identifier,registered_market_countries:['CA']
}]);

const alternate={...exact,pd_id:'999999',markets:'United States, Canada'};
const duplicate=collectEnergyStarWasherEvidence([exact,alternate],now);
assert.equal(duplicate.duplicate_rows,1);
assert.deepEqual(duplicate.products,[]);
assert.equal(duplicate.conflicting_gtins,1);
assert.deepEqual(collectEnergyStarWasherEvidence([alternate,exact],now).products,[]);
assert.deepEqual(collectEnergyStarWasherEvidence([exact,exact],now).products,parsed.products);
assert.deepEqual(collectEnergyStarWasherEvidence([
  exact,{...exact,pd_id:'999998',energy_star_model_identifier:'ES_other'}
],now).products,[]);
const wide=collectEnergyStarWasherEvidence([alternate],now);
assert.deepEqual(wide.products[0].registered_market_countries,['CA','US']);
for(const [other,count] of [
  [{...alternate,brand_name:'Other',model_number:'A1200'},1],
  [{...alternate,upc:'012345678905'},2],
  [{...exact,model_number:'Z1400',upc:'012345678905'},2],
  [{...exact,markets:'United States'},1]
]){
  const conflicted=collectEnergyStarWasherEvidence([exact,other],now);
  assert.equal(conflicted.conflicting_gtins,count);
  assert.deepEqual(conflicted.products,[]);
}
assert.throws(()=>collectEnergyStarWasherEvidence(Array(41).fill(exact),now),/invalid_energy_star_washer_page/);

const reply=(value,status=200,headers={'content-type':'application/json; charset=utf-8'})=>{
  const stream=Readable.from([Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value))]);
  stream.statusCode=status;
  stream.headers=headers;
  return stream;
};
let calls=0;
const pull=(offset,stream,resolve=async hostname=>{
  assert.equal(hostname,'data.energystar.gov');
  return ['8.8.8.8'];
})=>fetchEnergyStarWasherEvidence(offset,{now,resolve,request:async(url,{address,headers,signal})=>{
  calls++;
  assert.equal(url.origin,'https://data.energystar.gov');
  assert.equal(url.pathname,'/resource/bghd-e2wd.json');
  assert.equal(url.searchParams.get('$limit'),'40');
  assert.equal(url.searchParams.get('$offset'),String(offset));
  assert.equal(url.searchParams.get('$where'),"intended_market = 'Residential'");
  assert.ok(url.searchParams.get('$select').includes('upc'));
  assert.equal(url.searchParams.get('$order'),'pd_id ASC');
  assert.equal(address,'8.8.8.8');
  assert.equal(headers['accept-encoding'],'identity');
  assert.equal(signal.aborted,false);
  return stream;
}});
const fetched=await pull(40,reply(Array(40).fill(exact)));
assert.equal(fetched.evidence_origin,'pinned_public_https');
assert.equal(fetched.observed_at,parsed.processed_at);
assert.equal(fetched.offset,40);
assert.equal(fetched.next_offset,80);
assert.equal((await pull(4000,reply(Array(40).fill(exact)))).next_offset,null);
assert.equal((await pull(0,reply([exact]))).next_offset,null);
await assert.rejects(pull(0,reply({},429)),/energy_star_rate_limited/);
await assert.rejects(pull(0,reply({},302)),/energy_star_response_rejected/);
await assert.rejects(pull(0,reply({},200,{'content-type':'text/html'})),/invalid_energy_star_response/);
await assert.rejects(pull(0,reply(Buffer.alloc(64*1024+1))),/energy_star_response_too_large/);
await assert.rejects(pull(0,reply(Buffer.from([0xff]))),/invalid_energy_star_json/);
await assert.rejects(pull(0,reply({},200,{'content-type':'application/json','content-length':'6'})),/content_length_mismatch/);
await assert.rejects(pull(1,reply([])),/invalid_energy_star_washer_offset/);
await assert.rejects(pull(4040,reply([])),/invalid_energy_star_washer_offset/);
await assert.rejects(pull(0,reply([]),async()=>['8.8.8.8','127.0.0.1']),/requires_public_ipv4/);
assert.equal(calls,9);
console.log('PASS EPA residential washers exact UPC/model evidence, conflict quarantine, and bounded pinned HTTP');
