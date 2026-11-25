import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmod,mkdir,mkdtemp,readFile,rm,stat,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {collectSellerCandidates} from '../scripts/gpd33_seller_discovery.mjs';
import {prepareSellerOptInReview} from '../scripts/gpd33_seller_opt_in.mjs';

const now=Date.parse('2026-11-25T12:00:00Z');
const reportAt='2026-11-25T11:00:00Z',signedAt='2026-11-25T10:59:00Z',expires='2026-12-02T11:00:00Z';
const existing=randomUUID(),unregistered=randomUUID(),merchant=randomUUID();
const keys=Object.fromEntries([existing,unregistered].map(id=>[id,generateKeyPairSync('ed25519')]));
const origin='https://seller.example.com',evidence=origin+'/consent';
const feed=origin+'/ops/offers.json';
const publicHex=key=>Buffer.from(key.publicKey.export({format:'jwk'}).x,'base64url').toString('hex');
const authority={
  name:'Seller Official Name',country_code:'JP',website_url:origin+'/',opt_in_origins:[origin],
  source_ids:['merchant_feed:primary','partner_directory:secondary']
};
const trust={schema:'gpd-seller-opt-in-trust-v1',environment:'test',sellers:{
  [existing]:{...authority,public_key:publicHex(keys[existing]),merchant_id:merchant,feed:{url:feed,product_origins:[origin]}},
  [unregistered]:{...authority,public_key:publicHex(keys[unregistered]),source_ids:['merchant_feed:new']},
}};

const row={source:'merchant_feed',source_seller_id:'primary',public_name:'Untrusted Display Name',
  merchant_country:'JP',evidence_url:origin+'/catalog',observed_at:reportAt,opt_in_evidence_url:evidence,
  opt_in_observed_at:reportAt,email:'person@example.com'};
const discovered=collectSellerCandidates([row,{...row,source_seller_id:'new'},
  {...row,source:'partner_directory',source_seller_id:'secondary'},
  {...row,source:'ebay_browse',source_seller_id:'marketplace'}],now);
const consent={
  context:'gpd-seller-opt-in-v1',environment:'test',seller_id:existing,request_id:randomUUID(),
  scope:'review_feed_connection',country_code:'JP',source:'merchant_feed',source_seller_id:'primary',
  evidence_url:evidence,signed_at:signedAt,expires_at:expires,feed_url:feed
};
function envelope(body=consent,seller=body.seller_id){
  const raw=Buffer.from(JSON.stringify(body));
  return {seller_id:seller,payload:raw.toString('base64url'),signature:sign(null,raw,keys[seller].privateKey).toString('base64url')};
}
const signedMain=envelope();
const signedUnregistered=envelope({...consent,seller_id:unregistered,request_id:randomUUID(),source_seller_id:'new',
  scope:'preview_onboarding',feed_url:null});
const secondary=envelope({...consent,request_id:randomUUID(),source:'partner_directory',source_seller_id:'secondary'});
const stolenSignature={...signedMain,payload:Buffer.from(JSON.stringify({...consent,expires_at:'2026-12-03T10:00:00Z'})).toString('base64url')};
const report=prepareSellerOptInReview(discovered,trust,[
  signedMain,signedMain,signedUnregistered,secondary,
  envelope({...consent,scope:'preview_onboarding',feed_url:null}),
  envelope({...consent,merchant_id:'untrusted-id',feed_url:origin+'/unapproved'}),
  envelope({...consent,environment:'live'}),
  envelope({...consent,seller_id:unregistered}),
  envelope({...consent,country_code:'US'}),
  envelope({...consent,source:'ebay_browse',source_seller_id:'marketplace'}),
  envelope({...consent,source:['merchant_feed']}),
  envelope({...consent,evidence_url:origin+'/other'}),
  envelope({...consent,signed_at:'2026-11-25T12:07:00Z'}),
  envelope({...consent,expires_at:'2026-11-25T11:00:00Z'}),
  envelope({...consent,expires_at:'2027-01-25T00:00:00Z'}),
  stolenSignature
],now);
assert.equal(report.status,'private_preview');
assert.equal(report.environment,'test');
assert.equal(report.candidates.length,2);
assert.equal(report.duplicate_count,2);
assert.equal(report.rejected_count,12);
const feedDraft=report.candidates.find(candidate=>candidate.merchant_id===merchant);
assert.deepEqual(feedDraft.feed_connection_draft,{merchant_id:merchant,feed_url:feed,product_origins:[origin]});
assert.equal(feedDraft.consent_expires_at,expires.replace('00Z','00.000Z'));
assert.ok(!Object.hasOwn(feedDraft.feed_connection_draft,'approved_until'));
const registration=report.candidates.find(candidate=>candidate.seller_id===unregistered);
assert.deepEqual(registration.registration_draft,{name:'Seller Official Name',website_url:origin+'/',country_code:'JP'});
assert.ok(!Object.hasOwn(registration.registration_draft,'accept_terms'));
assert.ok(!Object.hasOwn(registration.registration_draft,'verified'));
assert.ok(!JSON.stringify(report).includes('person@example.com'));
assert.ok(!JSON.stringify(report).includes(signedMain.signature));
assert.ok(!JSON.stringify(report).includes(evidence));

const conflicting=envelope({...consent,expires_at:'2026-12-03T11:00:00Z'});
const conflict=prepareSellerOptInReview(discovered,trust,[conflicting,signedMain,signedUnregistered],now);
assert.equal(conflict.conflicting_sellers,1);
assert.deepEqual(conflict.candidates.map(row=>row.seller_id),[unregistered]);
assert.throws(()=>prepareSellerOptInReview(discovered,{...trust,sellers:{...trust.sellers,
  [unregistered]:{...trust.sellers[unregistered],source_ids:authority.source_ids}
}},[signedMain],now),/trust_invalid/);
assert.throws(()=>prepareSellerOptInReview(discovered,{...trust,sellers:{...trust.sellers,
  [unregistered]:{...trust.sellers[unregistered],public_key:publicHex(keys[existing])}
}},[signedMain],now),/trust_invalid/);
assert.throws(()=>prepareSellerOptInReview(discovered,trust,Array(201).fill(signedMain),now),/input_invalid/);
const directory=await mkdtemp(join(tmpdir(),'gpd-seller-opt-in-'));
try{
  const current=Date.now(),recent=new Date(current-3600000).toISOString();
  const fresh=collectSellerCandidates([{...row,observed_at:recent,opt_in_observed_at:recent}],current);
  const active=envelope({...consent,signed_at:recent,expires_at:new Date(current+86400000).toISOString()});
  const input=['discovery.json','trust.json','signed.json'].map(name=>join(directory,name));
  await Promise.all([fresh,trust,[active]].map((value,i)=>writeFile(input[i],JSON.stringify(value),{mode:0o600})));
  const executable=fileURLToPath(new URL('../scripts/gpd33_seller_opt_in.mjs',import.meta.url));
  const output=join(directory,'review.json');
  const run=(inputs=input,destination=output)=>spawnSync(process.execPath,[executable,...inputs,destination],{encoding:'utf8'});
  const success=run();
  assert.equal(success.status,0,success.stderr);
  assert.equal(success.stdout,'');
  assert.equal((await stat(output)).mode&0o777,0o600);
  assert.equal(JSON.parse(await readFile(output,'utf8')).candidates[0].merchant_id,merchant);
  assert.equal(run().status,2,'existing reports are immutable');
  await symlink(input[1],join(directory,'trust-link.json'));
  assert.equal(run([input[0],join(directory,'trust-link.json'),input[2]],join(directory,'link-out.json')).status,2);
  await chmod(input[1],0o644);
  assert.equal(run(input,join(directory,'nonprivate-input.json')).status,2);
  await chmod(input[1],0o600);
  const publicDir=join(directory,'public-output');
  await mkdir(publicDir,{mode:0o755});
  await chmod(publicDir,0o755);
  assert.equal(run(input,join(publicDir,'review.json')).status,2);
}finally{
  await rm(directory,{recursive:true,force:true});
}
console.log('PASS private seller opt-in signatures, scope, expiry, file permissions and preview-only drafts');
