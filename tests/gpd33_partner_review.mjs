import assert from 'node:assert/strict';
import {generateKeyPairSync, randomUUID, sign} from 'node:crypto';
import {mkdtemp, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {runPartnerReview} from '../scripts/gpd33_partner_review.mjs';

const directory = await mkdtemp(join(tmpdir(),'gpd-partner-fixture-'));
try {
  const merchant = randomUUID(), snapshot = randomUUID();
  const approval = {merchant_id:merchant,feed_url:'https://feed.merchant.example/offers.json',
    approved_until:'2026-12-02T00:00:00Z',product_origins:['https://merchant.example/']};
  const manifest = {schema:'gpd-merchant-offer-feed-input-v1',merchant_id:merchant,feed_url:approval.feed_url,
    observed_at:'2026-11-25T00:00:00Z',offers:[{merchant_sku:'fixture-offer',manufacturer:'Example',
      part_number:'X-1',gtin:'4901234567894',title:'Fixture offer',currency:'JPY',price:'1200.00',
      stock_status:'in_stock',ships_to:['JP'],product_url:'https://merchant.example/x-1'}]};
  const contexts = {handoffs:'gpd33-handoffs-v1',orders:'gpd33-external-order-ledger-v1',
    fees:'gpd33-agreed-fees-v1',receipts:'gpd33-finalized-settlement-v1'};
  const trust = {schema_version:1,environment:'test',issuers:{},https_sources:{}};
  const envelopes = new Map();
  for(const [role,context] of Object.entries(contexts)){
    const {publicKey,privateKey} = generateKeyPairSync('ed25519');
    trust.issuers[role] = {role,merchant_ids:[merchant],networks:['solana:fixture'],
      public_key:Buffer.from(publicKey.export({format:'jwk'}).x,'base64url').toString('hex')};
    const url = 'https://evidence.issuer.example/' + role;
    trust.https_sources[role] = {url};
    const bytes = Buffer.from(JSON.stringify({context,issuer:role,environment:'test',
      snapshot_id:snapshot,observed_at:1795564800,rows:[]}));
    envelopes.set(url,{issuer:role,payload:bytes.toString('base64url'),
      signature:sign(null,bytes,privateKey).toString('base64url')});
  }
  const approvalFile=join(directory,'approval.json'), registryFile=join(directory,'trust.json');
  await writeFile(approvalFile,JSON.stringify(approval),{mode:0o600});
  await writeFile(registryFile,JSON.stringify(trust),{mode:0o600});
  let calls=0, failEvidence=true;
  let started, resume;
  const feedStarted=new Promise(resolve=>{ started=resolve; });
  const continueFeed=new Promise(resolve=>{ resume=resolve; });
  const options = {
    feedOptions:{
      now:Date.parse('2026-11-25T03:00:00Z'),
      resolve:async () => ['93.184.215.14'],
      request:async (url) => {
        assert.equal(url.href,approval.feed_url);
        calls++;
        if(!failEvidence){
          started();
          await continueFeed;
        }
        return Object.assign(Readable.from([Buffer.from(JSON.stringify(manifest))]),
          {statusCode:200,headers:{'content-type':'application/json'}});
      }
    },
    evidenceOptions:{
      fetchImpl:async (url,settings) => {
        calls++;
        assert.equal(settings.redirect,'error');
        return failEvidence?new Response(null,{status:503}):Response.json(envelopes.get(url));
      }
    }
  };
  const review = () => runPartnerReview(approvalFile,registryFile,snapshot,directory,options);
  await assert.rejects(review(),/acquisition failed/);
  assert.deepEqual((await readdir(directory)).sort(),['approval.json','trust.json']);
  failEvidence=false;
  const pending = review();
  await feedStarted;
  try {
    await assert.rejects(review(),{code:'EEXIST'});
  } finally {
    resume();
    await pending;
  }
  const reportPath=join(directory,snapshot+'.json');
  assert.equal((await stat(reportPath)).mode & 0o777,0o600);
  const report=JSON.parse(await readFile(reportPath,'utf8'));
  assert.equal(report.merchant_feed.upsert_payload.offers[0].gtin,'4901234567894');
  assert.equal(report.reconciliation.scope,'test_only');
  assert.equal(report.reconciliation.evidence,'signed_pinned_sources');
  const beforeReplay=calls;
  assert.equal((await review()).status,'already_reviewed');
  assert.equal(calls,beforeReplay);
} finally {
  await rm(directory,{recursive:true,force:true});
}
console.log('PASS partner review atomicity, failure recovery, concurrency, and replay without network');
