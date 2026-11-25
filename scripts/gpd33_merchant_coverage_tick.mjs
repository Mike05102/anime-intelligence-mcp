import {spawn} from 'node:child_process';
import {constants} from 'node:fs';
import {lstat,open,rename,unlink} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fetchApprovedMerchantOfferFeed} from './gpd33_merchant_feed_fetch.mjs';
import {validateMerchantFeedApproval} from './gpd33_merchant_offer_feed.mjs';

const MIN_INTERVAL_MS=60*60*1000;
const MAX_SOURCES=32;
const MAX_READS=4;
const SOURCE=/^[a-z][a-z0-9_-]{0,31}$/;
const STATE_SCHEMA='gpd-merchant-coverage-state-v1';

async function requirePrivate(descriptor){
  const st=await descriptor.stat();
  if(!st.isFile()||st.mode&0o077||st.uid!==process.getuid())throw new Error('private_coverage_file_required');
  return st;
}

async function readPrivateJson(path,maxBytes){
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const st=await requirePrivate(file);
    if(st.size<1||st.size>maxBytes)throw new Error('invalid_coverage_file_size');
    const buffer=Buffer.alloc(st.size+1);
    let used=0;
    while(used<buffer.length){
      const {bytesRead}=await file.read(buffer,used,buffer.length-used,used);
      if(!bytesRead)break;
      used+=bytesRead;
    }
    if(used!==st.size)throw new Error('coverage_file_changed');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,used)));
  }finally{
    await file.close();
  }
}

function lockTick(file){
  return new Promise((resolve,reject)=>{
    const child=spawn('flock',['-n','-E','75','3'],{stdio:['ignore','ignore','ignore',file.fd]});
    child.once('error',reject);
    child.once('exit',code=>{
      if(code===0||code===75)resolve(code===0);
      else reject(new Error('coverage_lock_unavailable'));
    });
  });
}

async function persist(directory,path,state){
  const temp=join(directory,'.merchant-coverage.tmp');
  await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});
  const file=await open(temp,'wx',0o600);
  try{
    try{
      await file.writeFile(JSON.stringify(state)+'\n');
      await file.sync();
    }finally{
      await file.close();
    }
    await rename(temp,path);
    const parent=await open(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    try{await parent.sync();}
    finally{await parent.close();}
  }catch(error){
    await unlink(temp).catch(ignored=>{if(ignored.code!=='ENOENT')throw ignored;});
    throw error;
  }
}

function approvedSources(registry){
  const sources=registry?.sources;
  if(registry?.schema!=='gpd-merchant-coverage-registry-v1'||!Array.isArray(sources)||!sources.length||sources.length>MAX_SOURCES
    ||!Number.isSafeInteger(registry.max_feeds_per_tick)||registry.max_feeds_per_tick<1||registry.max_feeds_per_tick>MAX_READS){
    throw new Error('invalid_coverage_registry');
  }
  const labels=new Set();
  const filenames=new Set();
  for(const row of sources){
    if(typeof row?.source!=='string'||!SOURCE.test(row.source)||labels.has(row.source)
      ||typeof row.approval_file!=='string'||!/^[a-z0-9][a-z0-9_-]{0,62}\.json$/i.test(row.approval_file)
      ||filenames.has(row.approval_file))throw new Error('invalid_approved_coverage_source');
    labels.add(row.source);
    filenames.add(row.approval_file);
  }
  return [...sources].sort((a,b)=>a.source<b.source?-1:1);
}

function coverageCounts(preview){
  const offers=preview?.upsert_payload?.offers;
  if(preview?.schema!=='gpd-merchant-offer-feed-preview-v1'||preview.status!=='operator_review_required'
    ||!Array.isArray(offers)||offers.length<1||offers.length>200)throw new Error('invalid_coverage_preview');
  let withGtin=0;
  let stockUnknown=0;
  let claimedEligible=0;
  const destinations=new Set();
  const currencies=new Set();
  for(const offer of offers){
    if(offer.gtin)withGtin++;
    if(offer.stock_quantity==null)stockUnknown++;
    if(!offer.gtin||!['in_stock','low_stock'].includes(offer.stock_status)||offer.stock_quantity===0||!offer.ships_to.length)continue;
    claimedEligible++;
    currencies.add(offer.currency);
    for(const country of offer.ships_to)destinations.add(country);
  }
  return {offers:offers.length,offers_with_structured_gtin:withGtin,quantity_unknown:stockUnknown,
    claimed_in_stock_gtin_with_destinations:claimedEligible,claimed_destination_count:destinations.size,
    claimed_offer_currency_count:currencies.size,feed_observed_at:offers[0].source_updated_at};
}

export async function runMerchantCoverageTick(registryFile,directory,{now=Date.now(),fetchFeed=fetchApprovedMerchantOfferFeed}={}){
  if(!Number.isSafeInteger(now)||now<=0)throw new Error('invalid_coverage_clock');
  const st=await lstat(directory);
  if(!st.isDirectory()||st.mode&0o077||st.uid!==process.getuid())throw new Error('private_coverage_directory_required');
  const lock=await open(join(directory,'.merchant-coverage.lock'),
    constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);
  try{
    await requirePrivate(lock);
    if(!await lockTick(lock))return {status:'coverage_in_progress'};
    const registry=await readPrivateJson(registryFile,64*1024);
    const sources=approvedSources(registry);
    const statePath=join(directory,'merchant-coverage.json');
    const state=await readPrivateJson(statePath,256*1024).catch(error=>{
      if(error.code==='ENOENT')return {schema:STATE_SCHEMA,last_tick_ms:0,last_source:null,results:[]};
      throw error;
    });
    if(state?.schema!==STATE_SCHEMA||!Number.isSafeInteger(state.last_tick_ms)||state.last_tick_ms<0
      ||(state.last_source!==null&&!SOURCE.test(state.last_source))
      ||!Array.isArray(state.results)||state.results.length>MAX_SOURCES
      ||state.results.some(row=>typeof row?.source!=='string'||!SOURCE.test(row.source)))throw new Error('invalid_coverage_state');
    if(state.last_tick_ms&&now-state.last_tick_ms<MIN_INTERVAL_MS)return {status:'coverage_not_due'};
    const next=sources.findIndex(row=>state.last_source===null||row.source>state.last_source);
    const start=next<0?0:next;
    const selected=[...sources.slice(start),...sources.slice(0,start)].slice(0,registry.max_feeds_per_tick);
    const configured=new Set(sources.map(row=>row.source));
    const results=new Map(state.results.filter(row=>configured.has(row.source)).map(row=>[row.source,row]));
    const attemptedAt=new Date(now).toISOString();
    for(const row of selected)results.set(row.source,{source:row.source,status:'attempting',attempted_at:attemptedAt});
    const buildState=()=>({schema:STATE_SCHEMA,scope:'approved_merchant_preview_claims',
      last_tick_ms:now,last_source:selected.at(-1).source,results:[...results.values()]});

    // Claim the reads before any egress, so a crash or immediate retry cannot exceed the hourly budget.
    await persist(directory,statePath,buildState());
    let observed=0;
    for(const row of selected){
      const base={source:row.source,attempted_at:attemptedAt};
      let approval;
      try{
        approval=await readPrivateJson(join(dirname(registryFile),row.approval_file),64*1024);
        validateMerchantFeedApproval(approval,now);
      }catch{
        results.set(row.source,{...base,status:'approval_unavailable'});
        continue;
      }
      try{
        const evidence=coverageCounts(await fetchFeed(approval,{now}));
        observed++;
        results.set(row.source,{...base,status:'observed',evidence});
      }catch{
        results.set(row.source,{...base,status:'feed_unavailable'});
      }
    }
    await persist(directory,statePath,buildState());
    return {status:'coverage_checked',configured:sources.length,attempted:selected.length,observed,unavailable:selected.length-observed};
  }finally{
    await lock.close();
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.length!==4)throw new Error('Expected private registry and state directory');
    const result=await runMerchantCoverageTick(process.argv[2],process.argv[3]);
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch{
    process.stderr.write('Merchant coverage tick failed. Check the private registry, approvals, state directory and availability of flock.\n');
    process.exitCode=1;
  }
}
