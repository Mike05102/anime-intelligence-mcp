import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareMerchantOfferFeed} from '../scripts/gpd33_merchant_offer_feed.mjs';

const now=Date.parse('2026-11-25T10:00:00Z');
const approval={merchant_id:'10000000-0000-4000-8000-000000000001',feed_url:'https://feed.merchant.example/catalog.json',
  approved_until:'2026-12-25T00:00:00Z',product_origins:['https://merchant.example/']};
const offer={merchant_sku:'seller-1',manufacturer:'Example',part_number:'X-1',gtin:'4901234567894',title:'X-1 example',
  currency:'JPY',price:'1200.00',stock_status:'in_stock',ships_to:['JP','JP'],product_url:'https://merchant.example/x-1',merchant_id:'forged',checkout_url:'https://unapproved.example'};
const manifest={schema:'gpd-merchant-offer-feed-input-v1',merchant_id:approval.merchant_id,feed_url:approval.feed_url,
  observed_at:'2026-11-25T09:00:00Z',offers:[offer]};
const preview=prepareMerchantOfferFeed(approval,manifest,now);
assert.equal(preview.status,'operator_review_required');
assert.equal(preview.offer_count,1);
assert.deepEqual(preview.upsert_payload.offers[0].ships_to,['JP']);
assert.ok(!Object.hasOwn(preview.upsert_payload.offers[0],'stock_quantity'));
for(const quantity of [0,5,2147483647]){
  const result=prepareMerchantOfferFeed(approval,{...manifest,offers:[{...offer,stock_quantity:quantity}]},now);
  assert.equal(result.upsert_payload.offers[0].stock_quantity,quantity);
}
const unknownStock=prepareMerchantOfferFeed(approval,{...manifest,offers:[{...offer,stock_quantity:null}]},now);
assert.ok(!Object.hasOwn(unknownStock.upsert_payload.offers[0],'stock_quantity'));
for(const quantity of [-1,1.5,'4',false,2147483648]){
  assert.throws(()=>prepareMerchantOfferFeed(approval,{...manifest,offers:[{...offer,stock_quantity:quantity}]},now),/invalid_stock_quantity/);
}
assert.equal(preview.upsert_payload.offers[0].price,'1200.00');
assert.ok(!JSON.stringify(preview).includes('forged'));
assert.ok(!JSON.stringify(preview).includes('unapproved'));
assert.throws(()=>prepareMerchantOfferFeed({...approval,approved_until:'2026-11-24T00:00:00Z'},manifest,now),/approval_required/);
assert.throws(()=>prepareMerchantOfferFeed(approval,{...manifest,feed_url:'https://spoof.example/catalog.json'},now),/approval_required/);
assert.throws(()=>prepareMerchantOfferFeed(approval,{...manifest,observed_at:'2026-11-01T00:00:00Z'},now),/stale_or_invalid_feed/);
assert.throws(()=>prepareMerchantOfferFeed(approval,{...manifest,offers:[offer,offer]},now),/duplicate_sku/);
assert.throws(()=>prepareMerchantOfferFeed(approval,{...manifest,offers:[{...offer,gtin:'4901234567890'}]},now),/invalid_gtin/);
assert.throws(()=>prepareMerchantOfferFeed(approval,{...manifest,offers:[{...offer,ships_to:['WORLDWIDE']}]},now),/invalid_ship_to/);
assert.throws(()=>prepareMerchantOfferFeed(approval,{...manifest,offers:[{...offer,product_url:'https://spoof.example'}]},now),/unapproved_product_origin/);
assert.throws(()=>prepareMerchantOfferFeed(approval,{...manifest,offers:Array(201).fill(offer)},now),/offer_count_outside_limit/);

const worker=await readFile(new URL('../releases/GPD33_0_COMPLETE_WORKER.js',import.meta.url),'utf8');
const {normalizeMerchantOfferInput}=await import('data:text/javascript;base64,'+Buffer.from(worker+'\nexport {normalizeMerchantOfferInput};').toString('base64'));
const normalized=normalizeMerchantOfferInput(preview.upsert_payload.offers[0],approval.merchant_id);
assert.equal(normalized.normalized_part_number,'X-1');
assert.equal(normalized.merchant_id,approval.merchant_id);
assert.equal(normalized.gtin,offer.gtin);
assert.equal(normalized.price,1200);
assert.deepEqual(normalized.ships_to,['JP']);
console.log('PASS offline approved merchant-offer feed and Worker upsert normalization');
