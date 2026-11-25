import {open} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const MAX_BYTES = 256 * 1024;
const MAX_ROWS = 500;
const FEEDS = new Set(['merchant_feed','partner_directory','ebay_browse','yahoo_shopping']);
const OPT_IN_FEEDS = new Set(['merchant_feed','partner_directory']);
const DAY = 86400000;

function publicHttpsUrl(input){
  if(typeof input!=='string'||input.length>500)return null;
  try{
    const url=new URL(input);
    const labels=url.hostname.split('.');
    if(url.protocol!=='https:'||url.username||url.password||url.port||labels.length<2
      ||!/^[a-z]{2,}$/i.test(labels.at(-1))
      ||labels.some(label=>!/^([a-z0-9]|[a-z0-9][a-z0-9-]{0,61}[a-z0-9])$/i.test(label))
      ||['local','internal','localhost','test','invalid','onion'].includes(labels.at(-1)))return null;
    url.search='';
    url.hash='';
    return url.href;
  }catch{
    return null;
  }
}

export function collectSellerCandidates(rows, now=Date.now()){
  if(!Array.isArray(rows)||rows.length>MAX_ROWS)throw new Error('Expected at most 500 source records');
  const candidates=new Map();
  let rejected=0;
  let duplicates=0;
  for(const row of rows){
    const source=row?.source;
    const sellerId=row?.source_seller_id;
    const name=typeof row?.public_name==='string'?row.public_name.trim():null;
    const country=typeof row?.merchant_country==='string'?row.merchant_country.toUpperCase():null;
    const evidenceUrl=publicHttpsUrl(row?.evidence_url);
    const observed=typeof row?.observed_at==='string'&&/^\d{4}-\d{2}-\d{2}T.*Z$/.test(row.observed_at)
      ?Date.parse(row.observed_at):NaN;
    if(!FEEDS.has(source)||typeof sellerId!=='string'||!/^[a-z0-9][a-z0-9_.-]{0,95}$/i.test(sellerId)
      ||!name||name.length>120||/[\u0000-\u001f\u007f]/.test(name)
      ||(country!==null&&!/^[A-Z]{2}$/.test(country))
      ||!evidenceUrl||!Number.isFinite(observed)||observed>now+300000||observed<now-30*DAY){
      rejected++;
      continue;
    }
    const rawConsentUrl=OPT_IN_FEEDS.has(source)?publicHttpsUrl(row?.opt_in_evidence_url):null;
    const rawConsentAt=typeof row?.opt_in_observed_at==='string'&&/^\d{4}-\d{2}-\d{2}T.*Z$/.test(row.opt_in_observed_at)
      ?Date.parse(row.opt_in_observed_at):NaN;
    const hasConsentEvidence=rawConsentUrl&&rawConsentAt>=now-30*DAY&&rawConsentAt<=now+300000;
    const identity=source+':'+sellerId;
    const candidate={
      source,source_seller_id:sellerId,public_name:name,merchant_country:country,evidence_url:evidenceUrl,
      observed_at:new Date(observed).toISOString(),
      review_status:hasConsentEvidence?'review_opt_in_evidence':'review_discovery_evidence',
      opt_in_evidence_url:hasConsentEvidence?rawConsentUrl:null,
      opt_in_observed_at:hasConsentEvidence?new Date(rawConsentAt).toISOString():null
    };
    const current=candidates.get(identity);
    if(current){
      duplicates++;
      if(current.observed_at>=candidate.observed_at)continue;
    }
    candidates.set(identity,candidate);
  }
  return {schema:'gpd-seller-discovery-evidence-v1',input_records:rows.length,rejected_records:rejected,
    duplicate_records:duplicates,candidates:[...candidates.values()]};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.length!==3)throw new Error('Usage: node scripts/gpd33_seller_discovery.mjs <manifest.json>');
    const file=await open(process.argv[2],'r');
    let rows;
    try{
      const info=await file.stat();
      if(!info.isFile()||info.size>MAX_BYTES)throw new Error('Expected a regular manifest file up to 256 KiB');
      const buffer=Buffer.alloc(MAX_BYTES+1);
      let size=0;
      while(size<buffer.length){
        const {bytesRead}=await file.read(buffer,size,buffer.length-size,size);
        if(!bytesRead)break;
        size+=bytesRead;
      }
      if(size>MAX_BYTES)throw new Error('Manifest exceeds 256 KiB');
      try{rows=JSON.parse(buffer.subarray(0,size).toString('utf8'));}
      catch{throw new Error('Manifest contains invalid JSON');}
    }finally{await file.close();}
    process.stdout.write(JSON.stringify(collectSellerCandidates(rows),null,2)+'\n');
  }catch(error){
    process.stderr.write('Seller manifest rejected: '+error.message+'\n');
    process.exitCode=2;
  }
}
