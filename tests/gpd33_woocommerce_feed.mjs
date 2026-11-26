import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {fetchApprovedMerchantOfferFeed} from '../scripts/gpd33_merchant_feed_fetch.mjs';
import {prepareMerchantOfferFeed} from '../scripts/gpd33_merchant_offer_feed.mjs';

const now=Date.parse('2026-11-26T00:00:00Z');
const product='https://shop.example/product/1';
const approved={
  merchant_id:'00000000-0000-4000-8000-000000000001',feed_format:'woocommerce-store-api-v1',
  feed_url:'https://shop.example/wp-json/wc/store/v1/products',product_origins:['https://shop.example'],
  approved_until:'2026-12-01T00:00:00Z',
  woo_products:[{id:1,type:'simple',merchant_sku:'approved-1',manufacturer:'Fixture maker',part_number:'F-1',
    gtin:'4901234567894',product_url:product,ships_to:['JP'],condition:'new'}]
};
const item={
  id:1,type:'simple',name:'Store product',sku:'approved-1',global_unique_id:'04901234567894',permalink:product,
  is_in_stock:true,is_on_backorder:false,is_purchasable:true,is_password_protected:false,has_options:false,
  low_stock_remaining:4,ships_to:['US'],brands:[{name:'Untrusted manufacturer'}],
  prices:{price:'1105',currency_code:'GBP',currency_minor_unit:2,price_range:null}
};
function response(rows,headers){
  const stream=Readable.from([Buffer.from(JSON.stringify(rows))]);
  return Object.assign(stream,{statusCode:200,headers:{'content-type':'application/json',...headers}});
}
function preview(rows=[item],config=approved,headers={}){
  return fetchApprovedMerchantOfferFeed(config,{
    now,resolve:async host=>{assert.equal(host,'shop.example');return ['93.184.215.14'];},
    request:async(url,options)=>{
      assert.equal(url.href,config.feed_url);
      assert.equal(options.address,'93.184.215.14');
      assert.equal(options.method,undefined);
      return response(rows,headers);
    }
  });
}

const allowed=await preview([item,{...item,id:2,global_unique_id:'unapproved-data'}]);
assert.equal(allowed.offer_count,1);
assert.deepEqual(allowed.upsert_payload.offers[0],{
  merchant_sku:'approved-1',manufacturer:'Fixture maker',part_number:'F-1',gtin:'4901234567894',
  title:'Store product',currency:'GBP',price:'11.05',stock_status:'in_stock',condition:'new',
  ships_to:['JP'],product_url:product,source_updated_at:'2026-11-26T00:00:00.000Z'
});
assert.equal((await preview([{...item,is_on_backorder:undefined}])).upsert_payload.offers[0].stock_status,'unknown');
assert.equal((await preview([{...item,is_on_backorder:true}])).upsert_payload.offers[0].stock_status,'backorder');
assert.equal((await preview([{...item,is_purchasable:false}])).upsert_payload.offers[0].stock_status,'unknown');
assert.equal((await preview([{...item,is_in_stock:false}])).upsert_payload.offers[0].stock_status,'out_of_stock');
const jpy=await preview([{...item,prices:{price:'1105',currency_code:'JPY',currency_minor_unit:0}}]);
assert.equal(jpy.upsert_payload.offers[0].price,'1105');
const single={...approved,feed_url:approved.feed_url+'/1'};
assert.equal((await preview(item,single)).offer_count,1);

await assert.rejects(preview([{...item,global_unique_id:'4500000000012'}]),/invalid_gtin|conflicts_with_approval/);
await assert.rejects(preview([{...item,global_unique_id:''}]),/invalid_gtin/);
await assert.rejects(preview([{...item,global_unique_id:'9780306406157'}]),/conflicts_with_approval/);
await assert.rejects(preview([{...item,sku:'other'}]),/conflicts_with_approval/);
await assert.rejects(preview([{...item,has_options:true}]),/conflicts_with_approval/);
await assert.rejects(preview([{...item,is_password_protected:true}]),/conflicts_with_approval/);
await assert.rejects(preview([{...item,permalink:'https://shop.example/product/unapproved'}]),/conflicts_with_approval/);
await assert.rejects(preview([{...item,prices:{...item.prices,price_range:{min_amount:'1105',max_amount:'8000'}}}]),/woocommerce_price/);
await assert.rejects(preview([item],approved,{age:'3601'}),/woocommerce_response_too_old/);
await assert.rejects(preview([item,item]),/duplicate_sku/);
await assert.rejects(preview([{...item,id:2}]),/no_approved_woocommerce_products/);
await assert.rejects(preview([item],{...approved,feed_format:undefined}),/approval_required/);
const noNetwork={now,resolve:async()=>assert.fail('Approval must be checked before DNS')};
await assert.rejects(fetchApprovedMerchantOfferFeed({...approved,approved_until:'2026-11-25T00:00:00Z'},noNetwork),/approval_required/);
await assert.rejects(fetchApprovedMerchantOfferFeed({...approved,feed_url:'https://shop.example/wp-json/wc/store/v1/cart'},noNetwork),/invalid_woocommerce_approval/);
const reconstructed={
  schema:'gpd-merchant-offer-feed-input-v1',merchant_id:approved.merchant_id,feed_url:approved.feed_url,
  observed_at:new Date(now).toISOString(),offers:allowed.upsert_payload.offers
};
assert.equal(prepareMerchantOfferFeed(approved,reconstructed,now).offer_count,1);
for(const alteration of [{ships_to:['US']},{manufacturer:'Other name'},{condition:'used'},{stock_quantity:4}]){
  assert.throws(()=>prepareMerchantOfferFeed(approved,{...reconstructed,offers:[{...reconstructed.offers[0],...alteration}]},now),/conflicts_with_approval/);
}

console.log('PASS WooCommerce merchant approval, exact identifiers, currency conversion, stock uncertainty and bounded HTTPS previews');
