import {Resolver} from 'node:dns/promises';
import {get,request as httpsRequest} from 'node:https';
import {BlockList,isIPv4} from 'node:net';
import {pathToFileURL} from 'node:url';
import {prepareMerchantOfferFeed,readBoundedJson,validateMerchantFeedApproval} from './gpd33_merchant_offer_feed.mjs';

const MAX_BYTES=256*1024;
const TIMEOUT_MS=8000;
const nonPublic=new BlockList();
for(const [address,prefix] of [
  ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],
  ['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],
  ['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]
])nonPublic.addSubnet(address,prefix,'ipv4');

async function resolvePublicIPv4(hostname,signal){
  const resolver=new Resolver({timeout:2000,tries:1});
  const cancel=()=>resolver.cancel();
  signal.throwIfAborted();
  signal.addEventListener('abort',cancel,{once:true});
  try{return await resolver.resolve4(hostname);}
  finally{signal.removeEventListener('abort',cancel);}
}

export async function resolvePinnedPublicIpv4(hostname,signal,resolve=resolvePublicIPv4){
  const addresses=await resolve(hostname,signal);
  if(!Array.isArray(addresses)||!addresses.length||addresses.length>16
    ||addresses.some(address=>!isIPv4(address)||nonPublic.check(address,'ipv4')))throw new Error('feed_requires_public_ipv4');
  return addresses[0];
}

export function requestPinnedHttps(url,{
  address,signal,headers={accept:'application/json','accept-encoding':'identity'},method='GET',body
},transport=method==='GET'?get:httpsRequest){
  return new Promise((resolve,reject)=>{
    const request=transport(url,{
      agent:false,family:4,autoSelectFamily:false,signal,rejectUnauthorized:true,method,
      lookup:(_hostname,_options,callback)=>callback(null,address,4),
      headers
    },response=>{
      if(response.socket.remoteAddress!==address){
        response.destroy();
        reject(new Error('unexpected_feed_peer_address'));
        return;
      }
      resolve(response);
    });
    request.on('error',reject);
    if(method!=='GET')request.end(body);
  });
}

export const readMerchantFeedApproval=readBoundedJson;

export async function fetchApprovedMerchantOfferFeed(approval,{
  resolve=resolvePublicIPv4,request=requestPinnedHttps,now=Date.now()
}={}){
  const {feedUrl}=validateMerchantFeedApproval(approval,now);
  const signal=AbortSignal.timeout(TIMEOUT_MS);
  const address=await resolvePinnedPublicIpv4(feedUrl.hostname,signal,resolve);
  const response=await request(feedUrl,{address,signal});
  try{
    if(response.statusCode!==200)throw new Error('feed_http_status_rejected');
    const contentType=response.headers['content-type'];
    const encoding=response.headers['content-encoding'];
    if(typeof contentType!=='string'||!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(contentType)
      ||(encoding!==undefined&&encoding!=='identity'))throw new Error('expected_uncompressed_json_feed');
    const declared=response.headers['content-length'];
    if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>MAX_BYTES))throw new Error('feed_exceeds_256_KiB');
    const chunks=[];
    let bytes=0;
    for await(const chunk of response){
      signal.throwIfAborted();
      bytes+=chunk.length;
      if(bytes>MAX_BYTES)throw new Error('feed_exceeds_256_KiB');
      chunks.push(chunk);
    }
    if(declared!==undefined&&Number(declared)!==bytes)throw new Error('feed_content_length_mismatch');
    let manifest;
    try{manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
    catch{throw new Error('invalid_feed_json');}
    return prepareMerchantOfferFeed(approval,manifest,now);
  }finally{
    response.destroy();
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.length!==3)throw new Error('Expected an independent approval JSON file');
    const approval=await readMerchantFeedApproval(process.argv[2]);
    const preview=await fetchApprovedMerchantOfferFeed(approval);
    process.stdout.write(JSON.stringify(preview,null,2)+'\n');
  }catch{
    process.stderr.write('Approved merchant feed retrieval failed. Check the approval, endpoint and feed schema.\n');
    process.exitCode=2;
  }
}
