import {pathToFileURL} from 'node:url';
import {readBoundedJson} from './gpd33_reconcile_acquire.mjs';
import {requestPinnedHttps,resolvePinnedPublicIpv4} from './gpd33_merchant_feed_fetch.mjs';

const DATASET='bghd-e2wd';
const SOURCE_URL='https://data.energystar.gov/Active-Specifications/ENERGY-STAR-Certified-Residential-Clothes-Washers/'+DATASET+'/data';
const RESOURCE='https://data.energystar.gov/resource/'+DATASET+'.json';
const MAX_BYTES=64*1024;
const PAGE_SIZE=40;
const MAX_OFFSET=4000;
const MAX_BATCH_PAGES=4;
const sourceFields=['pd_id','brand_name','model_number','upc','intended_market','markets','energy_star_model_identifier'];
const markets=new Map([['United States','US'],['Canada','CA']]);

function validUpc(value){
  if(typeof value!=='string'||!/^\d{12}$/.test(value)||/^(\d)\1+$/.test(value))return false;
  const digits=[...value].map(Number);
  const sum=digits.slice(0,-1).reduce((total,digit,i)=>total+digit*(i%2?1:3),0);
  return (10-sum%10)%10===digits[11];
}
function exactLabel(value,len){
  if(typeof value!=='string')return null;
  const label=value.normalize('NFKC').trim().replace(/\s+/g,' ');
  return label.length>0&&label.length<=len&&!/[\u0000-\u001f\u007f]/.test(label)?label:null;
}

function parseRecord(row){
  if(row?.intended_market!=='Residential')return {error:'not_residential'};
  const brand=exactLabel(row.brand_name,80),model=exactLabel(row.model_number,84);
  if(!brand||!/^\p{L}[\p{L}\p{N} ._&'-]*$/u.test(brand)||!model||
    !/^[A-Za-z\d][A-Za-z\d ._-]*$/.test(model)||!/\d/.test(model)||!/[A-Za-z]/.test(model)){
    return {error:'ambiguous_brand_or_model'};
  }
  if(row.upc===undefined||row.upc===null||row.upc==='')return {error:'missing_upc'};
  if(!validUpc(row.upc))return {error:'invalid_or_multiple_upc'};
  if(typeof row.pd_id!=='string'||!/^\d{1,18}$/.test(row.pd_id)
    ||typeof row.energy_star_model_identifier!=='string'||!/^ES_[A-Za-z\d._-]{1,160}$/.test(row.energy_star_model_identifier)){
    return {error:'missing_or_ambiguous_source_id'};
  }
  const scopes=typeof row.markets==='string'?row.markets.split(',').map(value=>value.trim()):[];
  if(!scopes.length||scopes.some(scope=>!markets.has(scope)))return {error:'unknown_market_scope'};
  return {domain:'home_appliances',product_kind:'residential_clothes_washer',brand,model,
    gtin:'00'+row.upc,source_upc:row.upc,source_record_id:row.pd_id,
    source_model_id:row.energy_star_model_identifier,registered_market_countries:[...new Set(scopes.map(scope=>markets.get(scope)))].sort()};
}

export function collectEnergyStarWasherEvidence(rows,now=Date.now()){
  if(!Array.isArray(rows)||rows.length>PAGE_SIZE||!Number.isSafeInteger(now)||now<0){
    throw new Error('invalid_energy_star_washer_page');
  }
  return collectRecords(rows,now);
}

function collectRecords(rows,now){
  const rejected={},byCode=new Map(),byModel=new Map(),byRecord=new Map(),conflicts=new Set();
  let duplicates=0;
  for(const row of rows){
    const item=parseRecord(row);
    if(item.error){rejected[item.error]=(rejected[item.error]||0)+1;continue;}
    const modelKey=item.brand.toUpperCase()+'|'+item.model.toUpperCase();
    const prior=byCode.get(item.gtin),priorModel=byModel.get(modelKey),priorRecord=byRecord.get(item.source_record_id);
    if(prior&&(prior.modelKey!==modelKey||
      prior.item.source_model_id!==item.source_model_id||
      prior.item.registered_market_countries.join(',')!==item.registered_market_countries.join(','))){
      conflicts.add(item.gtin);
    }
    if(priorModel&&priorModel!==item.gtin){conflicts.add(priorModel);conflicts.add(item.gtin);}
    if(priorRecord&&(priorRecord.gtin!==item.gtin||priorRecord.source_model_id!==item.source_model_id||
      priorRecord.registered_market_countries.join(',')!==item.registered_market_countries.join(','))){
      conflicts.add(priorRecord.gtin);conflicts.add(item.gtin);
    }
    byModel.set(modelKey,item.gtin);
    byRecord.set(item.source_record_id,item);
    // Do not attribute one record's market information to another record with the same GTIN.
    if(prior){duplicates++;continue;}
    byCode.set(item.gtin,{modelKey,item});
  }
  const products=[...byCode.entries()].filter(([gtin])=>!conflicts.has(gtin))
    .map(([,entry])=>entry.item).sort((a,b)=>a.gtin.localeCompare(b.gtin));
  return {schema:'gpd-energy-star-washer-evidence-v1',scope:'product_identity_only',source:'US EPA ENERGY STAR',
    source_dataset:DATASET,source_url:SOURCE_URL,evidence_origin:'local_sample',processed_at:new Date(now).toISOString(),
    rows_seen:rows.length,duplicate_rows:duplicates,conflicting_gtins:conflicts.size,rejected_rows:rejected,products};
}

async function fetchWasherPage(offset,{
  resolve,request=requestPinnedHttps
}={}){
  const url=new URL(RESOURCE);
  url.search=new URLSearchParams({'$select':sourceFields.join(','),'$order':'pd_id ASC',
    '$where':"intended_market = 'Residential'",'$limit':String(PAGE_SIZE),'$offset':String(offset)});
  const signal=AbortSignal.timeout(8000);
  const address=await resolvePinnedPublicIpv4(url.hostname,signal,resolve);
  const response=await request(url,{address,signal,headers:{
    accept:'application/json','accept-encoding':'identity','user-agent':'GPD-source-evidence/1'
  }});
  try{
    if(response.statusCode===429)throw new Error('energy_star_rate_limited');
    if(response.statusCode!==200)throw new Error('energy_star_response_rejected');
    const type=response.headers['content-type'],length=response.headers['content-length'],encoding=response.headers['content-encoding'];
    if(typeof type!=='string'||!/^application\/json(?:\s*;|$)/i.test(type)
      ||(encoding!==undefined&&encoding!=='identity')
      ||(length!==undefined&&(typeof length!=='string'||!/^\d+$/.test(length)||Number(length)>MAX_BYTES))){
      throw new Error('invalid_energy_star_response');
    }
    let bytes=0;
    const chunks=[];
    for await(const chunk of response){
      signal.throwIfAborted();
      bytes+=chunk.length;
      if(bytes>MAX_BYTES)throw new Error('energy_star_response_too_large');
      chunks.push(chunk);
    }
    if(length!==undefined&&Number(length)!==bytes)throw new Error('energy_star_content_length_mismatch');
    let rows;
    try{rows=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
    catch{throw new Error('invalid_energy_star_json');}
    if(!Array.isArray(rows)||rows.length>PAGE_SIZE)throw new Error('invalid_energy_star_washer_page');
    return rows;
  }finally{
    response.destroy();
  }
}

export async function fetchEnergyStarWasherBatch(offset=0,pageLimit=MAX_BATCH_PAGES,options={}){
  const now=options.now??Date.now();
  if(!Number.isInteger(offset)||offset<0||offset>MAX_OFFSET||offset%PAGE_SIZE!==0)throw new Error('invalid_energy_star_washer_offset');
  if(!Number.isSafeInteger(now)||now<0||!Number.isInteger(pageLimit)||pageLimit<1||pageLimit>MAX_BATCH_PAGES){
    throw new Error('invalid_energy_star_washer_batch');
  }
  const rows=[];
  let pages=0,next=offset;
  while(pages<pageLimit&&next!==null){
    const page=await fetchWasherPage(next,options);
    rows.push(...page);
    pages++;
    next=page.length===PAGE_SIZE&&next+PAGE_SIZE<=MAX_OFFSET?next+PAGE_SIZE:null;
  }
  const evidence=collectRecords(rows,now);
  return {...evidence,evidence_origin:'pinned_public_https',observed_at:evidence.processed_at,
    offset,next_offset:next,pages_read:pages};
}

export async function fetchEnergyStarWasherEvidence(offset=0,options={}){
  const {pages_read,...evidence}=await fetchEnergyStarWasherBatch(offset,1,options);
  return evidence;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.length!==4)throw new Error('Expected --local <sample.json>, --local-batch <sample.json>, --read <offset>, or --batch <offset>');
    const [action,value]=process.argv.slice(2);
    let evidence;
    if(action==='--local')evidence=collectEnergyStarWasherEvidence((await readBoundedJson(value,MAX_BYTES)).data);
    else if(action==='--local-batch'){
      const {data}=await readBoundedJson(value,MAX_BATCH_PAGES*MAX_BYTES);
      if(!Array.isArray(data)||data.length>MAX_BATCH_PAGES*PAGE_SIZE)throw new Error('invalid_energy_star_washer_batch');
      evidence=collectRecords(data,Date.now());
    }
    else if(action==='--read'&&/^\d{1,4}$/.test(value))evidence=await fetchEnergyStarWasherEvidence(Number(value));
    else if(action==='--batch'&&/^\d{1,4}$/.test(value))evidence=await fetchEnergyStarWasherBatch(Number(value));
    else throw new Error('Invalid read mode');
    process.stdout.write(JSON.stringify(evidence,null,2)+'\n');
  }catch{
    process.stderr.write('ENERGY STAR evidence read failed. Check the local sample, limits or official source response.\n');
    process.exitCode=2;
  }
}
