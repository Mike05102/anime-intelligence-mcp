import assert from 'node:assert/strict';
import {generateKeyPairSync, randomUUID, sign} from 'node:crypto';
import {reconcileSignedGpd33Evidence} from '../scripts/gpd33_reconcile_signed.mjs';
import {reconcileGpd33Evidence} from '../scripts/gpd33_reconcile.mjs';

const contexts = {
  handoffs:'gpd33-handoffs-v1', orders:'gpd33-external-order-ledger-v1',
  fees:'gpd33-agreed-fees-v1', receipts:'gpd33-finalized-settlement-v1'
};

function reconcileSignedFixture(input, merchant, network) {
  const environment='test', snapshot_id=randomUUID(), observed_at=Math.floor(Date.now()/1000);
  const issuers={}, envelopes=[];
  for(const [role,context] of Object.entries(contexts)){
    const {publicKey,privateKey}=generateKeyPairSync('ed25519');
    issuers[role]={role,merchant_ids:[merchant],networks:[network],
      public_key:Buffer.from(publicKey.export({format:'jwk'}).x,'base64url').toString('hex')};
    const payload=Buffer.from(JSON.stringify({context,issuer:role,environment,snapshot_id,observed_at,rows:input[role]}));
    envelopes.push({issuer:role,payload:payload.toString('base64url'),
      signature:sign(null,payload,privateKey).toString('base64url')});
  }
  return reconcileSignedGpd33Evidence({schema_version:1,environment,envelopes},
    {schema_version:1,environment,issuers});
}

export async function assertReconciliationFromHandoff(query, handoffId) {
  const persisted = await query(`select jsonb_build_object(
    'handoff_id',id,'merchant_id',merchant_id,'order_reference_hash',order_ref_hash,'state',status
  ) result from public.gpd33_handoffs where id=$1`, [handoffId]);
  assert.ok(['order_reported', 'cancelled'].includes(persisted.state));
  const state = persisted.state === 'cancelled' ? 'cancelled' : 'confirmed';
  const handoff = {...persisted,environment:'test'};
  const fee = {environment:'test',handoff_id:handoffId,merchant_id:persisted.merchant_id,
    network:'solana:fixture', asset:'fixture_usdc', amount_atomic:'100000', payer:'fixture_merchant', payee:'fixture_operator',
    invoice_id:'fixture_invoice', agreement_id:'fixture_contract', approval:'contract_verified',contract_state:'executed'};
  const receipt = {...fee, transfer_id:'fixture_tx#0', category:'brokerage_fee', direction:'credit', verification:'finalized_ledger',settlement_state:'finalized'};
  const refund = {...receipt, transfer_id:'fixture_refund#0', direction:'refund', payer:fee.payee, payee:fee.payer};
  // Only the GPD handoff is real database state. Contracts, ledger records and transfer finality are fixtures.
  const input = {schema_version:1,environment:'test',handoffs:[handoff],
    orders:[{...handoff, state, source:'fixture_order_ledger', record_id:'fixture_record', verification:'authoritative_ledger'}],
    fees:[fee], receipts:state === 'confirmed' ? [receipt,receipt] : [receipt,refund]};
  const report = reconcileSignedFixture(input,persisted.merchant_id,fee.network);
  assert.equal(report.evidence,'signed_pinned_sources');
  assert.equal(report.scope,'test_only');
  if (state === 'confirmed') {
    assert.equal(report.confirmed_orders,1);
    assert.equal(report.results[0].brokerage_fee,'matched');
    assert.deepEqual(report.matched_brokerage_fee_atomic, {'solana:fixture|fixture_usdc':'100000'});
  } else {
    assert.equal(report.cancelled_orders,1);
    assert.equal(report.results[0].brokerage_fee,'refunded');
    assert.deepEqual(report.matched_brokerage_fee_atomic,{});
  }
  assert.equal(reconcileGpd33Evidence({...input,environment:'live'}).confirmed_orders,0);
}
