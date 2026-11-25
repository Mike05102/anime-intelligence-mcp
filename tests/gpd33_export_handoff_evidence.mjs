import assert from 'node:assert/strict';
import {generateKeyPairSync, sign} from 'node:crypto';
import {mkdtemp, readdir, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {exportGpd33SignedHandoffEvidence,saveGpd33HandoffEnvelope} from '../scripts/gpd33_export_handoff_evidence.mjs';
import {exportGpd33CompletedDomainSignal} from '../scripts/gpd33_reconcile_domain_signal.mjs';

const handoff = '00000000-0000-4000-8000-000000000010';
const merchant = '00000000-0000-4000-8000-000000000020';
const snapshot = '00000000-0000-4000-8000-000000000030';
const observed = 1795656000;
const environment = 'test';
const contexts = {
  handoffs:'gpd33-handoffs-v1',orders:'gpd33-external-order-ledger-v1',
  fees:'gpd33-agreed-fees-v1',receipts:'gpd33-finalized-settlement-v1'
};
const keys = Object.fromEntries(Object.keys(contexts).map(role => [role,generateKeyPairSync('ed25519')]));
const trust = {schema_version:1,environment,issuers:Object.fromEntries(Object.entries(keys).map(([role,key]) => [role,{
  role,merchant_ids:[merchant],networks:['solana:fixture'],
  public_key:Buffer.from(key.publicKey.export({format:'jwk'}).x,'base64url').toString('hex')
}]))};
const fixtureBinding = {handoff_id:handoff,merchant_id:merchant,order_reference_hash:'a'.repeat(64)};
const ledger = {...fixtureBinding,environment,source:'fixture_orders',record_id:'fixture_record',
  state:'confirmed',confirmed_at:observed-60};
const fee = {...fixtureBinding,environment,invoice_id:'fixture_invoice',agreement_id:'fixture_agreement',
  network:'solana:fixture',asset:'fixture_usdc',amount_atomic:'7000',payer:'merchant_fixture',payee:'platform_fixture',
  contract_state:'executed'};
const receipt = {...fee,direction:'credit',verification:'ignored',category:'brokerage_fee',
  settlement_state:'finalized',transfer_id:'fixture_transfer'};
function issuerEnvelope(issuer,rows) {
  const json = Buffer.from(JSON.stringify({context:contexts[issuer],issuer,environment,
    snapshot_id:snapshot,observed_at:observed,rows}));
  return {issuer,payload:json.toString('base64url'),signature:sign(null,json,keys[issuer].privateKey).toString('base64url')};
}
const orders = {schema_version:1,environment,envelopes:[issuerEnvelope('orders',[ledger,ledger])]};
const key = keys.handoffs.privateKey.export({format:'jwk'});
let calls = 0;
const loadRows = async authorized => {
  calls++;
  assert.deepEqual(authorized,{observed_at:observed,bindings:[fixtureBinding]});
  return {ok:true,rows:[{...fixtureBinding,state:'order_reported',product_domain:'tools_hardware',
    catalog_identity:'verified_canonical',private_field:'must_not_export'}]};
};
const exported = await exportGpd33SignedHandoffEvidence(orders,trust,'handoffs',snapshot,key,{loadRows});
assert.deepEqual(await exportGpd33SignedHandoffEvidence(orders,trust,'handoffs',snapshot,key,{loadRows}),exported);
assert.equal(calls,2);
assert.doesNotMatch(Buffer.from(exported.payload,'base64url').toString(), /private_field|fixture_orders/);
const bundle = {...orders,envelopes:[exported,...orders.envelopes,issuerEnvelope('fees',[fee]),issuerEnvelope('receipts',[receipt])]};
const aggregate = exportGpd33CompletedDomainSignal(bundle,trust,snapshot);
assert.deepEqual(aggregate.counts_by_domain,{tools_hardware:{confirmed_orders:1,reconciled_invoices:1}});
assert.equal(aggregate.environment,'test');

const forged = {...orders,envelopes:[{...orders.envelopes[0],signature:'a'.repeat(86)}]};
await assert.rejects(exportGpd33SignedHandoffEvidence(forged,trust,'handoffs',snapshot,key,{loadRows}), /signed encoding|signature/);
await assert.rejects(exportGpd33SignedHandoffEvidence(orders,trust,'handoffs',merchant,key,{loadRows}), /does not match/);
await assert.rejects(exportGpd33SignedHandoffEvidence(orders,trust,'handoffs',snapshot,
  keys.fees.privateKey.export({format:'jwk'}),{loadRows}), /does not match the pinned/);
const conflict = {...orders,envelopes:[issuerEnvelope('orders',[ledger,{...ledger,order_reference_hash:'b'.repeat(64)}])]};
await assert.rejects(exportGpd33SignedHandoffEvidence(conflict,trust,'handoffs',snapshot,key,{loadRows}), /Conflicting authorized/);
const bulk = Array.from({length:101},(_,n) => ({...ledger,
  handoff_id:'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),record_id:'fixture_'+n}));
const tooMany = {...orders,envelopes:[issuerEnvelope('orders',bulk)]};
await assert.rejects(exportGpd33SignedHandoffEvidence(tooMany,trust,'handoffs',snapshot,key,{loadRows}), /Too many authorized/);
const foreign = async () => ({ok:true,rows:[{...fixtureBinding,merchant_id:handoff,state:'order_reported',
  product_domain:'tools_hardware',catalog_identity:'verified_canonical'}]});
await assert.rejects(exportGpd33SignedHandoffEvidence(orders,trust,'handoffs',snapshot,key,{loadRows:foreign}), /outside authorized/);
assert.equal(calls,2,'Invalid bindings or keys never reach the trusted read-only loader');

const temp = await mkdtemp(join(tmpdir(),'gpd-handoff-export-'));
try{
  assert.equal(await saveGpd33HandoffEnvelope(exported,temp),'exported');
  assert.equal(await saveGpd33HandoffEnvelope(exported,temp),'already_exported');
  await assert.rejects(saveGpd33HandoffEnvelope({...exported,signature:'tampered'},temp), /different evidence envelope/);
  const file = join(temp,'handoffs.json');
  assert.equal((await stat(file)).mode & 0o777,0o600);
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')),exported);
  assert.deepEqual(await readdir(temp),['handoffs.json']);
}finally{
  await rm(temp,{recursive:true,force:true});
}
console.log('PASS authorized read-only handoff export, pinned issuer, aggregation and atomic replay');
