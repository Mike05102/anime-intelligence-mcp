import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {prepareMerchantOfferFeed,readBoundedJson} from './gpd33_merchant_offer_feed.mjs';
import {requestPinnedHttps,resolvePinnedPublicIpv4} from './gpd33_merchant_feed_fetch.mjs';

const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const MAX_RESPONSE_BYTES=64*1024;
const MAX_REPORT_BYTES=1024*1024;

export function fingerprintPartnerReview(report){
  return createHash('sha256').update(JSON.stringify(report)).digest('hex');
}

function approvedWorker(approval,report,now){
  if(typeof approval?.worker_origin!=='string'||approval.worker_origin.length>300)throw new Error('write_approval_required');
  const origin=new URL(approval.worker_origin);
  if(approval.schema!=='gpd-merchant-feed-write-approval-v1'||approval.allow_publish!==true
    ||!UUID.test(report?.snapshot_id||'')||approval.snapshot_id!==report.snapshot_id
    ||!UUID.test(approval.merchant_id||'')||approval.merchant_id!==report.merchant_feed?.merchant_id
    ||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(approval.approved_until||'')
    ||!(Date.parse(approval.approved_until)>now)
    ||origin.protocol!=='https:'||origin.origin!==approval.worker_origin
    ||!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(origin.hostname)||origin.port
    ||approval.report_sha256!==fingerprintPartnerReview(report))throw new Error('write_approval_required');
  return origin;
}

function revalidatePreview(report,feedApproval,now){
  const preview=report?.merchant_feed;
  if(report?.schema!=='gpd-partner-review-v1'||report.status!=='review_required'
    ||preview?.schema!=='gpd-merchant-offer-feed-preview-v1'||preview.status!=='operator_review_required'
    ||!Array.isArray(preview.upsert_payload?.offers)||preview.offer_count!==preview.upsert_payload.offers.length){
    throw new Error('invalid_review_report');
  }
  const offers=preview.upsert_payload.offers;
  const observedAt=offers[0]?.source_updated_at;
  if(offers.some(offer=>offer?.source_updated_at!==observedAt))throw new Error('inconsistent_observation_times');
  return prepareMerchantOfferFeed(feedApproval,{
    schema:'gpd-merchant-offer-feed-input-v1',
    merchant_id:preview.merchant_id,feed_url:preview.feed_url,observed_at:observedAt,offers
  },now).upsert_payload.offers;
}

async function responseJson(response,signal){
  try{
    if(response.statusCode!==200)throw new Error('worker_response_rejected');
    const contentType=response.headers['content-type']||'';
    const encoding=response.headers['content-encoding'];
    const length=response.headers['content-length'];
    if(!/^application\/json(?:\s*;|$)/i.test(contentType)||(encoding!==undefined&&encoding!=='identity')
      ||(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>MAX_RESPONSE_BYTES))){
      throw new Error('worker_response_rejected');
    }
    let size=0;
    const chunks=[];
    for await(const chunk of response){
      signal.throwIfAborted();
      size+=chunk.length;
      if(size>MAX_RESPONSE_BYTES)throw new Error('worker_response_too_large');
      chunks.push(chunk);
    }
    if(length!==undefined&&Number(length)!==size)throw new Error('worker_response_length_mismatch');
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));}
    catch{throw new Error('worker_response_invalid_json');}
  }finally{
    response.destroy();
  }
}

export async function publishApprovedMerchantFeed(report,feedApproval,writeApproval,{
  apiKey,now=Date.now(),resolve=resolvePinnedPublicIpv4,request=requestPinnedHttps
}={}){
  const origin=approvedWorker(writeApproval,report,now);
  const offers=revalidatePreview(report,feedApproval,now);
  if(typeof apiKey!=='string'||!/^mai_[A-Za-z0-9]{20,100}$/.test(apiKey))throw new Error('merchant_key_required');
  const merchantId=writeApproval.merchant_id;
  const signal=AbortSignal.timeout(12000);
  const address=await resolve(origin.hostname,signal);
  const headers={accept:'application/json','accept-encoding':'identity','x-merchant-key':apiKey};
  const me=await responseJson(await request(new URL('/v1/merchant/me',origin),{address,signal,headers}),signal);
  if(me?.ok!==true||me.merchant?.id!==merchantId||me.merchant.verified!==true)throw new Error('merchant_identity_mismatch');

  const body=JSON.stringify({merchant_id:merchantId,offers});
  const result=await responseJson(await request(new URL('/v1/merchant/offers/feed-import',origin),{
    address,signal,method:'POST',body,
    headers:{...headers,'content-type':'application/json','content-length':String(Buffer.byteLength(body))}
  }),signal);
  if(result?.ok!==true||result.merchant_id!==merchantId||result.offers_received!==offers.length
    ||![result.new_or_updated,result.ignored].every(count=>Number.isSafeInteger(count)&&count>=0)
    ||result.new_or_updated+result.ignored!==offers.length)throw new Error('feed_import_confirmation_invalid');
  return {status:'import_confirmed',snapshot_id:report.snapshot_id,merchant_id:merchantId,
    offers_received:offers.length,new_or_updated:result.new_or_updated,ignored:result.ignored};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.length===4&&process.argv[2]==='--digest'){
      process.stdout.write(fingerprintPartnerReview(await readBoundedJson(process.argv[3],MAX_REPORT_BYTES))+'\n');
    }else{
      if(process.argv.length!==5)throw new Error('Expected a local review report, feed approval and write approval');
      const [reportFile,feedFile,writeFile]=process.argv.slice(2);
      const [report,feedApproval,writeApproval]=await Promise.all([
        readBoundedJson(reportFile,MAX_REPORT_BYTES),readBoundedJson(feedFile),readBoundedJson(writeFile)
      ]);
      const result=await publishApprovedMerchantFeed(report,feedApproval,writeApproval,{apiKey:process.env.GPD_MERCHANT_API_KEY});
      process.stdout.write(JSON.stringify(result)+'\n');
    }
  }catch{
    process.stderr.write('Merchant feed publish could not be confirmed. Check the pinned review, approvals, merchant identity and Worker before retrying.\n');
    process.exitCode=1;
  }
}
