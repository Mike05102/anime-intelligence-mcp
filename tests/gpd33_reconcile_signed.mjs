import assert from 'node:assert/strict';
import {generateKeyPairSync, sign} from 'node:crypto';
import {reconcileSignedGpd33Evidence} from '../scripts/gpd33_reconcile_signed.mjs';

const handoffId = '00000000-0000-4000-8000-000000000001';
const merchantId = '00000000-0000-4000-8000-000000000002';
const snapshotId = '00000000-0000-4000-8000-000000000003';
const environment = 'test';
const merchantOrder = {environment,handoff_id:handoffId,merchant_id:merchantId,order_reference_hash:'a'.repeat(64)};
const commission = {environment,handoff_id:handoffId,invoice_id:'fixture_fee',network:'solana:test-fixture',asset:'fixture_usdc',
  amount_atomic:'12345',payer:'merchant_wallet',payee:'operator_wallet'};
const rows = {
  handoffs:[{...merchantOrder,state:'order_reported'}],
  orders:[{...merchantOrder,source:'fixture_ledger',record_id:'order_1',state:'confirmed'}],
  fees:[{...commission,merchant_id:merchantId,agreement_id:'test_contract',contract_state:'executed'}],
  receipts:[{...commission,transfer_id:'test_tx#0',category:'brokerage_fee',direction:'credit',settlement_state:'finalized'}]
};
const contexts = {
  handoffs:'gpd33-handoffs-v1',orders:'gpd33-external-order-ledger-v1',
  fees:'gpd33-agreed-fees-v1',receipts:'gpd33-finalized-settlement-v1'
};
const roles = Object.keys(contexts);
const keyPairs = Object.fromEntries(roles.map(role => [role,generateKeyPairSync('ed25519')]));
const trust = {schema_version:1,environment,issuers:Object.fromEntries(roles.map(role => [role,{
  role, merchant_ids:[merchantId], networks:[commission.network],
  public_key:Buffer.from(keyPairs[role].publicKey.export({format:'jwk'}).x,'base64url').toString('hex')
}]))};
const seal = (role, overrides = {}, signer = role) => {
  const body = Buffer.from(JSON.stringify({context:contexts[role],issuer:role,environment,
    snapshot_id:snapshotId,observed_at:1795590000,rows:rows[role],...overrides}));
  return {issuer:role,payload:body.toString('base64url'),
    signature:sign(null,body,keyPairs[signer].privateKey).toString('base64url')};
};
const baseline = {schema_version:1,environment,envelopes:roles.map(role => seal(role))};
const swap = (role, envelope) => ({...baseline,envelopes:baseline.envelopes.map(item => item.issuer === role ? envelope : item)});
const reconcile = bundle => reconcileSignedGpd33Evidence(bundle,trust);
const report = reconcile(baseline);
assert.equal(report.scope,'test_only');
assert.equal(report.evidence,'signed_pinned_sources');
assert.equal(report.confirmed_orders,1);
assert.deepEqual(report.matched_brokerage_fee_atomic,{'solana:test-fixture|fixture_usdc':'12345'});
assert.equal(report.snapshot_id,snapshotId);
assert.equal(reconcile(swap('receipts',seal('receipts',{rows:[]}))).results[0].brokerage_fee,'unpaid');
assert.throws(() => reconcile({...baseline,envelopes:baseline.envelopes.slice(0,-1)}), /Required evidence issuer/);
assert.throws(() => reconcile(swap('orders',seal('orders',{},'handoffs'))), /Invalid evidence signature/);
assert.throws(() => reconcile(swap('orders',seal('orders',{context:contexts.handoffs}))), /Invalid signed snapshot/);
assert.throws(() => reconcile(swap('orders',seal('orders',{issuer:'bogus'}))), /Invalid signed snapshot/);
assert.throws(() => reconcile(swap('orders',seal('orders',{observed_at:1795590001}))), /different snapshots/);
assert.throws(() => reconcile(swap('orders',seal('orders',{rows:[{...rows.orders[0], merchant_id:snapshotId}]}))), /outside issuer scope/);
assert.throws(() => reconcile(swap('receipts',seal('receipts',{rows:[{...rows.receipts[0], network:'solana:untrusted'}]}))), /outside issuer scope/);
assert.throws(() => reconcile(swap('receipts',seal('receipts',{rows:[{...rows.receipts[0], settlement_state:'pending'}]}))), /unfinalized/);
assert.throws(() => reconcile(swap('fees',seal('fees',{rows:[{...rows.fees[0], contract_state:'draft'}]}))), /unexecuted/);
assert.throws(() => reconcile(swap('orders',seal('orders',{rows:[{...rows.orders[0],environment:'live'}]}))), /Invalid signed snapshot/);
assert.throws(() => reconcile({...baseline,environment:'live'}), /Environment trust policy/);
assert.throws(() => reconcileGpd33EvidenceFromLiveReclassification(), /Invalid signed snapshot/);
function reconcileGpd33EvidenceFromLiveReclassification() {
  return reconcileSignedGpd33Evidence({...baseline,environment:'live'},{...trust,environment:'live'});
}
const duplicated = structuredClone(trust);
duplicated.issuers.orders.public_key = duplicated.issuers.handoffs.public_key;
assert.throws(() => reconcileSignedGpd33Evidence(baseline,duplicated), /reused issuer key/);
const tampered = structuredClone(baseline.envelopes[1]);
tampered.payload = Buffer.from(Buffer.from(tampered.payload,'base64url').toString().replace('confirmed','cancelled')).toString('base64url');
assert.throws(() => reconcile(swap('orders',tampered)), /Invalid evidence signature/);
console.log('PASS signed external evidence intake, source roles, scope, completeness and tamper resistance');
