import assert from 'node:assert/strict';
import {prepareGpd33GrowthEvidence} from '../scripts/gpd33_apply_growth_evidence.mjs';
import {generateKeyPairSync, randomUUID, sign} from 'node:crypto';
import {reconcileSignedGpd33Evidence} from '../scripts/gpd33_reconcile_signed.mjs';
import {exportGpd33SignedHandoffEvidence} from '../scripts/gpd33_export_handoff_evidence.mjs';
import {reconcileGpd33Evidence} from '../scripts/gpd33_reconcile.mjs';

const contexts = {
  handoffs:'gpd33-handoffs-v1', orders:'gpd33-external-order-ledger-v1',
  fees:'gpd33-agreed-fees-v1', receipts:'gpd33-finalized-settlement-v1'
};

async function sealedFixture(input, merchant, network, query) {
  const environment='test', snapshot_id=randomUUID(), observed_at=Math.floor(Date.now()/1000);
  const issuers={}, envelopes=[];
  let handoffKey;
  for(const [role,context] of Object.entries(contexts)){
    const {publicKey,privateKey}=generateKeyPairSync('ed25519');
    issuers[role]={role,merchant_ids:[merchant],networks:[network],
      public_key:Buffer.from(publicKey.export({format:'jwk'}).x,'base64url').toString('hex')};
    if(role==='handoffs'){
      handoffKey=privateKey.export({format:'jwk'});
      continue;
    }
    const payload=Buffer.from(JSON.stringify({context,issuer:role,environment,snapshot_id,observed_at,rows:input[role]}));
    envelopes.push({issuer:role,payload:payload.toString('base64url'),
      signature:sign(null,payload,privateKey).toString('base64url')});
  }
  const bundle={schema_version:1,environment,envelopes};
  const trust={schema_version:1,environment,issuers};
  const handoffEnvelope=await exportGpd33SignedHandoffEvidence(
    {...bundle,envelopes:envelopes.filter(envelope=>envelope.issuer==='orders')},
    trust,'handoffs',snapshot_id,handoffKey,{
      loadRows:({observed_at,bindings})=>query(
        'select public.gpd33_export_handoff_evidence($1,$2::jsonb) result',[observed_at,JSON.stringify(bindings)])
    });
  envelopes.push(handoffEnvelope);
  return {bundle,trust,snapshot:snapshot_id};
}

export async function assertReconciliationFromHandoff(query, handoffId) {
  const persisted = await query(`select jsonb_build_object(
    'handoff_id',h.id,'merchant_id',h.merchant_id,'order_reference_hash',h.order_ref_hash,'state',h.status,
    'product_domain',b.catalog_domain,'catalog_identity','verified_canonical'
  ) result from public.gpd33_handoffs h join public.gpd33_buyer_handoffs b on b.handoff_id=h.id where h.id=$1`, [handoffId]);
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
    orders:[{...handoff, state, confirmed_at:Math.floor(Date.now()/1000)-60,
      source:'fixture_order_ledger', record_id:'fixture_record', verification:'authoritative_ledger'}],
    fees:[fee], receipts:state === 'confirmed' ? [receipt,receipt] : [receipt,refund]};
  const {bundle,trust,snapshot}=await sealedFixture(input,persisted.merchant_id,fee.network,query);
  const report=reconcileSignedGpd33Evidence(bundle,trust);
  const growth=await prepareGpd33GrowthEvidence(bundle,trust,snapshot);
  assert.equal(growth.status,'preview');
  assert.deepEqual(growth.domain_counts,state==='confirmed'
    ?{food_grocery:{confirmed_orders:1,reconciled_invoices:1}}:{});
  await assert.rejects(prepareGpd33GrowthEvidence(bundle,trust,snapshot,{
    apply:true,ingest:async()=>assert.fail('Test evidence must never reach the ingest adapter')
  }),/Live signed evidence/);
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
