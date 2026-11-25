import assert from 'node:assert/strict';
import {collectSellerCandidates} from '../scripts/gpd33_seller_discovery.mjs';

const now=Date.parse('2026-11-25T00:00:00Z');
const record={source:'merchant_feed',source_seller_id:'alpha',public_name:'Alpha',merchant_country:'jp',
  evidence_url:'https://merchants.example/alpha?session=private#page',observed_at:'2026-11-24T00:00:00Z',
  opt_in_evidence_url:'https://merchants.example/alpha/consent?token=private',
  opt_in_observed_at:'2026-11-24T00:00:00Z',email:'private@example.test',verified:true};
const result=collectSellerCandidates([
  record,
  {...record,observed_at:'2026-11-23T00:00:00Z',public_name:'Old Alpha'},
  {...record,source:'ebay_browse',public_name:'Marketplace Alpha'},
  {...record,source_seller_id:'beta',opt_in_observed_at:'2026-10-01T00:00:00Z'},
  {...record,source_seller_id:'gamma',evidence_url:'https://user:pass@merchants.example'},
  {...record,source_seller_id:'delta',evidence_url:'https://127.0.0.1/a'},
  {...record,source_seller_id:'epsilon',observed_at:'2026-10-01T00:00:00Z'},
  {...record,source_seller_id:'zeta',observed_at:'2026-11-26T00:00:00Z'}
],now);
assert.equal(result.rejected_records,4);
assert.equal(result.duplicate_records,1);
assert.equal(result.candidates.length,3);
assert.equal(result.candidates[0].public_name,'Alpha');
assert.equal(result.candidates[0].merchant_country,'JP');
assert.equal(result.candidates[0].review_status,'review_opt_in_evidence');
assert.equal(result.candidates[0].evidence_url,'https://merchants.example/alpha');
assert.equal(result.candidates[0].opt_in_evidence_url,'https://merchants.example/alpha/consent');
assert.equal(result.candidates[1].review_status,'review_discovery_evidence');
assert.equal(result.candidates[2].review_status,'review_discovery_evidence');
assert.ok(!JSON.stringify(result).includes('private'));
assert.ok(!Object.hasOwn(result.candidates[0],'verified'));
assert.throws(()=>collectSellerCandidates(Array(501).fill(record),now),/at most 500/);
console.log('PASS seller candidate provenance, opt-in review, redaction and fetch-free limits');
