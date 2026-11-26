import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const MAX_BYTES=256*1024;
const STOCK_STATES=new Set(['in_stock','low_stock','backorder','preorder','out_of_stock','unknown']);
const OFFER_CONDITIONS=new Set(['new','used','refurbished','open_box','unknown']);
const UUID=/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const COUNTRY=/^[A-Z]{2}$/;
const FRESHNESS_MS=7*24*60*60*1000;
const MAX_STOCK_QUANTITY=2147483647;
const WOO_FORMAT='woocommerce-store-api-v1';

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

function approveWooProducts(approval,feedUrl,origins){
  const endpoint=/^\/wp-json\/wc\/store\/v1\/products(?:\/([1-9]\d*))?\/?$/.exec(feedUrl.pathname);
  const products=approval.woo_products;
  if(!endpoint||!Array.isArray(products)||products.length<1||products.length>50){
    throw new Error('invalid_woocommerce_approval');
  }
  const byId=new Map(),bySku=new Map();
  for(const item of products){
    const sku=textField(item?.merchant_sku,200,'invalid_woocommerce_approval');
    if(!Number.isSafeInteger(item.id)||item.id<1||byId.has(item.id)||bySku.has(sku)
      ||(endpoint[1]&&String(item.id)!==endpoint[1])
      ||!['simple','variation'].includes(item.type)
      ||!Array.isArray(item.ships_to)||item.ships_to.length>100
      ||item.ships_to.some(country=>typeof country!=='string'||!COUNTRY.test(country))
      ||(item.condition!=null&&!OFFER_CONDITIONS.has(item.condition)))throw new Error('invalid_woocommerce_approval');
    const productUrl=safeHttps(item.product_url);
    if(!origins.has(productUrl.origin))throw new Error('unapproved_product_origin');
    const evidence={merchant_sku:sku,type:item.type,gtin:gtin(item.gtin),
      manufacturer:textField(item.manufacturer,160,'manufacturer_required'),
      part_number:textField(item.part_number,200,'part_number_required'),
      product_url:productUrl.href,ships_to:[...new Set(item.ships_to)],condition:item.condition??null};
    byId.set(item.id,evidence);
    bySku.set(sku,evidence);
  }
  return {byId,bySku};
}

function wooPrice(prices){
  const scale=prices?.currency_minor_unit,amount=prices?.price;
  if(!Number.isInteger(scale)||scale<0||scale>4||typeof amount!=='string'
    ||!/^(?:0|[1-9]\d{0,12})$/.test(amount)||prices.price_range!=null)throw new Error('invalid_woocommerce_price');
  if(scale===0)return currencyPrice(amount);
  const digits=amount.padStart(scale+1,'0');
  return currencyPrice(digits.slice(0,-scale)+'.'+digits.slice(-scale));
}

export function normalizeApprovedWooCommerceResponse(scope,body,observedAt){
  const rows=Array.isArray(body)?body:[body];
  if(!scope.woo||!rows.length||rows.length>50||rows.some(item=>!Number.isSafeInteger(item?.id)||item.id<1)){
    throw new Error('invalid_woocommerce_response');
  }
  const offers=[];
  for(const row of rows){
    const approved=scope.woo.byId.get(row.id);
    if(!approved)continue;
    const stock=typeof row.is_in_stock==='boolean'?row.is_in_stock:null;
    const backorder=typeof row.is_on_backorder==='boolean'?row.is_on_backorder:null;
    if(row.type!==approved.type||row.has_options!==false||row.is_password_protected!==false
      ||row.sku!==approved.merchant_sku||gtin(row.global_unique_id).padStart(14,'0')!==approved.gtin.padStart(14,'0')
      ||safeHttps(row.permalink).href!==approved.product_url
      ||typeof row.is_purchasable!=='boolean'||(stock===false&&backorder===true))throw new Error('woocommerce_item_conflicts_with_approval');
    const {merchant_sku,gtin:barcode,manufacturer,part_number,product_url,ships_to,condition}=approved;
    offers.push({merchant_sku,gtin:barcode,manufacturer,part_number,product_url,ships_to,condition,title:row.name,
      price:wooPrice(row.prices),currency:row.prices.currency_code,
      stock_status:stock===false?'out_of_stock':!row.is_purchasable?'unknown':backorder===true?'backorder':
        stock===true&&backorder===false?'in_stock':'unknown'});
  }
  if(!offers.length)throw new Error('no_approved_woocommerce_products');
  return {schema:'gpd-merchant-offer-feed-input-v1',merchant_id:scope.selected,feed_url:scope.feedUrl.href,
    observed_at:observedAt,offers};
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
  if(approval.feed_format===WOO_FORMAT)return {selected,feedUrl,origins,woo:approveWooProducts(approval,feedUrl,origins)};
  if(approval.feed_format!==undefined&&approval.feed_format!=='gpd-merchant-offer-feed-input-v1'){
    throw new Error('invalid_merchant_feed_format');
  }
  return {selected,feedUrl,origins};
}

export function prepareMerchantOfferFeed(approval,manifest,now=Date.now()){
  const {selected,feedUrl,origins,woo}=validateMerchantFeedApproval(approval,now);
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
      const quantity=offer.stock_quantity;
      if(quantity!=null&&(!Number.isInteger(quantity)||quantity<0||quantity>MAX_STOCK_QUANTITY))throw new Error('invalid_stock_quantity');
      const condition=offer.condition;
      if(condition!=null&&!OFFER_CONDITIONS.has(condition))throw new Error('invalid_condition');
      if(typeof offer.currency!=='string'||!/^[A-Z]{3}$/.test(offer.currency))throw new Error('invalid_currency');
      if(!Array.isArray(offer.ships_to)||offer.ships_to.length>100
        ||offer.ships_to.some(country=>typeof country!=='string'||!COUNTRY.test(country)))throw new Error('invalid_ship_to');
      const product=safeHttps(offer.product_url);
      if(!origins.has(product.origin))throw new Error('unapproved_product_origin');
      if(woo){
        const approved=woo.bySku.get(sku);
        const destinations=[...new Set(offer.ships_to)];
        if(!approved||approved.gtin!==structuredGtin||approved.manufacturer!==manufacturer||approved.part_number!==partNumber
          ||approved.product_url!==product.href||(condition??null)!==approved.condition||quantity!=null
          ||destinations.length!==approved.ships_to.length||destinations.some(country=>!approved.ships_to.includes(country))){
          throw new Error('woocommerce_item_conflicts_with_approval');
        }
      }
      return {merchant_sku:sku,manufacturer,part_number:partNumber,gtin:structuredGtin,
        title:textField(offer.title,500,'invalid_title'),currency:offer.currency,price:currencyPrice(offer.price),
        stock_status:offer.stock_status,...(quantity==null?{}:{stock_quantity:quantity}),
        ...(condition==null?{}:{condition}),
        ships_to:[...new Set(offer.ships_to)],product_url:product.href,
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
