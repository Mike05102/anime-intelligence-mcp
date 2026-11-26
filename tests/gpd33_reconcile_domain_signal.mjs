import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash, generateKeyPairSync, sign} from 'node:crypto';
import {mkdtemp,open,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareGpd33GrowthEvidence} from '../scripts/gpd33_apply_growth_evidence.mjs';
import {exportGpd33CompletedDomainSignal} from '../scripts/gpd33_reconcile_domain_signal.mjs';

const snapshot = '00000000-0000-4000-8000-000000000001';
const merchant = '00000000-0000-4000-8000-000000000002';
const timestamp = 1795590000;
const now = () => timestamp * 1000;
const contexts = {
  handoffs:'gpd33-handoffs-v1', orders:'gpd33-external-order-ledger-v1',
  fees:'gpd33-agreed-fees-v1', receipts:'gpd33-finalized-settlement-v1'
};
function exporter(environment,roles=Object.keys(contexts)) {
  const keys = Object.fromEntries(roles.map(role => [role,generateKeyPairSync('ed25519')]));
  const trust = {schema_version:1,environment,issuers:Object.fromEntries(Object.entries(keys).map(([role,key]) => [
    role,{role,merchant_ids:[merchant],networks:['solana:fixture'],
      public_key:Buffer.from(key.publicKey.export({format:'jwk'}).x,'base64url').toString('hex')}
  ]))};
  return (orders, expected = snapshot, mockNow = now, handle = exportGpd33CompletedDomainSignal) => {
    const envelopes = roles.map(issuer => {
      const context=contexts[issuer];
      const payload = Buffer.from(JSON.stringify({context,issuer,environment,snapshot_id:snapshot,observed_at:timestamp,
        rows:orders.flatMap(order => order[issuer]).map(row => ({...row,environment}))}));
      return {issuer,payload:payload.toString('base64url'),
        signature:sign(null,payload,keys[issuer].privateKey).toString('base64url')};
    });
    return handle({schema_version:1,environment,envelopes},trust,expected,{now:mockNow});
  };
}
const testSignal = exporter('test');
const liveSignalFixture = exporter('live');
const reusables = {merchant_id:merchant};
function order(index, domain='home_living', confirmedAt=timestamp-3600) {
  const handoff_id = '00000000-0000-4000-8001-' + String(index).padStart(12,'0');
  const order_reference_hash = createHash('sha256').update(String(index)).digest('hex');
  const privateOrder = {...reusables,handoff_id,order_reference_hash};
  const invoice = {handoff_id,invoice_id:'fixture_invoice_' + index,network:'solana:fixture',
    asset:'fixture_usdc',amount_atomic:'1000',payer:'fixture_merchant',payee:'fixture_operator'};
  return {
    handoffs:[{...privateOrder,state:'order_reported',catalog_identity:'verified_canonical',product_domain:domain}],
    orders:[{...privateOrder,state:'confirmed',confirmed_at:confirmedAt,record_id:'fixture_order_' + index,
      source:'fixture_order_ledger'}],
    fees:[{...invoice,...reusables,agreement_id:'fixture_agreement',contract_state:'executed'}],
    receipts:[{...invoice,transfer_id:'fixture_transaction_' + index,category:'brokerage_fee',
      direction:'credit',settlement_state:'finalized'}]
  };
}

const all = Array.from({length:12},(_,index) => order(index));
const duplicate = structuredClone(all[0]);
const older = order(20,'food_grocery',timestamp-604801);
const future = order(21,'food_grocery',timestamp+1);
const noClassification = order(22,'food_grocery');
delete noClassification.handoffs[0].catalog_identity;
const conflict = order(23,'food_grocery');
conflict.handoffs.push({...conflict.handoffs[0],product_domain:'tools_hardware'});
const noReceipt = order(24,'food_grocery');
noReceipt.receipts[0].category='x402_information';
const cancellation = order(25,'food_grocery');
cancellation.handoffs[0].state='cancelled';
cancellation.orders[0].state='cancelled';
const incorrectDate = order(26,'food_grocery');
incorrectDate.orders[0].confirmed_at=undefined;
const outsideTaxonomy = order(27,'specialist_parts');
const externalOnly = order(28,'food_grocery');
delete externalOnly.handoffs[0].product_domain;
externalOnly.orders[0].product_domain='food_grocery';
const contestedTime = order(29,'food_grocery');
contestedTime.orders.push({...contestedTime.orders[0],confirmed_at:timestamp-2});
const signal = testSignal([...all,duplicate,older,future,noClassification,conflict,noReceipt,cancellation,incorrectDate,
  outsideTaxonomy,externalOnly,contestedTime]);
assert.deepEqual(signal,{
  schema:'gpd33-completed-domain-signal-v1', environment:'test', snapshot_id:snapshot, observed_at:timestamp,
  counts_by_domain:{food_grocery:{confirmed_orders:1,reconciled_invoices:0},home_living:{confirmed_orders:10,reconciled_invoices:0}}
});
assert.deepEqual(testSignal([all[0],duplicate]).counts_by_domain,{home_living:{confirmed_orders:1,reconciled_invoices:0}});
assert.match(JSON.stringify(signal),/^((?!fixture_).)*$/);
assert.throws(() => testSignal(all,merchant), /snapshot does not match/);
assert.throws(() => liveSignalFixture(all,snapshot,() => (timestamp+86401)*1000), /outside the accepted time window/);
assert.equal(liveSignalFixture([],snapshot,now).environment,'live');

const orderOnlyFixture = exporter('test',['handoffs','orders']);
assert.deepEqual(orderOnlyFixture([all[0]]).counts_by_domain,{home_living:{confirmed_orders:1,reconciled_invoices:0}});
assert.deepEqual(orderOnlyFixture([cancellation]).counts_by_domain,{});
const conflictingInvoices = structuredClone(all[0]);
conflictingInvoices.fees.push({...conflictingInvoices.fees[0],invoice_id:'unrelated_invoice'});
assert.deepEqual(testSignal([conflictingInvoices]).counts_by_domain,orderOnlyFixture([all[0]]).counts_by_domain);

const liveOrderOnlyFixture = exporter('live',['handoffs','orders']);
await orderOnlyFixture([all[0]],snapshot,now,async (bundle,trust,expected) => {
  const staging=await mkdtemp(join(tmpdir(),'gpd-order-quality-'));
  try {
    const trustFile=join(staging,'trust.json');
    await writeFile(trustFile,JSON.stringify(trust),{mode:0o600});
    for (const envelope of bundle.envelopes) {
      await writeFile(join(staging,envelope.issuer+'.json'),JSON.stringify(envelope),{mode:0o600});
    }
    const command=fileURLToPath(new URL('../scripts/gpd33_apply_growth_evidence.mjs',import.meta.url));
    const stdoutPath=join(staging,'preview.json');
    const stdout=await open(stdoutPath,'wx',0o600);
    let run;
    try {
      run=spawnSync(process.execPath,[command,'--staged',staging,trustFile,expected],
        {env:{},stdio:['ignore',stdout.fd,'inherit'],timeout:5000});
    } finally{
      await stdout.close();
    }
    assert.equal(run.status,0,run.error?.message);
    assert.deepEqual(JSON.parse(await readFile(stdoutPath,'utf8')),{status:'preview',environment:'test',
      domain_counts:{home_living:{confirmed_orders:1,reconciled_invoices:0}}});
  }finally{
    await rm(staging,{recursive:true,force:true});
  }
});

const applyFixture=(replayed)=>liveOrderOnlyFixture([all[0]],snapshot,now,(bundle,trust,expected,options)=>
  prepareGpd33GrowthEvidence(bundle,trust,expected,{...options,apply:true,ingest:async(payload)=>{
    assert.deepEqual(payload,{snapshot_id:snapshot,observed_at:timestamp,environment:'live',
      domain_counts:{home_living:{confirmed_orders:1,reconciled_invoices:0}}});
    return {ok:true,replayed};
  }}));
assert.equal((await applyFixture(false)).status,'applied');
assert.equal((await applyFixture(true)).status,'already_applied');

const release = await readFile(new URL('../releases/GPD33_0_COMPLETE_WORKER.js',import.meta.url),'utf8');
const domainDefinition = release.match(/const UNIVERSAL_GENERIC_DOMAINS=\[([\s\S]+?)\];/)[1];
const domains = domainDefinition.match(/"([a-z_]+)"/g).map(value => value.slice(1,-1)).sort();
assert.equal(domains.length,24);
assert.deepEqual(Object.keys(testSignal(domains.map((domain,index) => order(index,domain))).counts_by_domain),domains);
console.log('PASS signed recent domain outcomes, bounded counts, environment separation and release taxonomy');
