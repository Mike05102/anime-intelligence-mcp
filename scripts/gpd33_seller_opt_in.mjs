import {createPublicKey,randomUUID,verify} from 'node:crypto';
import {link,lstat,unlink,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readBoundedJson} from './gpd33_reconcile_acquire.mjs';
import {collectSellerCandidates} from './gpd33_seller_discovery.mjs';

const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SOURCE=/^(?:merchant_feed|partner_directory):[a-z0-9][a-z0-9_.-]{0,95}$/i;
const ENCODING=/^[A-Za-z0-9_-]+$/;
const MAX_INPUT_BYTES=256*1024;
const DAY=86400000;
const MAX_SIGNATURE_AGE=30*DAY;
const PREVIEW_SCOPE='preview_onboarding';
const FEED_SCOPE='review_feed_connection';
const utf8=new TextDecoder('utf-8',{fatal:true});

function httpsUrl(input){
  if(typeof input!=='string'||input.length>500)return null;
  try{
    const url=new URL(input);
    if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash
      ||!/^([a-z\d-]+\.)+[a-z]{2,}$/i.test(url.hostname)
      ||/\.(?:test|local|internal|localhost|invalid|onion)$/i.test(url.hostname))return null;
    return url;
  }catch{return null;}
}

function originsFor(values){
  if(!Array.isArray(values)||values.length===0||values.length>10)throw new Error('seller_opt_in_trust_invalid');
  const origins=values.map(value=>{
    const url=httpsUrl(value);
    if(!url||url.pathname!=='/')throw new Error('seller_opt_in_trust_invalid');
    return url.origin;
  });
  if(new Set(origins).size!==origins.length)throw new Error('seller_opt_in_trust_invalid');
  return origins;
}

function scopedAuthorities(trust){
  if(trust?.schema!=='gpd-seller-opt-in-trust-v1'||!['test','live'].includes(trust.environment)
    ||!trust.sellers||typeof trust.sellers!=='object'||Array.isArray(trust.sellers)){
    throw new Error('seller_opt_in_trust_invalid');
  }
  const entries=Object.entries(trust.sellers);
  if(entries.length>200)throw new Error('seller_opt_in_trust_invalid');
  const sources=new Set(),publicKeys=new Set(),merchants=new Set(),authorities=new Map();
  for(const [seller,entry] of entries){
    const website=httpsUrl(entry?.website_url),sourceIds=entry?.source_ids;
    const key=entry?.public_key,merchant=entry?.merchant_id??null;
    const name=typeof entry?.name==='string'?entry.name.trim():null;
    if(!UUID.test(seller)||typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key)||publicKeys.has(key)
      ||(merchant!==null&&(typeof merchant!=='string'||!UUID.test(merchant)||merchants.has(merchant)))
      ||!name||name.length<2||name.length>120||/[\u0000-\u001f\u007f]/.test(name)
      ||typeof entry.country_code!=='string'||!/^[A-Z]{2}$/.test(entry.country_code)||!website
      ||!Array.isArray(sourceIds)||!sourceIds.length||sourceIds.length>10){
      throw new Error('seller_opt_in_trust_invalid');
    }
    for(const identity of sourceIds){
      if(typeof identity!=='string'||!SOURCE.test(identity)||sources.has(identity))throw new Error('seller_opt_in_trust_invalid');
      sources.add(identity);
    }
    const feed=entry.feed??null;
    const feedUrl=feed===null?null:httpsUrl(feed.url);
    if(feed!==null&&(!merchant||!feedUrl))throw new Error('seller_opt_in_trust_invalid');
    const publicKey=createPublicKey({format:'jwk',key:{
      kty:'OKP',crv:'Ed25519',x:Buffer.from(key,'hex').toString('base64url')
    }});
    publicKeys.add(key);
    if(merchant)merchants.add(merchant);
    authorities.set(seller,{merchant,publicKey,scope:merchant?FEED_SCOPE:PREVIEW_SCOPE,sourceIds:new Set(sourceIds),
      name,country:entry.country_code,website:website.href,optInOrigins:new Set(originsFor(entry.opt_in_origins)),
      feed:feedUrl?{url:feedUrl.href,productOrigins:originsFor(feed.product_origins)}:null});
  }
  return authorities;
}

function bytes(value,maxBytes){
  if(typeof value!=='string'||value.length>Math.ceil(maxBytes*4/3)||!ENCODING.test(value))return null;
  const decoded=Buffer.from(value,'base64url');
  return decoded.length<=maxBytes&&decoded.toString('base64url')===value?decoded:null;
}

function utcDate(value){
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)?Date.parse(value):NaN;
}

function interpretConsent(envelope,authority,candidates,environment,now){
  const payload=bytes(envelope.payload,4096),signature=bytes(envelope.signature,64);
  if(!payload||signature?.length!==64||!verify(null,payload,authority.publicKey,signature))return null;
  let body;
  try{body=JSON.parse(utf8.decode(payload));}catch{return null;}
  if(!body||typeof body!=='object'||Array.isArray(body)||body.context!=='gpd-seller-opt-in-v1'
    ||body.environment!==environment||body.seller_id!==envelope.seller_id||body.scope!==authority.scope
    ||typeof body.request_id!=='string'||!UUID.test(body.request_id)||body.country_code!==authority.country
    ||typeof body.source!=='string'||typeof body.source_seller_id!=='string'){
    return null;
  }

  const source=`${body.source}:${body.source_seller_id}`;
  const discovery=candidates.get(source),evidence=httpsUrl(body.evidence_url);
  if(!authority.sourceIds.has(source)||discovery?.review_status!=='review_opt_in_evidence'
    ||discovery.merchant_country!==authority.country||!evidence||!authority.optInOrigins.has(evidence.origin)
    ||discovery.opt_in_evidence_url!==evidence.href)return null;

  const signedAt=utcDate(body.signed_at),expires=utcDate(body.expires_at);
  if(!Number.isFinite(signedAt)||!Number.isFinite(expires)||signedAt<now-MAX_SIGNATURE_AGE
    ||signedAt>now+300000||signedAt>Date.parse(discovery.opt_in_observed_at)+300000
    ||expires<=Math.max(signedAt,now)||expires>signedAt+MAX_SIGNATURE_AGE)return null;

  if(authority.scope===FEED_SCOPE?(!authority.feed||httpsUrl(body.feed_url)?.href!==authority.feed.url):body.feed_url!=null){
    return null;
  }
  return {payload:envelope.payload,signedAt,expires,requestId:body.request_id,
    draft:{seller_id:envelope.seller_id,merchant_id:authority.merchant,status:'operator_review_required',
      scope:authority.scope,consent_expires_at:new Date(expires).toISOString(),
      ...(authority.scope===PREVIEW_SCOPE
        ?{registration_draft:{name:authority.name,website_url:authority.website,country_code:authority.country}}
        :{feed_connection_draft:{merchant_id:authority.merchant,feed_url:authority.feed.url,
          product_origins:authority.feed.productOrigins}})}};
}

export function prepareSellerOptInReview(discoveryReport,registry,envelopes,now=Date.now()){
  const authorities=scopedAuthorities(registry);
  if(discoveryReport?.schema==='gpd-seller-discovery-tick-v1'){
    if(discoveryReport.environment!==registry.environment)throw new Error('seller_opt_in_environment_mismatch');
    discoveryReport=discoveryReport.discovery;
  }
  if(discoveryReport?.schema!=='gpd-seller-discovery-evidence-v1'||!Number.isFinite(now)
    ||!Array.isArray(envelopes)||envelopes.length>200)throw new Error('seller_opt_in_input_invalid');
  const candidates=new Map(collectSellerCandidates(discoveryReport.candidates,now).candidates
    .map(candidate=>[`${candidate.source}:${candidate.source_seller_id}`,candidate]));
  const plans=new Map(),requests=new Map(),conflicts=new Set();
  let rejected=0,duplicates=0;
  for(const envelope of envelopes){
    const seller=envelope?.seller_id,authority=authorities.get(seller);
    const consent=authority?interpretConsent(envelope,authority,candidates,registry.environment,now):null;
    if(!consent){rejected++;continue;}
    const requestKey=`${seller}:${consent.requestId}`;
    if(requests.has(requestKey)){
      duplicates++;
      if(requests.get(requestKey)!==consent.payload)conflicts.add(seller);
      continue;
    }
    requests.set(requestKey,consent.payload);
    const previous=plans.get(seller);
    if(previous)duplicates++;
    if(!previous||consent.signedAt>previous.signedAt||
      (consent.signedAt===previous.signedAt&&consent.requestId<previous.requestId)){
      plans.set(seller,consent);
    }
  }
  const candidatesForReview=[...plans].filter(([seller])=>!conflicts.has(seller))
    .sort(([left],[right])=>left.localeCompare(right)).map(([,consent])=>consent.draft);
  return {schema:'gpd-seller-opt-in-review-v1',environment:registry.environment,status:'private_preview',
    input_count:envelopes.length,rejected_count:rejected,duplicate_count:duplicates,
    conflicting_sellers:conflicts.size,candidates:candidatesForReview};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.length!==6)throw new Error('Expected discovery, trust, consents, and new private output path');
    const output=process.argv[5],directory=dirname(output);
    const parent=await lstat(directory);
    if(!parent.isDirectory()||parent.uid!==process.getuid()||(parent.mode&0o077)!==0){
      throw new Error('Expected an owner-only private output directory');
    }
    const [discovery,registry,envelopes]=(await Promise.all(process.argv.slice(2,5)
      .map(path=>readBoundedJson(path,MAX_INPUT_BYTES,{privateFile:true})))).map(input=>input.data);
    const preview=prepareSellerOptInReview(discovery,registry,envelopes);
    const temporary=join(directory,'.gpd-seller-opt-in-'+randomUUID()+'.tmp');
    try{
      await writeFile(temporary,JSON.stringify(preview,null,2)+'\n',{flag:'wx',mode:0o600});
      await link(temporary,output);
    }finally{
      await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
    }
  }catch{
    process.stderr.write('Seller opt-in review failed. Check the private inputs and output path.\n');
    process.exitCode=2;
  }
}
