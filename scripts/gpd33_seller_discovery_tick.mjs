import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {collectSellerCandidates} from './gpd33_seller_discovery.mjs';
import {readBoundedJson} from './gpd33_reconcile_acquire.mjs';
import {requestPinnedHttps,resolvePinnedPublicIpv4} from './gpd33_merchant_feed_fetch.mjs';

const HOUR=3600000;
const RESPONSE_BYTES=64*1024;
const MAX_SOURCES=24;
const SOURCE=/^[a-z][a-z0-9_-]{0,23}$/;
const EXTERNAL_SELLER=/^[a-z0-9][a-z0-9_.-]{0,63}$/i;
const COUNTRY=/^[A-Z]{2}$/;
const KINDS=new Set(['merchant_feed','partner_directory','ebay_browse','yahoo_shopping','nhtsa_vpic']);
const OPT_IN_KINDS=new Set(['merchant_feed','partner_directory']);
const DOMAINS=new Set([
  'consumer_electronics','automotive_parts','home_appliances','fashion','books_media','toys_hobbies',
  'beauty_personal_care','sports_outdoors','home_living','office_business','medical_supplies','food_grocery',
  'baby_kids','pet_supplies','tools_hardware','garden_outdoor','musical_instruments','jewelry_watches',
  'arts_crafts','industrial_supplies','scientific_lab','restaurant_hospitality','safety_security','general_commerce'
]);
const VPIC_ORIGIN='https://vpic.nhtsa.dot.gov';
const STATE='gpd-seller-discovery-state-v1';

function publicHttps(input,stripTracking=false){
  if(typeof input!=='string'||input.length>512)return null;
  try{
    const url=new URL(input);
    if(url.protocol!=='https:'||url.username||url.password||url.port
      ||!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(url.hostname)
      ||/\.(?:local|internal|localhost|test|invalid|onion)$/i.test(url.hostname)
      ||(!stripTracking&&(url.search||url.hash)))return null;
    url.search='';
    url.hash='';
    return url;
  }catch{return null;}
}
function utc(value){
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)?Date.parse(value):NaN;
}
function originSet(values){
  if(!Array.isArray(values)||values.length>12)throw new Error('invalid_discovery_origins');
  return new Set(values.map(value=>{
    const url=publicHttps(value);
    if(!url||url.pathname!=='/')throw new Error('invalid_discovery_origins');
    return url.origin;
  }));
}

function approvedSources(registry,now){
  if(registry?.schema!=='gpd-seller-discovery-registry-v1'||!['test','live'].includes(registry.environment)
    ||!Number.isInteger(registry.max_reads)||registry.max_reads<1||registry.max_reads>2
    ||!Array.isArray(registry.sources)||registry.sources.length>MAX_SOURCES){
    throw new Error('invalid_seller_discovery_registry');
  }
  const labels=new Set(),urls=new Set();
  return registry.sources.map(row=>{
    const vpic=row?.kind==='nhtsa_vpic';
    const url=publicHttps(row?.endpoint,vpic),terms=publicHttps(row?.terms_url),expiry=utc(row?.approved_until);
    if(vpic){
      const endpoint=typeof row.endpoint==='string'&&row.endpoint.match(/^https:\/\/vpic\.nhtsa\.dot\.gov\/api\/vehicles\/GetAllManufacturers\?format=json&page=([1-9][0-9]{0,2})$/);
      if(!endpoint||!url||row.domains?.length!==1||row.domains[0]!=='automotive_parts')throw new Error('invalid_vpic_scope');
      url.search='?format=json&page='+endpoint[1];
    }
    if(typeof row?.id!=='string'||!SOURCE.test(row.id)||labels.has(row.id)
      ||!KINDS.has(row.kind)||!url||urls.has(url.href)||!terms||!Number.isFinite(expiry)
      ||row.approved_for!=='public_seller_discovery'||row.no_cost_public_read!==true
      ||!Array.isArray(row.domains)||!row.domains.length||row.domains.length>DOMAINS.size
      ||row.domains.some(domain=>!DOMAINS.has(domain))
      ||!Array.isArray(row.buyer_countries)||row.buyer_countries.length>50
      ||row.buyer_countries.some(country=>typeof country!=='string'||!COUNTRY.test(country))){
      throw new Error('invalid_approved_seller_discovery_source');
    }
    labels.add(row.id);
    urls.add(url.href);
    const evidence=originSet(row.evidence_origins),consent=originSet(row.consent_origins??[]);
    if(!evidence.size||(!OPT_IN_KINDS.has(row.kind)&&consent.size))throw new Error('invalid_discovery_origins');
    return {id:row.id,kind:row.kind,url,expiry,domains:new Set(row.domains),
      countries:new Set(row.buyer_countries),evidence,consent};
  }).filter(row=>row.expiry>now);
}

function demandRows(report,environment,now){
  const observedAt=utc(report?.observed_at);
  if(report?.schema!=='gpd-seller-discovery-demand-v1'||report.environment!==environment||!Number.isFinite(observedAt)||observedAt>now+300000
    ||!Array.isArray(report.rows)||report.rows.length>120){
    throw new Error('invalid_seller_discovery_demand');
  }
  const seen=new Set();
  for(const row of report.rows){
    if(!DOMAINS.has(row?.domain)||typeof row.buyer_country!=='string'||!COUNTRY.test(row.buyer_country)
      ||!Number.isSafeInteger(row.request_count)||row.request_count<0||row.request_count>1000){
      throw new Error('invalid_seller_discovery_demand');
    }
    const key=row.domain+':'+row.buyer_country;
    if(seen.has(key))throw new Error('duplicate_seller_discovery_demand');
    seen.add(key);
  }
  return observedAt<now-7*24*HOUR?[]:report.rows;
}

function readState(input,environment){
  if(!input)return {schema:STATE,environment,last_tick_ms:0,ticks:0,sources:{}};
  if(input.schema!==STATE||input.environment!==environment||!Number.isSafeInteger(input.last_tick_ms)
    ||input.last_tick_ms<0||!Number.isSafeInteger(input.ticks)||input.ticks<0
    ||!input.sources||typeof input.sources!=='object'||Array.isArray(input.sources)){
    throw new Error('invalid_seller_discovery_state');
  }
  const entries=Object.entries(input.sources);
  if(entries.length>MAX_SOURCES||entries.some(([id,row])=>!SOURCE.test(id)
    ||!Number.isSafeInteger(row?.last_attempt_ms)||row.last_attempt_ms<0
    ||!Number.isSafeInteger(row?.cooldown_until_ms)||row.cooldown_until_ms<0)){
    throw new Error('invalid_seller_discovery_state');
  }
  return input;
}

function selectSources(sources,demand,state,limit,now){
  const eligible=sources.filter(row=>(state.sources[row.id]?.cooldown_until_ms??0)<=now);
  const old=(a,b)=>(state.sources[a.id]?.last_attempt_ms??0)-(state.sources[b.id]?.last_attempt_ms??0)
    ||a.id.localeCompare(b.id);
  const next=[...eligible].sort(old)[0];
  const ranked=eligible.map(row=>({...row,demand:demand.filter(need=>row.domains.has(need.domain)
    &&(!row.countries.size||row.countries.has(need.buyer_country)))
    .reduce((sum,need)=>sum+need.request_count,0)}))
    .sort((a,b)=>b.demand-a.demand||old(a,b));
  if(!next)return [];
  if(limit===1)return [state.ticks%2===0?ranked[0]:next];
  return [ranked[0],...[...eligible].filter(row=>row.id!==ranked[0].id).sort(old).slice(0,limit-1)];
}

function rateLimitCooldown(now,retryAfter){
  if(typeof retryAfter!=='string')return now+6*HOUR;
  if(/^\d{1,10}$/.test(retryAfter))return Math.max(now+6*HOUR,now+Number(retryAfter)*1000);
  const retryAt=/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(retryAfter)
    ?Date.parse(retryAfter):NaN;
  return Number.isFinite(retryAt)?Math.max(now+6*HOUR,retryAt):now+6*HOUR;
}

export async function readApprovedSellerDiscoverySource(source,{resolve,request=requestPinnedHttps}={}){
  const signal=AbortSignal.timeout(8000);
  const address=await resolvePinnedPublicIpv4(source.url.hostname,signal,resolve);
  const response=await request(source.url,{address,signal});
  try{
    if(response.statusCode===429){
      throw Object.assign(new Error('seller_source_rate_limited'),{retryAfter:response.headers['retry-after']});
    }
    if(response.statusCode!==200)throw new Error('seller_source_response_rejected');
    const contentType=response.headers['content-type'],encoding=response.headers['content-encoding'],length=response.headers['content-length'];
    if(typeof contentType!=='string'||!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(contentType)
      ||(encoding!==undefined&&encoding!=='identity')
      ||(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>RESPONSE_BYTES))){
      throw new Error('invalid_seller_discovery_response');
    }
    const chunks=[];
    let bytes=0;
    for await(const chunk of response){
      signal.throwIfAborted();
      bytes+=chunk.length;
      if(bytes>RESPONSE_BYTES)throw new Error('seller_discovery_response_too_large');
      chunks.push(chunk);
    }
    if(length!==undefined&&Number(length)!==bytes)throw new Error('seller_discovery_response_size_mismatch');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  }finally{
    response.destroy();
  }
}

function candidateRows(source,payload,now){
  if(source.kind==='nhtsa_vpic'){
    if(!Array.isArray(payload?.Results)||payload.Results.length>100||payload.Count!==payload.Results.length){
      throw new Error('invalid_vpic_response');
    }
    const observed_at=new Date(now).toISOString();
    const rows=payload.Results.filter(row=>Number.isSafeInteger(row?.Mfr_ID)&&row.Mfr_ID>0).map(row=>({
      source:source.kind,source_seller_id:'vpic.'+row.Mfr_ID,public_name:row.Mfr_Name,
      evidence_url:VPIC_ORIGIN+'/api/vehicles/GetManufacturerDetails/'+row.Mfr_ID,observed_at
    }));
    return {rows,excluded:payload.Results.length-rows.length};
  }

  if(payload?.schema!=='gpd-seller-discovery-feed-v1'||!Array.isArray(payload.sellers)||payload.sellers.length>100){
    throw new Error('invalid_seller_feed_payload');
  }
  const rows=[];
  for(const row of payload.sellers){
    const evidence=publicHttps(row?.evidence_url,true);
    if((row?.sponsored!==undefined&&row.sponsored!==false)
      ||typeof row?.source_seller_id!=='string'||!EXTERNAL_SELLER.test(row.source_seller_id)
      ||!evidence||!source.evidence.has(evidence.origin))continue;
    const consent=publicHttps(row.opt_in_evidence_url,true);
    const canReviewConsent=consent&&source.consent.has(consent.origin);
    rows.push({source:source.kind,source_seller_id:source.id+'.'+row.source_seller_id,
      public_name:row.public_name,merchant_country:row.merchant_country,evidence_url:evidence.href,
      observed_at:row.observed_at,...(canReviewConsent?{opt_in_evidence_url:consent.href,opt_in_observed_at:row.opt_in_observed_at}:{})});
  }
  return {rows,excluded:payload.sellers.length-rows.length};
}

async function lockFile(descriptor){
  return new Promise((resolve,reject)=>{
    const child=spawn('flock',['-n','-E','75','3'],{stdio:['ignore','ignore','ignore',descriptor.fd]});
    child.once('error',reject);
    child.once('exit',code=>{
      if(code===0||code===75)resolve(code===0);
      else reject(new Error('seller_discovery_lock_unavailable'));
    });
  });
}

async function savePrivate(directory,name,value){
  const temporary=join(directory,'.seller-discovery-'+randomUUID()+'.tmp');
  try{
    const handle=await open(temporary,'wx',0o600);
    try{
      await handle.writeFile(JSON.stringify(value)+'\n');
      await handle.sync();
    }finally{await handle.close();}
    await rename(temporary,join(directory,name));
    const parent=await open(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    try{await parent.sync();}finally{await parent.close();}
  }finally{
    await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}

export async function runSellerDiscoveryTick(registryFile,demandFile,directory,
  {now=Date.now(),readSource=readApprovedSellerDiscoverySource}={}){
  if(!Number.isSafeInteger(now)||now<=0)throw new Error('invalid_seller_discovery_clock');
  const owner=await lstat(directory);
  if(!owner.isDirectory()||owner.uid!==process.getuid()||(owner.mode&0o077)!==0)throw new Error('private_discovery_directory_required');
  const lock=await open(join(directory,'.seller-discovery.lock'),
    constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);
  try{
    const lockStat=await lock.stat();
    if(!lockStat.isFile()||lockStat.uid!==process.getuid()||(lockStat.mode&0o077)!==0){
      throw new Error('private_discovery_lock_required');
    }
    if(!await lockFile(lock))return {status:'discovery_in_progress'};
    const load=async path=>(await readBoundedJson(path,RESPONSE_BYTES,{privateFile:true})).data;
    const [registry,demand]=await Promise.all([load(registryFile),load(demandFile)]);
    const sources=approvedSources(registry,now),needs=demandRows(demand,registry.environment,now);
    if(registry.environment==='test'&&readSource===readApprovedSellerDiscoverySource)throw new Error('test_discovery_requires_fixture_reader');
    const state=readState(await load(join(directory,'seller-discovery-state.json')).catch(error=>{
      if(error.code==='ENOENT')return null;
      throw error;
    }),registry.environment);
    if(state.last_tick_ms&&now-state.last_tick_ms<HOUR)return {status:'discovery_not_due'};
    const selected=selectSources(sources,needs,state,registry.max_reads,now);
    if(!selected.length)return {status:'discovery_no_eligible_source'};

    const newState={schema:STATE,environment:registry.environment,last_tick_ms:now,ticks:state.ticks+1,
      sources:Object.fromEntries(sources.flatMap(row=>Object.hasOwn(state.sources,row.id)?[[row.id,state.sources[row.id]]]:[]))};
    for(const source of selected)newState.sources[source.id]={last_attempt_ms:now,cooldown_until_ms:now+2*HOUR};
    // Claim the budget durably before the first network request, even on a later crash.
    await savePrivate(directory,'seller-discovery-state.json',newState);
    const candidates=[],results=[];
    for(const source of selected){
      try{
        const {rows,excluded}=candidateRows(source,await readSource(source),now);
        candidates.push(...rows);
        results.push({source:source.id,status:'observed',scope_excluded:excluded});
        newState.sources[source.id].cooldown_until_ms=0;
      }catch(error){
        const limited=error?.message==='seller_source_rate_limited';
        results.push({source:source.id,status:limited?'rate_limited':'source_unavailable'});
        if(limited)newState.sources[source.id].cooldown_until_ms=rateLimitCooldown(now,error.retryAfter);
      }
    }
    await savePrivate(directory,'seller-discovery-state.json',newState);
    const discovery=collectSellerCandidates(candidates,now);
    await savePrivate(directory,'seller-discovery-report.json',{
      schema:'gpd-seller-discovery-tick-v1',environment:registry.environment,
      observed_at:new Date(now).toISOString(),results,discovery
    });
    return {status:'discovery_review_ready',sources_attempted:results.length,candidates:discovery.candidates.length};
  }finally{await lock.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.length!==5)throw new Error('Expected private registry, demand report, and state directory');
    const status=await runSellerDiscoveryTick(...process.argv.slice(2));
    process.stdout.write(JSON.stringify(status)+'\n');
  }catch{
    process.stderr.write('Seller discovery failed. Check the approved sources and private state.\n');
    process.exitCode=2;
  }
}
