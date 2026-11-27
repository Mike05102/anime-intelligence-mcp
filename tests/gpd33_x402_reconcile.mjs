import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {chmod,mkdtemp,readdir,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {reconcileSignedGpd33X402Evidence,reconcileSignedGpd33X402Window,recordGpd33X402Window,saveGpd33X402WindowReport} from '../scripts/gpd33_x402_reconcile.mjs';

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
  const evidence = (charges,transfers,overrides={}) => ({schema_version:1,environment,
    envelopes:[seal('x402_expected',charges,overrides),seal('x402_finalized',transfers,overrides)]});
  return {
    seal,trust,evidence,
    run:(charges,transfers) => reconcileSignedGpd33X402Evidence(evidence(charges,transfers),trust,snapshot)
  };
}
const test = createFixture('test');
const live = createFixture('live');
const report = test.run([expected,expected],[finalized,finalized]);
const buyer='1'.repeat(31)+'3';
const refundHash='1'.repeat(63)+'3';
const refund={event_type:'x402_refund',payment_network,transaction_hash:refundHash,
  original_transaction_hash:transaction_hash,amount_atomic:'30'};
const originalWithPayer={...finalized,payer:buyer};
const refundTransfer={...finalized,transaction_hash:refundHash,payer:payee,payee:buyer,amount_atomic:'30'};
const paidAndRefunded=test.run([expected,refund,refund],[originalWithPayer,refundTransfer]);
for (const transfers of [[finalized,originalWithPayer],[originalWithPayer,finalized]]) {
  const enriched=test.run([expected,refund],[...transfers,refundTransfer]);
  assert.deepEqual(enriched.matched_refund_atomic,{[asset]:'30'});
}
const conflictingPayer=test.run([expected,refund],[
  originalWithPayer,{...originalWithPayer,payer:payee},refundTransfer
]);
assert.equal(conflictingPayer.transactions.conflicting,1);
assert.equal(conflictingPayer.net_matched_information_fee_atomic,null);
assert.deepEqual(paidAndRefunded.matched_refund_atomic,{[asset]:'30'});
assert.deepEqual(paidAndRefunded.refund_transactions,{matched:1,unresolved:0});
assert.deepEqual(paidAndRefunded.net_matched_information_fee_atomic,{[asset]:'9007199254740963'});
const unresolvedRefund=test.run([expected,refund],[originalWithPayer,{...refundTransfer,payer:buyer}]);
assert.equal(unresolvedRefund.refund_transactions.unresolved,1);
assert.equal(unresolvedRefund.net_matched_information_fee_atomic,null);
const overAmount='9007199254740994';
assert.deepEqual(test.run([expected,{...refund,amount_atomic:overAmount}],
  [originalWithPayer,{...refundTransfer,amount_atomic:overAmount}]).matched_refund_atomic,{});
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


const laterSnapshot = '00000000-0000-4000-8000-000000000020';
const requested = {startInclusive:observed_at,endExclusive:observed_at+61};
const first = test.evidence([expected],[{...finalized,finality:'pending'}]);
const later = test.evidence([expected],[finalized],{snapshot_id:laterSnapshot,observed_at:observed_at+60});
const reversed = {...first,envelopes:[...first.envelopes].reverse()};
const windowReport = await reconcileSignedGpd33X402Window([later,first,reversed],test.trust,requested);
assert.equal(windowReport.scope,'test_only');
assert.equal(windowReport.snapshots,2);
assert.equal(windowReport.replayed_snapshots,1);
assert.deepEqual(windowReport.observation_window,{
  start_inclusive:observed_at,end_exclusive:observed_at+61,
  first_observed_at:observed_at,last_observed_at:observed_at+60
});
assert.equal(windowReport.transactions.matched,1);
assert.deepEqual(windowReport.matched_information_fee_atomic,{[asset]:expected.amount_atomic});
assert.ok(!JSON.stringify(windowReport).includes(transaction_hash));
assert.ok(!JSON.stringify(windowReport).includes(payee));
assert.ok(!JSON.stringify(windowReport).includes(laterSnapshot));
const repeatFinalized = test.evidence([expected],[finalized],{snapshot_id:snapshot});
assert.deepEqual((await reconcileSignedGpd33X402Window([repeatFinalized,later],test.trust,requested)).matched_information_fee_atomic,
  {[asset]:expected.amount_atomic});
async function * splitLedger() {
  yield test.evidence([expected],[]);
  yield test.evidence([],[finalized],{snapshot_id:laterSnapshot,observed_at:observed_at+60});
}
assert.equal((await reconcileSignedGpd33X402Window(splitLedger(),test.trust,requested)).transactions.matched,1);
const wrongAgreement = test.evidence([{...expected,amount_atomic:11}],[],
  {snapshot_id:laterSnapshot,observed_at:observed_at+60});
assert.equal((await reconcileSignedGpd33X402Window([repeatFinalized,wrongAgreement],test.trust,requested)).transactions.conflicting,1);
const wrongInstruction = test.evidence([],[{...finalized,amount_atomic:11}],{snapshot_id:laterSnapshot,observed_at:observed_at+60});
assert.equal((await reconcileSignedGpd33X402Window([repeatFinalized,wrongInstruction],test.trust,requested)).transactions.conflicting,1);
const failed = test.evidence([],[{...finalized,execution:'failed'}],{snapshot_id:laterSnapshot,observed_at:observed_at+60});
assert.equal((await reconcileSignedGpd33X402Window([repeatFinalized,failed],test.trust,requested)).transactions.conflicting,1);
const testMarkedLive = live.evidence([{...expected,metadata:{test_mode:'test_e2e'}}],[]);
const unexplainedLive = live.evidence([expected],[finalized],{snapshot_id:laterSnapshot,observed_at:observed_at+60});
const liveResult = await reconcileSignedGpd33X402Window([testMarkedLive,unexplainedLive],live.trust,requested);
assert.equal(liveResult.excluded_test_observations,1);
assert.equal(liveResult.transactions.matched,0);
assert.deepEqual(liveResult.matched_information_fee_atomic,{});
await assert.rejects(reconcileSignedGpd33X402Window([first,repeatFinalized],test.trust,requested), /Conflicting signed x402 snapshot UUID/);
await assert.rejects(reconcileSignedGpd33X402Window([first,later],test.trust,{...requested,endExclusive:observed_at+60}), /outside the requested window/);
await assert.rejects(reconcileSignedGpd33X402Window([first,unexplainedLive],test.trust,requested), /pinned x402/);
await assert.rejects(reconcileSignedGpd33X402Window([first,tampered],test.trust,requested), /signature/);
await assert.rejects(reconcileSignedGpd33X402Window(Array(33).fill(first),test.trust,requested), /Too many/);
await assert.rejects(reconcileSignedGpd33X402Window([],test.trust,requested), /At least one/);
assert.throws(() => test.run([expected],[{...finalized,amount_atomic:'-1'}]), /token amount/);
const reportDirectory=await mkdtemp(join(tmpdir(),'gpd-x402-window-'));
try {
  assert.deepEqual(await recordGpd33X402Window(windowReport,reportDirectory),{status:'reported'});
  const liveDirectory=await mkdtemp(join(reportDirectory,'live-'));
  const liveWindow=await reconcileSignedGpd33X402Window(
    [live.evidence([expected],[finalized])],live.trust,requested);
  const notice=await recordGpd33X402Window(liveWindow,liveDirectory);
  assert.equal(notice.verified_window_activity.gross_usdc,'9007199254.740993');
  assert.equal(notice.verified_window_activity.receipts,1);
  assert.deepEqual(await recordGpd33X402Window(liveWindow,liveDirectory),{status:'already_reported'});
  await rm(liveDirectory,{recursive:true,force:true});
  assert.equal(await saveGpd33X402WindowReport(windowReport,reportDirectory),'already_reported');
  const name='x402-'+observed_at+'-'+(observed_at+61)+'.json';
  const path=join(reportDirectory,name);
  assert.equal((await stat(path)).mode & 0o777,0o600);
  assert.deepEqual(JSON.parse(await readFile(path,'utf8')),windowReport);
  assert.deepEqual(await readdir(reportDirectory),[name]);
  await assert.rejects(saveGpd33X402WindowReport({...windowReport,snapshots:10},reportDirectory), /already exists/);
  await chmod(reportDirectory,0o755);
  await assert.rejects(saveGpd33X402WindowReport(windowReport,reportDirectory), /private output directory/);
} finally {
  await rm(reportDirectory,{recursive:true,force:true});
}
console.log('PASS signed x402 observation-window deduplication, source conflicts, replay and private aggregate output');
