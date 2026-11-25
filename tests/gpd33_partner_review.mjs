import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {generateKeyPairSync, randomUUID, sign} from 'node:crypto';
import {mkdtemp, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {fingerprintPartnerReview,publishApprovedMerchantFeed} from '../scripts/gpd33_merchant_feed_publish.mjs';
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
  let calls=0, feedCalls=0, failEvidence=true;
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
        feedCalls++;
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
  const lockName = '.gpd-partner-review.lock';
  assert.deepEqual((await readdir(directory)).sort(),[lockName,'approval.json','trust.json']);
  const lockPath = join(directory,lockName);
  const lockInode = (await stat(lockPath)).ino;
  assert.equal((await stat(lockPath)).mode & 0o777,0o600);

  const reviewModule = new URL('../scripts/gpd33_partner_review.mjs',import.meta.url).href;
  const readyPath = join(directory,'child-ready');
  const holdReview = `
    import {writeFile} from 'node:fs/promises';
    import {runPartnerReview} from ${JSON.stringify(reviewModule)};
    setInterval(() => {},1000);
    await runPartnerReview(...process.argv.slice(1,-1),{
      feedOptions:{now:Date.parse('2026-11-25T03:00:00Z'),resolve:async () => {
        await writeFile(process.argv.at(-1),'locked',{mode:0o600});
        return new Promise(() => {});
      }},
      evidenceOptions:{fetchImpl:async () => new Promise(() => {})}
    });
  `;
  const worker = spawn(process.execPath,['--input-type=module','-e',holdReview,approvalFile,registryFile,snapshot,directory,readyPath],
    {stdio:['ignore','ignore','inherit']});
  const workerExit = once(worker,'exit');
  const staleName = '.gpd-partner-review-' + randomUUID() + '.tmp';
  try {
    let ready = false;
    for (let attempt = 0; attempt < 200 && worker.exitCode === null; attempt++) {
      const message = await readFile(readyPath,'utf8').catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return '';
      });
      if (message === 'locked') {
        ready = true;
        break;
      }
      await delay(15);
    }
    assert.equal(ready,true,'Review child must acquire its lock');
    await writeFile(join(directory,staleName),'partial',{mode:0o600});
    const beforeContention = calls;
    assert.equal((await review()).status,'review_in_progress');
    assert.equal(calls,beforeContention);
  } finally {
    worker.kill('SIGKILL');
    assert.equal((await workerExit)[1],'SIGKILL');
  }
  failEvidence=false;
  const pending = review();
  await feedStarted;
  try {
    const beforeContention = feedCalls;
    assert.equal((await review()).status,'review_in_progress');
    assert.equal(feedCalls,beforeContention);
  } finally {
    resume();
    await pending;
  }
  const reportPath=join(directory,snapshot+'.json');
  assert.equal((await stat(reportPath)).mode & 0o777,0o600);
  assert.equal((await stat(lockPath)).ino,lockInode);
  assert.ok(!(await readdir(directory)).includes(staleName));
  const report=JSON.parse(await readFile(reportPath,'utf8'));
  assert.equal(report.merchant_feed.upsert_payload.offers[0].gtin,'4901234567894');
  assert.equal(report.reconciliation.scope,'test_only');
  assert.equal(report.reconciliation.evidence,'signed_pinned_sources');
  const permission={schema:'gpd-merchant-feed-write-approval-v1',allow_publish:true,
    snapshot_id:snapshot,merchant_id:merchant,approved_until:approval.approved_until,
    report_sha256:fingerprintPartnerReview(report),worker_origin:'https://gpd.example'};
  let writes=0, publishes=0;
  const publish=()=>publishApprovedMerchantFeed(report,approval,permission,{
    now:options.feedOptions.now,apiKey:'mai_000000000000000000000000fixture',
    receiptDirectory:directory,resolve:async()=> '93.184.215.14',
    request:async (url,settings)=>{
      publishes++;
      let result={ok:true,merchant:{id:merchant,verified:true}};
      if(url.pathname==='/v1/merchant/offers/feed-import'){
        writes++;
        assert.equal(JSON.parse(settings.body).offers[0].gtin,'4901234567894');
        result={ok:true,merchant_id:merchant,offers_received:1,new_or_updated:1,ignored:0};
      }else assert.equal(url.pathname,'/v1/merchant/me');
      return Object.assign(Readable.from([Buffer.from(JSON.stringify(result))]),{
        statusCode:200,headers:{'content-type':'application/json'}
      });
    }
  });
  assert.equal((await publish()).status,'import_confirmed');
  assert.equal((await publish()).status,'already_imported');
  assert.equal(writes,1);
  assert.equal(publishes,2);
  const beforeReplay=calls;
  assert.equal((await review()).status,'already_reviewed');
  assert.equal(calls,beforeReplay);
  await writeFile(approvalFile,JSON.stringify({...approval,approved_until:'2026-12-03T00:00:00Z'}));
  await assert.rejects(review(),/differs from the requested configuration/);
  await writeFile(approvalFile,JSON.stringify(approval));
  await writeFile(reportPath,'invalid-json');
  await assert.rejects(review(),/cached partner review is unreadable/i);
  assert.equal(calls,beforeReplay);

} finally {
  await rm(directory,{recursive:true,force:true});
}
console.log('PASS partner review atomicity, failure recovery, concurrency, and replay without network');
