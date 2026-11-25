import assert from 'node:assert/strict';
import {reconcileGpd33Evidence} from '../scripts/gpd33_reconcile.mjs';

const handoffId = '00000000-0000-4000-8000-000000000001';
const merchantId = '00000000-0000-4000-8000-000000000002';
const orderReference = {merchant_id:merchantId, handoff_id:handoffId, order_reference_hash:'a'.repeat(64)};
const account = {network:'solana:fixture', asset:'USDC_fixture', payer:'merchant_wallet', payee:'operator_wallet'};
const invoiceId = 'invoice_fixture';
const fees = [{...orderReference, ...account, environment:'test', invoice_id:invoiceId,
  agreement_id:'external_contract_reference', approval:'contract_verified', amount_atomic:'9007199254740993'}];
const receipt = {...account, environment:'test', handoff_id:handoffId, invoice_id:invoiceId, transfer_id:'tx_fixture#0',
  category:'brokerage_fee', direction:'credit', verification:'finalized_ledger', amount_atomic:fees[0].amount_atomic};
const baseline = {
  environment:'test', schema_version:1,
  handoffs:[{...orderReference, environment:'test', state:'order_reported'}],
  orders:[{...orderReference, environment:'test', source:'merchant_order_ledger', record_id:'external_order',
    state:'confirmed', verification:'authoritative_ledger'}],
  fees, receipts:[receipt]
};
const assess = updates => reconcileGpd33Evidence({...baseline,...updates});
let report = assess({receipts:[receipt, structuredClone(receipt)]});
assert.equal(report.scope,'test_only');
assert.equal(report.confirmed_orders,1);
assert.equal(report.results[0].brokerage_fee,'matched');
assert.deepEqual(report.matched_brokerage_fee_atomic, {'solana:fixture|USDC_fixture':'9007199254740993'});
assert.equal(assess({environment:'live'}).confirmed_orders,0);
assert.equal(assess({orders:[{...baseline.orders[0],verification:'unverified'}]}).confirmed_orders,0);
assert.equal(assess({orders:[{...baseline.orders[0],order_reference_hash:'b'.repeat(64)}]}).confirmed_orders,0);
assert.equal(assess({receipts:[{...receipt,category:'x402_information'}]}).results[0].brokerage_fee,'unpaid');
assert.equal(assess({receipts:[{...receipt,category:'goods_payment'}]}).results[0].brokerage_fee,'unpaid');
assert.equal(assess({receipts:[{...receipt,payee:'another_wallet'}]}).results[0].brokerage_fee,'receipt_mismatch');
assert.equal(assess({receipts:[{...receipt,amount_atomic:'1'}]}).results[0].brokerage_fee,'underpaid');
assert.equal(assess({fees:[{...fees[0],approval:'unverified'}]}).results[0].brokerage_fee,'missing_agreement');
assert.equal(assess({fees:[...fees,{...fees[0],invoice_id:'other_invoice'}]}).results[0].brokerage_fee,'ambiguous_agreement');
assert.equal(assess({receipts:[receipt,{...receipt,amount_atomic:'1'}]}).results[0].brokerage_fee,'conflicting_evidence');
const secondHandoff = '00000000-0000-4000-8000-000000000003';
assert.equal(assess({handoffs:[...baseline.handoffs,{...baseline.handoffs[0],handoff_id:secondHandoff}]}).confirmed_orders,0);
const cancellation = {handoffs:[{...baseline.handoffs[0],state:'cancelled'}],orders:[{...baseline.orders[0],state:'cancelled'}]};
assert.equal(assess({handoffs:cancellation.handoffs}).results[0].brokerage_fee,'conflicting_order_state');
assert.equal(assess(cancellation).results[0].brokerage_fee,'refund_pending');
const refund = {...receipt, transfer_id:'refund_fixture#0', direction:'refund', payer:receipt.payee, payee:receipt.payer};
report = assess({...cancellation,receipts:[receipt,refund,refund]});
assert.equal(report.cancelled_orders,1);
assert.equal(report.results[0].brokerage_fee,'refunded');
assert.deepEqual(report.matched_brokerage_fee_atomic,{});
assert.throws(() => assess({receipts:[{...receipt,amount_atomic:12}]}), /Invalid evidence record/);
assert.throws(() => assess({receipts:[{...receipt,environment:'production?'}]}), /Invalid evidence record/);
console.log('PASS isolated order evidence, fee receipts, environment separation, conflicts, cancellations and refunds');
