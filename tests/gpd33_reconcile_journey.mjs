import assert from 'node:assert/strict';
import {reconcileGpd33Evidence} from '../scripts/gpd33_reconcile.mjs';

export async function assertReconciliationFromHandoff(query, handoffId) {
  const persisted = await query(`select jsonb_build_object(
    'handoff_id',id,'merchant_id',merchant_id,'order_reference_hash',order_ref_hash,'state',status
  ) result from public.gpd33_handoffs where id=$1`, [handoffId]);
  assert.ok(['order_reported', 'cancelled'].includes(persisted.state));
  const state = persisted.state === 'cancelled' ? 'cancelled' : 'confirmed';
  const handoff = {...persisted,environment:'test'};
  const fee = {environment:'test',handoff_id:handoffId,merchant_id:persisted.merchant_id,
    network:'solana:fixture', asset:'fixture_usdc', amount_atomic:'100000', payer:'fixture_merchant', payee:'fixture_operator',
    invoice_id:'fixture_invoice', agreement_id:'fixture_contract', approval:'contract_verified'};
  const receipt = {...fee, transfer_id:'fixture_tx#0', category:'brokerage_fee', direction:'credit', verification:'finalized_ledger'};
  const refund = {...receipt, transfer_id:'fixture_refund#0', direction:'refund', payer:fee.payee, payee:fee.payer};
  // Only the GPD handoff is real database state. Contracts, ledger records and transfer finality are fixtures.
  const input = {schema_version:1,environment:'test',handoffs:[handoff],
    orders:[{...handoff, state, source:'fixture_order_ledger', record_id:'fixture_record', verification:'authoritative_ledger'}],
    fees:[fee], receipts:state === 'confirmed' ? [receipt,receipt] : [receipt,refund]};
  const report = reconcileGpd33Evidence(input);
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
