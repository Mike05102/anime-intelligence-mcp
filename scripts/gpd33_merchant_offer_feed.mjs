import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const MAX_BYTES=256*1024;
const STOCK_STATES=new Set(['in_stock','low_stock','backorder','preorder','out_of_stock','unknown']);
const UUID=/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const COUNTRY=/^[A-Z]{2}$/;
const FRESHNESS_MS=7*24*60*60*1000;

function utcTime(value){
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)?Date.parse(value):NaN;
}
function safeHttps(value){
  if(typeof value!=='string'||value.length>500)throw new Error('invalid_https_url');
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.port
    ||!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(url.hostname)
    ||/\.(?:local|internal|localhost|invalid|onion)$/i.test(url.hostname))throw new Error('invalid_https_url');
  return url;
}
function textField(value,maximum,error){
  if(typeof value!=='string'||!value.trim()||value.length>maximum||/[\u0000-\u001f\u007f]/.test(value))throw new Error(error);
  return value.trim();
}
function gtin(value){
  if(typeof value!=='string'||!(/^(?:\d{8}|\d{12,14})$/).test(value)||/^(\d)\1+$/.test(value))throw new Error('invalid_gtin');
  const sum=[...value.slice(0,-1)].reverse().reduce((total,digit,index)=>total+Number(digit)*(index%2?1:3),0);
  if((10-sum%10)%10!==Number(value.at(-1)))throw new Error('invalid_gtin');
  return value;
}
function currencyPrice(value){
  if(typeof value!=='string'||!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,4})?$/.test(value))throw new Error('invalid_price');
  return value;
}

export function validateMerchantFeedApproval(approval,now=Date.now()){
  const selected=approval?.merchant_id;
  const approvedUntil=utcTime(approval?.approved_until);
  const feedUrl=safeHttps(approval?.feed_url);
  if(!UUID.test(selected||'')||!Number.isFinite(approvedUntil)||approvedUntil<=now)throw new Error('feed_approval_required');
  if(!Array.isArray(approval.product_origins)||!approval.product_origins.length||approval.product_origins.length>10)throw new Error('approved_product_origins_required');
  const origins=new Set(approval.product_origins.map(value=>{
    const url=safeHttps(value);
    if(url.pathname!=='/')throw new Error('approved_product_origins_required');
    return url.origin;
  }));
  return {selected,feedUrl,origins};
}

export function prepareMerchantOfferFeed(approval,manifest,now=Date.now()){
  const {selected,feedUrl,origins}=validateMerchantFeedApproval(approval,now);
  if(manifest?.schema!=='gpd-merchant-offer-feed-input-v1'||manifest?.merchant_id!==selected
    ||safeHttps(manifest?.feed_url).href!==feedUrl.href)throw new Error('feed_approval_required');
  const observed=utcTime(manifest.observed_at);
  if(!Number.isFinite(observed)||observed<now-FRESHNESS_MS||observed>now+300000)throw new Error('stale_or_invalid_feed');
  if(!Array.isArray(manifest.offers)||!manifest.offers.length||manifest.offers.length>200)throw new Error('offer_count_outside_limit');
  const skus=new Set();
  const offers=manifest.offers.map((offer,index)=>{
    try{
      const sku=textField(offer?.merchant_sku,200,'invalid_sku');
      if(skus.has(sku))throw new Error('duplicate_sku');
      skus.add(sku);
      const manufacturer=textField(offer.manufacturer,160,'manufacturer_required');
      const partNumber=textField(offer.part_number,200,'part_number_required');
      const structuredGtin=offer.gtin==null?null:gtin(offer.gtin);
      if(!/[\p{L}\p{N}]/u.test(partNumber))throw new Error('invalid_part_number');
      if(!STOCK_STATES.has(offer.stock_status))throw new Error('invalid_stock');
      if(typeof offer.currency!=='string'||!/^[A-Z]{3}$/.test(offer.currency))throw new Error('invalid_currency');
      if(!Array.isArray(offer.ships_to)||offer.ships_to.length>100
        ||offer.ships_to.some(country=>typeof country!=='string'||!COUNTRY.test(country)))throw new Error('invalid_ship_to');
      const product=safeHttps(offer.product_url);
      if(!origins.has(product.origin))throw new Error('unapproved_product_origin');
      return {merchant_sku:sku,manufacturer,part_number:partNumber,gtin:structuredGtin,
        title:textField(offer.title,500,'invalid_title'),currency:offer.currency,price:currencyPrice(offer.price),
        stock_status:offer.stock_status,ships_to:[...new Set(offer.ships_to)],product_url:product.href,
        source_updated_at:new Date(observed).toISOString()};
    }catch(error){
      throw new Error('offer_'+(index+1)+':'+(error instanceof TypeError?'invalid_offer':error.message));
    }
  });
  return {schema:'gpd-merchant-offer-feed-preview-v1',status:'operator_review_required',merchant_id:selected,
    feed_url:feedUrl.href,offer_count:offers.length,upsert_payload:{offers}};
}

export async function readBoundedJson(path,maxBytes=MAX_BYTES){
  const info=await stat(path);
  if(!info.isFile()||info.size>maxBytes)throw new Error('input_file_must_be_bounded_and_regular');
  const chunks=[];
  let size=0;
  for await(const chunk of createReadStream(path,{end:maxBytes})){
    size+=chunk.length;
    if(size>maxBytes)throw new Error('input_file_exceeds_byte_limit');
    chunks.push(chunk);
  }
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{throw new Error('invalid_input_json');}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.length!==4)throw new Error('Usage: node scripts/gpd33_merchant_offer_feed.mjs <approval.json> <feed.json>');
    const [approval,manifest]=await Promise.all(process.argv.slice(2).map(path=>readBoundedJson(path)));
    process.stdout.write(JSON.stringify(prepareMerchantOfferFeed(approval,manifest),null,2)+'\n');
  }catch(error){
    process.stderr.write('Merchant offer feed rejected: '+error.message+'\n');
    process.exitCode=2;
  }
}
