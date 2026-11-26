import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {link,lstat,open,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareMerchantOfferFeed,readBoundedJson} from './gpd33_merchant_offer_feed.mjs';
import {requestPinnedHttps,resolvePinnedPublicIpv4} from './gpd33_merchant_feed_fetch.mjs';

const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const MAX_RESPONSE_BYTES=64*1024;
const MAX_REPORT_BYTES=1024*1024;
const MAX_RECEIPT_BYTES=4096;

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
  if(!['gpd-partner-review-v1','gpd-merchant-feed-review-v1'].includes(report?.schema)||report.status!=='review_required'
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

function tryReceiptLock(descriptor){
  return new Promise((resolve,reject)=>{
    // FD 3 shares the parent's open-file description, so termination releases the lock.
    const child=spawn('flock',['-n','-E','75','3'],{stdio:['ignore','ignore','ignore',descriptor.fd]});
    child.once('error',reject);
    child.once('exit',code=>{
      if(code===0||code===75)resolve(code===0);
      else reject(new Error('private_receipt_lock_unavailable'));
    });
  });
}

async function requirePrivateFile(descriptor){
  const st=await descriptor.stat();
  if(!st.isFile()||st.mode&0o077||st.uid!==process.getuid())throw new Error('private_receipt_file_required');
  return st;
}

async function readReceipt(path,scope,offersReceived){
  let file;
  try{
    file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  }catch(error){
    if(error.code==='ENOENT')return null;
    throw error;
  }
  try{
    const st=await requirePrivateFile(file);
    if(st.size<1||st.size>MAX_RECEIPT_BYTES)throw new Error('invalid_publish_receipt');
    const buffer=Buffer.alloc(MAX_RECEIPT_BYTES+1);
    let used=0;
    while(used<buffer.length){
      const {bytesRead}=await file.read(buffer,used,buffer.length-used,used);
      if(!bytesRead)break;
      used+=bytesRead;
    }
    if(used!==st.size)throw new Error('invalid_publish_receipt');
    const saved=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,used)));
    if(saved?.schema!=='gpd-merchant-feed-publish-receipt-v1'||saved.status!=='import_confirmed'
      ||Object.entries(scope).some(([key,value])=>saved[key]!==value)
      ||saved.offers_received!==offersReceived
      ||![saved.new_or_updated,saved.ignored].every(count=>Number.isSafeInteger(count)&&count>=0)
      ||saved.new_or_updated+saved.ignored!==offersReceived)throw new Error('invalid_publish_receipt');
    return {status:'already_imported',snapshot_id:scope.snapshot_id,merchant_id:scope.merchant_id,
      offers_received:offersReceived,new_or_updated:saved.new_or_updated,ignored:saved.ignored};
  }finally{
    await file.close();
  }
}

async function withPublishReceipt(directory,scope,offersReceived,publish){
  const st=await lstat(directory);
  if(!st.isDirectory()||st.mode&0o077||st.uid!==process.getuid())throw new Error('private_receipt_directory_required');
  const basename='merchant-feed-'+fingerprintPartnerReview(scope);
  const receiptPath=join(directory,basename+'.json');
  const tempPath=join(directory,'.'+basename+'.tmp');
  const lock=await open(join(directory,'.merchant-feed-publish.lock'),
    constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);
  try{
    await requirePrivateFile(lock);
    if(!await tryReceiptLock(lock))return {status:'import_in_progress',snapshot_id:scope.snapshot_id,merchant_id:scope.merchant_id};
    const confirmed=await readReceipt(receiptPath,scope,offersReceived);
    if(confirmed)return confirmed;
    await unlink(tempPath).catch(error=>{if(error.code!=='ENOENT')throw error;});
    // Open the private output directory before publishing so local setup failures are discovered first.
    const dir=await open(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    try{
      const out=await open(tempPath,'wx',0o600);
      try{
        const result=await publish();
        await out.writeFile(JSON.stringify({schema:'gpd-merchant-feed-publish-receipt-v1',...scope,...result})+'\n');
        await out.sync();
        await link(tempPath,receiptPath);
        await dir.sync();
        return result;
      }finally{
        await out.close();
        await unlink(tempPath);
      }
    }finally{
      await dir.close();
    }
  }finally{
    await lock.close();
  }
}

export async function publishApprovedMerchantFeed(report,feedApproval,writeApproval,{
  apiKey,now=Date.now(),resolve=resolvePinnedPublicIpv4,request=requestPinnedHttps,receiptDirectory
}={}){
  const origin=approvedWorker(writeApproval,report,now);
  const offers=revalidatePreview(report,feedApproval,now);
  const scope={snapshot_id:report.snapshot_id,merchant_id:writeApproval.merchant_id,
    worker_origin:origin.origin,report_sha256:writeApproval.report_sha256};
  const publish=()=>sendApprovedOffers(origin,scope,offers,{apiKey,resolve,request});
  return receiptDirectory===undefined?publish():withPublishReceipt(receiptDirectory,scope,offers.length,publish);
}

async function sendApprovedOffers(origin,scope,offers,{apiKey,resolve,request}){
  if(typeof apiKey!=='string'||!/^mai_[A-Za-z0-9]{20,100}$/.test(apiKey))throw new Error('merchant_key_required');
  const merchantId=scope.merchant_id;
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
  return {status:'import_confirmed',snapshot_id:scope.snapshot_id,merchant_id:merchantId,
    offers_received:offers.length,new_or_updated:result.new_or_updated,ignored:result.ignored};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.length===4&&process.argv[2]==='--digest'){
      process.stdout.write(fingerprintPartnerReview(await readBoundedJson(process.argv[3],MAX_REPORT_BYTES))+'\n');
    }else{
      if(process.argv.length!==5&&process.argv.length!==6)throw new Error('Expected a local review report, feed approval and write approval');
      const [reportFile,feedFile,writeFile,receiptDirectory]=process.argv.slice(2);
      const [report,feedApproval,writeApproval]=await Promise.all([
        readBoundedJson(reportFile,MAX_REPORT_BYTES),readBoundedJson(feedFile),readBoundedJson(writeFile)
      ]);
      const result=await publishApprovedMerchantFeed(report,feedApproval,writeApproval,{apiKey:process.env.GPD_MERCHANT_API_KEY,receiptDirectory});
      process.stdout.write(JSON.stringify(result)+'\n');
    }
  }catch{
    process.stderr.write('Merchant feed publish could not be confirmed. Check the pinned review, approvals, merchant identity and Worker before retrying.\n');
    process.exitCode=1;
  }
}
