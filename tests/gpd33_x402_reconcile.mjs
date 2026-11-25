import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {reconcileSignedGpd33X402Evidence} from '../scripts/gpd33_x402_reconcile.mjs';

const snapshot = '00000000-0000-4000-8000-000000000010';
const observed_at = 1795656000;
const payment_network = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const payee = '1'.repeat(31)+'2';
const transaction_hash = '1'.repeat(63)+'2';
const x402_reconciliation_v1 = {mint,payee};
const contexts = {
  x402_expected:'gpd33-x402-information-expected-v1',
  x402_finalized:'gpd33-x402-solana-finalized-v1'
};
const roles = Object.keys(contexts);
const asset = payment_network+'|'+mint;
const expected = {payment_network,transaction_hash,amount_atomic:'9007199254740993',
  event_type:'paid_call',metadata:{x402_reconciliation_v1}};
const finalized = {payment_network,transaction_hash,amount_atomic:expected.amount_atomic,mint,payee,
  instruction_index:'0.1',finality:'finalized',execution:'success'};

function createFixture(environment) {
  const keys = Object.fromEntries(roles.map(role => [role,generateKeyPairSync('ed25519')]));
  const trust = {schema_version:1,environment,issuers:Object.fromEntries(roles.map(role => [role,{
    role,public_key:Buffer.from(keys[role].publicKey.export({format:'jwk'}).x,'base64url').toString('hex')
  }]))};
  const seal = (role,rows,overrides={}) => {
    const bytes = Buffer.from(JSON.stringify({context:contexts[role],issuer:role,environment,snapshot_id:snapshot,
      observed_at,rows:rows.map(row => ({environment,...row})),...overrides}));
    return {issuer:role,payload:bytes.toString('base64url'),
      signature:sign(null,bytes,keys[role].privateKey).toString('base64url')};
  };
  const evidence = (charges,transfers) => ({schema_version:1,environment,
    envelopes:[seal('x402_expected',charges),seal('x402_finalized',transfers)]});
  return {
    seal,trust,evidence,
    run:(charges,transfers) => reconcileSignedGpd33X402Evidence(evidence(charges,transfers),trust,snapshot)
  };
}
const test = createFixture('test');
const live = createFixture('live');
const report = test.run([expected,expected],[finalized,finalized]);
assert.equal(report.scope,'test_only');
assert.equal(report.evidence,'independent_signed_finalized_solana');
assert.deepEqual(report.transactions,{matched:1,unproved:0,conflicting:0,ambiguous:0,mismatched:0});
assert.deepEqual(report.matched_information_fee_atomic,{[asset]:expected.amount_atomic});
assert.ok(!JSON.stringify(report).includes(payee));
assert.ok(!JSON.stringify(report).includes(transaction_hash));
assert.equal(test.run([expected],[{...finalized,finality:'confirmed'}]).transactions.unproved,1);
assert.equal(test.run([expected],[{...finalized,execution:'failed'}]).transactions.unproved,1);
assert.equal(test.run([expected],[{...finalized,amount_atomic:'1'}]).transactions.mismatched,1);
assert.equal(test.run([expected],[{...finalized,payee:'1'.repeat(31)+'3'}]).transactions.mismatched,1);
assert.equal(test.run([expected],[finalized,{...finalized,instruction_index:1}]).transactions.ambiguous,1);
assert.equal(test.run([expected],[finalized,{...finalized,amount_atomic:'1'}]).transactions.conflicting,1);
assert.equal(test.run([expected,{...expected,amount_atomic:5}],[finalized]).transactions.conflicting,1);
assert.equal(test.run([{...expected,metadata:{}}],[finalized]).unbound_expected_records,1);
assert.equal(live.run([{...expected,metadata:{x402_reconciliation_v1,test_mode:'test_e2e'}}],[finalized]).excluded_test_records,1);
assert.equal(live.run([expected],[finalized]).scope,'supplied_live_evidence_only');
assert.throws(() => live.run([{...expected,payment_network:'solana:devnet'}],[finalized]), /transaction locator/);
assert.throws(() => test.run([expected],[{...finalized,instruction_index:'0.01'}]), /instruction locator/);
assert.throws(() => test.run([{...expected,amount_atomic:'18446744073709551616'}],[finalized]), /token amount/);
assert.throws(() => test.run([{...expected,transaction_hash:'bad'}],[finalized]), /transaction locator/);

const intact = test.evidence([expected],[finalized]);
const tampered = structuredClone(intact);
tampered.envelopes[0].payload = Buffer.from(Buffer.from(tampered.envelopes[0].payload,'base64url').toString()
  .replace(expected.amount_atomic,'2')).toString('base64url');
assert.throws(() => reconcileSignedGpd33X402Evidence(tampered,test.trust,snapshot), /evidence signature/);
assert.throws(() => reconcileSignedGpd33X402Evidence(intact,live.trust,snapshot), /pinned x402/);
assert.throws(() => reconcileSignedGpd33X402Evidence(intact,test.trust,'other'), /snapshot does not match/);
const mixed = {...intact,envelopes:[intact.envelopes[0],test.seal('x402_finalized',[finalized],{observed_at:observed_at+1})]};
assert.throws(() => reconcileSignedGpd33X402Evidence(mixed,test.trust,snapshot), /snapshots do not match/);
const forgedEnvironment = {...intact,envelopes:[intact.envelopes[0],test.seal('x402_finalized',[{...finalized,environment:'live'}])]};
assert.throws(() => reconcileSignedGpd33X402Evidence(forgedEnvironment,test.trust,snapshot), /Invalid signed x402/);
const reusedKey = structuredClone(test.trust);
reusedKey.issuers.x402_finalized.public_key = reusedKey.issuers.x402_expected.public_key;
assert.throws(() => reconcileSignedGpd33X402Evidence(intact,reusedKey,snapshot), /authority/);
console.log('PASS independent finalized x402 information-fee reconciliation and test isolation');
