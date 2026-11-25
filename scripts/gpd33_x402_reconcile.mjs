import {createPublicKey, verify} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readBoundedJson} from './gpd33_reconcile_acquire.mjs';

const solanaMainnet = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const tokenAlphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const base58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const contexts = {
  x402_expected:'gpd33-x402-information-expected-v1',
  x402_finalized:'gpd33-x402-solana-finalized-v1'
};
const maxAtomic = 18446744073709551615n;
const maxPayload = 4 * 1024 * 1024;
const maxRows = 10000;
const utf8 = new TextDecoder('utf-8',{fatal:true});

function solanaBytes(value,length) {
  if (typeof value !== 'string' || value.length > 88 || !base58.test(value)) return false;
  let numeric = 0n;
  for (const char of value) numeric = 58n * numeric + BigInt(tokenAlphabet.indexOf(char));
  let bytes = value.match(/^1*/)[0].length;
  while (numeric) {
    bytes++;
    numeric >>= 8n;
  }
  return bytes === length;
}

function exactAtomic(value) {
  const digits = Number.isSafeInteger(value) ? String(value) : value;
  if (typeof digits !== 'string' || !/^[1-9][0-9]{0,19}$/.test(digits) || BigInt(digits) > maxAtomic) {
    throw new Error('Invalid x402 token amount');
  }
  return digits;
}

function encodedBytes(value,limit) {
  if (typeof value !== 'string' || value.length > Math.ceil(limit * 4 / 3) || !/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error('Invalid x402 evidence encoding');
  }
  const bytes = Buffer.from(value,'base64url');
  if (bytes.toString('base64url') !== value) throw new Error('Invalid x402 evidence encoding');
  return bytes;
}

function decodeEnvelopes(bundle,trust) {
  const environment = bundle?.environment;
  if (!['test','live'].includes(environment) || bundle.schema_version !== 1 ||
    trust?.schema_version !== 1 || trust.environment !== environment ||
    !trust.issuers || !Array.isArray(bundle.envelopes) || bundle.envelopes.length !== 2 ||
    Object.keys(trust.issuers).length !== 2) throw new Error('Separate pinned x402 evidence authorities are required');
  const roles = new Map();
  const publicKeys = new Set();
  let metadata;
  for (const envelope of bundle.envelopes) {
    const issuer = envelope?.issuer;
    if (typeof issuer !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(issuer) || !Object.hasOwn(trust.issuers,issuer)) {
      throw new Error('Untrusted x402 evidence issuer');
    }
    const {role,public_key:rawKey} = trust.issuers[issuer] || {};
    if (!Object.hasOwn(contexts,role) || roles.has(role) || typeof rawKey !== 'string' ||
      !/^[a-f0-9]{64}$/.test(rawKey) || publicKeys.has(rawKey)) {
      throw new Error('Duplicate or invalid x402 evidence authority');
    }
    publicKeys.add(rawKey);
    const publicKey = createPublicKey({format:'jwk',key:{
      kty:'OKP',crv:'Ed25519',x:Buffer.from(rawKey,'hex').toString('base64url')
    }});
    const bytes = encodedBytes(envelope.payload,maxPayload);
    const signature = encodedBytes(envelope.signature,64);
    if (signature.length !== 64 || !verify(null,bytes,publicKey,signature)) throw new Error('Invalid x402 evidence signature');
    const payload = JSON.parse(utf8.decode(bytes));
    if (!payload || payload.context !== contexts[role] || payload.issuer !== issuer || payload.environment !== environment ||
      typeof payload.snapshot_id !== 'string' || !uuid.test(payload.snapshot_id) ||
      !Number.isSafeInteger(payload.observed_at) || payload.observed_at < 1 ||
      !Array.isArray(payload.rows) || payload.rows.length > maxRows ||
      payload.rows.some(row => !row || row.environment !== environment)) {
      throw new Error('Invalid signed x402 evidence snapshot');
    }
    const {snapshot_id,observed_at} = payload;
    if (metadata && (metadata.snapshot_id !== snapshot_id || metadata.observed_at !== observed_at)) {
      throw new Error('Signed x402 evidence snapshots do not match');
    }
    metadata = {snapshot_id,observed_at};
    roles.set(role,payload.rows);
  }
  return {environment,metadata,expected:roles.get('x402_expected'),finalized:roles.get('x402_finalized')};
}

function txKey(row,environment) {
  const {payment_network:network,transaction_hash:hash} = row;
  if (typeof network !== 'string' || !/^solana:[A-Za-z0-9_-]{1,32}$/.test(network) ||
    (environment === 'live' && network !== solanaMainnet) || !solanaBytes(hash,64)) {
    throw new Error('Invalid Solana x402 transaction locator');
  }
  return network + '|' + hash;
}

function transferFacts(row,environment) {
  const {mint,payee,amount_atomic:atomic} = row;
  if (!solanaBytes(mint,32) || !solanaBytes(payee,32) || (environment === 'live' && mint !== usdcMint)) {
    throw new Error('Invalid Solana x402 asset or payee');
  }
  return {mint,payee,amount:exactAtomic(atomic)};
}

function indexExpected(rows,environment) {
  const expected = new Map(), conflicts = new Set();
  let excludedTestRecords = 0, unboundRecords = 0;
  for (const row of rows) {
    if (row.event_type !== 'paid_call') throw new Error('Expected x402 paid-call rows only');
    const agreement = row.metadata?.x402_reconciliation_v1;
    if (!agreement) {
      unboundRecords++;
      continue;
    }
    if (environment === 'live' && (row.metadata.test_mode || row.metadata.source_class === 'admin_or_test' ||
      agreement.traffic_class === 'test')) {
      excludedTestRecords++;
      continue;
    }
    const key = txKey(row,environment);
    const facts = transferFacts({...agreement,amount_atomic:row.amount_atomic},environment);
    const prior = expected.get(key);
    if (prior && JSON.stringify(prior) !== JSON.stringify(facts)) conflicts.add(key);
    expected.set(key,facts);
  }
  return {expected,conflicts,excludedTestRecords,unboundRecords};
}

function indexFinalized(rows,environment) {
  const transactions = new Map(), conflicts = new Set();
  for (const row of rows) {
    const key = txKey(row,environment);
    if (row.finality !== 'finalized' || row.execution !== 'success') continue;
    const index = Number.isSafeInteger(row.instruction_index) ? String(row.instruction_index) : row.instruction_index;
    if (typeof index !== 'string' || !/^(?:0|[1-9][0-9]{0,4})(?:\.(?:0|[1-9][0-9]{0,4}))?$/.test(index)) {
      throw new Error('Invalid finalized x402 instruction locator');
    }
    if (!transactions.has(key)) transactions.set(key,new Map());
    const instructions = transactions.get(key);
    const facts = transferFacts(row,environment);
    const prior = instructions.get(index);
    if (prior && JSON.stringify(prior) !== JSON.stringify(facts)) conflicts.add(key);
    instructions.set(index,facts);
  }
  return {transactions,conflicts};
}

/** Reconcile x402 information receipts only from independently pinned expected and finalized ledgers. */
export function reconcileSignedGpd33X402Evidence(bundle,trust,expectedSnapshotId) {
  const {environment,metadata,expected:expectedRows,finalized:finalizedRows}=decodeEnvelopes(bundle,trust);
  if (typeof expectedSnapshotId !== 'string' || metadata.snapshot_id !== expectedSnapshotId) {
    throw new Error('Requested x402 evidence snapshot does not match');
  }
  const {expected,conflicts,excludedTestRecords,unboundRecords}=indexExpected(expectedRows,environment);
  const {transactions,conflicts:chainConflicts}=indexFinalized(finalizedRows,environment);
  const totals = new Map();
  const counts = {matched:0,unproved:0,conflicting:0,ambiguous:0,mismatched:0};
  for (const [key,facts] of expected) {
    if (conflicts.has(key) || chainConflicts.has(key)) {
      counts.conflicting++;
      continue;
    }
    const instructions = transactions.get(key);
    if (!instructions) {
      counts.unproved++;
      continue;
    }
    const possible = [...instructions.values()].filter(row => row.mint === facts.mint && row.payee === facts.payee);
    if (possible.length > 1) {
      counts.ambiguous++;
      continue;
    }
    if (possible.length !== 1 || possible[0].amount !== facts.amount) {
      counts.mismatched++;
      continue;
    }
    counts.matched++;
    const asset = key.split('|',1)[0] + '|' + facts.mint;
    totals.set(asset,(totals.get(asset) || 0n)+BigInt(facts.amount));
  }
  return {
    schema:'gpd33-x402-information-reconciliation-v1',
    scope:environment === 'test' ? 'test_only' : 'supplied_live_evidence_only',
    ...metadata,
    evidence:'independent_signed_finalized_solana',
    matched_information_fee_atomic:Object.fromEntries([...totals].sort().map(([asset,total]) => [asset,total.toString()])),
    transactions:counts,excluded_test_records:excludedTestRecords,unbound_expected_records:unboundRecords
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [bundleFile,trustFile,snapshot]=process.argv.slice(2);
    if (process.argv.length !== 5) throw new Error('Expected bundle, pinned policy and snapshot');
    const [{data:bundle},{data:trust}]=await Promise.all([
      readBoundedJson(bundleFile,12*1024*1024),readBoundedJson(trustFile,256*1024)
    ]);
    process.stdout.write(JSON.stringify(reconcileSignedGpd33X402Evidence(bundle,trust,snapshot))+'\n');
  } catch {
    process.stderr.write('x402 reconciliation failed. Check independently signed ledgers and the requested snapshot.\n');
    process.exitCode=1;
  }
}
