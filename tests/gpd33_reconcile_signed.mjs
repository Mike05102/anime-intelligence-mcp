import assert from 'node:assert/strict';
import {generateKeyPairSync, sign} from 'node:crypto';
import {mkdtemp, rm, symlink, truncate, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {acquireGpd33Snapshot} from '../scripts/gpd33_reconcile_acquire.mjs';
import {acquireHttpsGpd33Snapshot, assertFreshHttpsGpd33Evidence} from '../scripts/gpd33_reconcile_https.mjs';
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


const staging = await mkdtemp(join(tmpdir(),'gpd33-signed-intake-'));
try {
  const registry = join(staging,'trust.json');
  await writeFile(registry,JSON.stringify(trust),{mode:0o600});
  for (const envelope of baseline.envelopes) {
    await writeFile(join(staging,envelope.issuer+'.json'),JSON.stringify(envelope),{mode:0o600});
  }
  // Files are selected by configured issuer IDs, not by scanning directory contents.
  await writeFile(join(staging,'other.json'),'not an envelope');
  assert.deepEqual(await acquireGpd33Snapshot(staging,registry,snapshotId),report);
  await assert.rejects(acquireGpd33Snapshot(staging,registry,merchantId), /requested snapshot/);
  const badRegistry = {...trust, issuers:{'../unknown':trust.issuers.orders}};
  await writeFile(registry,JSON.stringify(badRegistry));
  await assert.rejects(acquireGpd33Snapshot(staging,registry,snapshotId), /Invalid evidence issuer names/);
  await writeFile(registry,JSON.stringify(trust));

  const receiptsFile = join(staging,'receipts.json');
  await rm(receiptsFile);
  await assert.rejects(acquireGpd33Snapshot(staging,registry,snapshotId), {code:'ENOENT'});
  await symlink(join(staging,'orders.json'),receiptsFile);
  await assert.rejects(acquireGpd33Snapshot(staging,registry,snapshotId), {code:'ELOOP'});
  await rm(receiptsFile);
  await writeFile(receiptsFile,JSON.stringify(seal('orders')));
  await assert.rejects(acquireGpd33Snapshot(staging,registry,snapshotId), /configured issuer/);
  await truncate(receiptsFile,12*1024*1024+1);
  await assert.rejects(acquireGpd33Snapshot(staging,registry,snapshotId), /bounded regular file/);
} finally {
  await rm(staging,{recursive:true,force:true});
}
console.log('PASS read-only acquisition of signed local issuer snapshots and unsafe-file rejection');


const httpsTrust = {...trust, https_sources:Object.fromEntries(roles.map(role => [role,{
  url:'https://evidence.example/snapshots/' + role,
  ...(role === 'receipts' ? {authorization_env:'TEST_LEDGER_TOKEN'} : {})
}]))};
const headers = {'content-type':'application/json; charset=utf-8'};
const calls = [];
const httpsFetch = async (url, init) => {
  const role = new URL(url).pathname.split('/').at(-1);
  calls.push(role);
  assert.equal(init.method,'GET');
  assert.equal(init.redirect,'error');
  assert.equal(init.headers.authorization,role === 'receipts' ? 'Bearer fixture-token' : undefined);
  assert.equal(init.headers['accept-encoding'],'identity');
  return new Response(JSON.stringify(seal(role)),{headers});
};
const httpsOptions = {fetchImpl:httpsFetch,env:{TEST_LEDGER_TOKEN:'fixture-token'}};
assert.deepEqual(await acquireHttpsGpd33Snapshot(httpsTrust,snapshotId,httpsOptions),report);
assert.deepEqual(calls,roles);
await assert.rejects(acquireHttpsGpd33Snapshot(httpsTrust,merchantId,httpsOptions), /requested snapshot/);
const rejectedSource = url => ({
  ...httpsTrust, https_sources:{...httpsTrust.https_sources,handoffs:{url}}
});
for (const url of ['http://evidence.example/handoffs','https://user:secret@evidence.example/handoffs','https://127.0.0.1/handoffs',
  'https://ledger.internal/handoffs','https://evidence.example/handoffs?access_token=mock',
  'https://evidence.example:444/handoffs','https://evidence.example/snapshots/orders']) {
  const prior = calls.length;
  await assert.rejects(acquireHttpsGpd33Snapshot(rejectedSource(url),snapshotId,httpsOptions), /Invalid or repeated approved/);
  assert.equal(calls.length,prior);
}
await assert.rejects(acquireHttpsGpd33Snapshot(httpsTrust,snapshotId,{...httpsOptions,env:{}}), /bearer token/);
const mocked = response => ({...httpsOptions,fetchImpl:async () => response});
await assert.rejects(acquireHttpsGpd33Snapshot(httpsTrust,snapshotId,mocked(Response.redirect('https://redirect.example'))), /Rejected evidence HTTPS/);
await assert.rejects(acquireHttpsGpd33Snapshot(httpsTrust,snapshotId,mocked(new Response('html'))), /Rejected evidence HTTPS/);
await assert.rejects(acquireHttpsGpd33Snapshot(httpsTrust,snapshotId,mocked(new Response('{}',{
  headers:{...headers,'content-length':'1048577'}
}))), /Rejected evidence HTTPS/);
await assert.rejects(acquireHttpsGpd33Snapshot(httpsTrust,snapshotId,mocked(new Response('{}',{
  headers:{...headers,'content-encoding':'gzip'}
}))), /Rejected evidence HTTPS/);
const oversized = new ReadableStream({start(controller){
  controller.enqueue(new Uint8Array(1024*1024));
  controller.enqueue(new Uint8Array(1));
  controller.close();
}});
await assert.rejects(acquireHttpsGpd33Snapshot(httpsTrust,snapshotId,mocked(new Response(oversized,{headers}))), /exceeded the byte limit/);
await assert.rejects(acquireHttpsGpd33Snapshot(httpsTrust,snapshotId,mocked(new Response(JSON.stringify(seal('orders')),{headers}))), /configured evidence issuer/);
const stopped = new AbortController();
let cancelled = false;
const stalled = new ReadableStream({cancel(){cancelled = true;}});
const pending = acquireHttpsGpd33Snapshot(httpsTrust,snapshotId,{
  ...mocked(new Response(stalled,{headers})),signal:stopped.signal
});
setTimeout(() => stopped.abort(), 10);
await assert.rejects(pending,{name:'AbortError'});
assert.equal(cancelled,true);
console.log('PASS bounded approved HTTPS evidence acquisition with mocked responses and cancellation');


const liveFixtureKeys = Object.fromEntries(roles.map(role => [role,generateKeyPairSync('ed25519')]));
const liveFixtureTrust = {...httpsTrust, environment:'live', issuers:Object.fromEntries(roles.map(role => [role,{
  ...trust.issuers[role],
  public_key:Buffer.from(liveFixtureKeys[role].publicKey.export({format:'jwk'}).x,'base64url').toString('hex')
}]))};
const mockNow = 1795590000;
function liveFixtureEnvelope(role,observedAt) {
  const body = Buffer.from(JSON.stringify({
    context:contexts[role],issuer:role,environment:'live',snapshot_id:snapshotId,observed_at:observedAt,
    rows:rows[role].map(row => ({...row,environment:'live'}))
  }));
  return {issuer:role,payload:body.toString('base64url'),
    signature:sign(null,body,liveFixtureKeys[role].privateKey).toString('base64url')};
}
const fetchMockLiveSnapshot = observedAt => acquireHttpsGpd33Snapshot(liveFixtureTrust,snapshotId,{
  ...httpsOptions, now:() => mockNow * 1000,
  fetchImpl:async url => Response.json(liveFixtureEnvelope(new URL(url).pathname.split('/').at(-1),observedAt))
});
assert.equal((await fetchMockLiveSnapshot(mockNow-86400)).confirmed_orders,1);
assert.equal((await fetchMockLiveSnapshot(mockNow+300)).observed_at,mockNow+300);
await assert.rejects(fetchMockLiveSnapshot(mockNow-86401), /outside the accepted time window/);
await assert.rejects(fetchMockLiveSnapshot(mockNow+301), /outside the accepted time window/);
assert.throws(() => assertFreshHttpsGpd33Evidence(mockNow,() => NaN), /Invalid HTTPS live evidence observation time/);
assert.throws(() => assertFreshHttpsGpd33Evidence(0,() => mockNow*1000), /Invalid HTTPS live evidence observation time/);

// A local historical review of the same stale signed fixture remains available.
const archivalDirectory = await mkdtemp(join(tmpdir(),'gpd33-evidence-archive-'));
try {
  const registry = join(archivalDirectory,'trust.json');
  await writeFile(registry,JSON.stringify(liveFixtureTrust),{mode:0o600});
  for (const role of roles) {
    await writeFile(join(archivalDirectory,role+'.json'),JSON.stringify(liveFixtureEnvelope(role,mockNow-86401)),{mode:0o600});
  }
  const archived = await acquireGpd33Snapshot(archivalDirectory,registry,snapshotId);
  assert.equal(archived.observed_at,mockNow-86401);
  assert.equal(archived.confirmed_orders,1);
} finally {
  await rm(archivalDirectory,{recursive:true,force:true});
}
console.log('PASS live HTTPS evidence freshness limits and historical file-only review with fixtures');
