import {createPublicKey, randomUUID, verify} from 'node:crypto';
import {link, lstat, open, unlink} from 'node:fs/promises';
import {join} from 'node:path';
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
const maxWindowRows = 20000;
const maxWindowSeconds = 31 * 24 * 60 * 60;
const maxWindowSnapshots = 32;
const maxWindowEncodedChars = 32 * 1024 * 1024;
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
  const expected = new Map(), conflicts = new Set(), testTransactions = new Set();
  let excludedTestRecords = 0, unboundRecords = 0;
  for (const row of rows) {
    if (row.event_type !== 'paid_call') throw new Error('Expected x402 paid-call rows only');
    const agreement = row.metadata?.x402_reconciliation_v1;
    if (environment === 'live' && (row.metadata?.test_mode || row.metadata?.source_class === 'admin_or_test' ||
      agreement?.traffic_class === 'test')) {
      excludedTestRecords++;
      // If later observations omit the marker, the known test transaction remains excluded.
      if (row.payment_network === solanaMainnet && solanaBytes(row.transaction_hash,64)) {
        testTransactions.add(txKey(row,environment));
      }
      continue;
    }
    if (!agreement) {
      unboundRecords++;
      continue;
    }
    const key = txKey(row,environment);
    const facts = transferFacts({...agreement,amount_atomic:row.amount_atomic},environment);
    const prior = expected.get(key);
    if (prior && JSON.stringify(prior) !== JSON.stringify(facts)) conflicts.add(key);
    expected.set(key,facts);
  }
  for (const key of testTransactions) expected.delete(key);
  return {expected,conflicts,excludedTestRecords,unboundRecords};
}

function indexFinalized(rows,environment) {
  const transactions = new Map(), conflicts = new Set(), failedFinalized = new Set();
  for (const row of rows) {
    const key = txKey(row,environment);
    if (row.finality !== 'finalized') continue;
    if (row.execution === 'failed') {
      failedFinalized.add(key);
      continue;
    }
    if (row.execution !== 'success') continue;
    const index = Number.isSafeInteger(row.instruction_index) ? String(row.instruction_index) : row.instruction_index;
    if (typeof index !== 'string' || !/^(?:0|[1-9][0-9]{0,4})(?:\.(?:0|[1-9][0-9]{0,4}))?$/.test(index)) {
      throw new Error('Invalid finalized x402 instruction locator');
    }
    if (!transactions.has(key)) transactions.set(key,new Map());
    const instructions = transactions.get(key);
    const facts = transferFacts(row,environment);
    if (row.payer != null) {
      if (!solanaBytes(row.payer,32)) throw new Error('Invalid Solana x402 payer');
      facts.payer = row.payer;
    }
    const prior = instructions.get(index);
    if (prior && (prior.mint!==facts.mint || prior.payee!==facts.payee || prior.amount!==facts.amount ||
      (prior.payer && facts.payer && prior.payer!==facts.payer))) conflicts.add(key);
    instructions.set(index,{...prior,...facts});
  }
  for (const key of failedFinalized) if (transactions.has(key)) conflicts.add(key);
  return {transactions,conflicts};
}

function reconcileRows(expectedRows,finalizedRows,environment) {
  const {expected,conflicts,excludedTestRecords,unboundRecords}=indexExpected(expectedRows.filter(row=>row.event_type!=='x402_refund'),environment);
  const {transactions,conflicts:chainConflicts}=indexFinalized(finalizedRows,environment);
  const totals = new Map(), matched = new Map();
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
    matched.set(key,{...possible[0],asset});
    totals.set(asset,(totals.get(asset) || 0n)+BigInt(facts.amount));
  }
  const refunds = new Map(), refundConflicts = new Set(), refundedByPayment = new Map();
  for (const row of expectedRows.filter(row=>row.event_type==='x402_refund')) {
    if (environment==='live' && (row.metadata?.test_mode || row.metadata?.source_class==='admin_or_test' ||
      row.metadata?.x402_reconciliation_v1?.traffic_class==='test')) {
      refundConflicts.add(txKey(row,environment));
      continue;
    }
    const key=txKey(row,environment);
    const original=txKey({...row,transaction_hash:row.original_transaction_hash},environment);
    const amount=exactAtomic(row.amount_atomic);
    const prior=refunds.get(key);
    if (prior && (prior.original!==original || prior.amount!==amount)) refundConflicts.add(key);
    refunds.set(key,{original,amount});
  }
  for (const [key,{original,amount}] of refunds) {
    const payment=matched.get(original);
    if (!payment?.payer || expected.has(key) || refundConflicts.has(key) || chainConflicts.has(key)) continue;
    const transfers=[...(transactions.get(key)?.values() || [])].filter(
      row=>row.mint===payment.mint && row.payer===payment.payee && row.payee===payment.payer);
    if (transfers.length!==1 || transfers[0].amount!==amount) continue;
    const bucket=refundedByPayment.get(original) || {amount:0n,count:0};
    bucket.amount+=BigInt(amount);
    bucket.count++;
    refundedByPayment.set(original,bucket);
  }
  const refundTotals=new Map();
  let matchedRefunds=0;
  for (const [key,bucket] of refundedByPayment) {
    const payment=matched.get(key);
    if (bucket.amount>BigInt(payment.amount)) continue;
    matchedRefunds+=bucket.count;
    refundTotals.set(payment.asset,(refundTotals.get(payment.asset)||0n)+bucket.amount);
  }
  const unresolvedRefunds=refunds.size-matchedRefunds;
  const netFees=unresolvedRefunds===0
    ? Object.fromEntries([...totals].sort().map(([asset,total])=>[asset,(total-(refundTotals.get(asset)||0n)).toString()]))
    : null;
  return {
    scope:environment === 'test' ? 'test_only' : 'supplied_live_evidence_only',
    evidence:'independent_signed_finalized_solana',
    matched_information_fee_atomic:Object.fromEntries([...totals].sort().map(([asset,total]) => [asset,total.toString()])),
    matched_refund_atomic:Object.fromEntries([...refundTotals].sort().map(([asset,total])=>[asset,total.toString()])),
    net_matched_information_fee_atomic:netFees,
    refund_transactions:{matched:matchedRefunds,unresolved:unresolvedRefunds},
    transactions:counts,excluded_test_records:excludedTestRecords,unbound_expected_records:unboundRecords
  };
}

/** Reconcile one independently pinned expected and finalized ledger snapshot. */
export function reconcileSignedGpd33X402Evidence(bundle,trust,expectedSnapshotId) {
  const {environment,metadata,expected,finalized}=decodeEnvelopes(bundle,trust);
  if (typeof expectedSnapshotId !== 'string' || metadata.snapshot_id !== expectedSnapshotId) {
    throw new Error('Requested x402 evidence snapshot does not match');
  }
  return {schema:'gpd33-x402-information-reconciliation-v1',...metadata,
    ...reconcileRows(expected,finalized,environment)};
}

/** Merge authenticated facts across an explicit observation window. Never sum per-snapshot totals. */
export async function reconcileSignedGpd33X402Window(bundles,trust,{startInclusive,endExclusive}={}) {
  if (!Number.isSafeInteger(startInclusive) || !Number.isSafeInteger(endExclusive) || startInclusive < 1 ||
    endExclusive <= startInclusive || endExclusive-startInclusive > maxWindowSeconds) {
    throw new Error('A bounded x402 observation window is required');
  }
  const snapshots = new Map(), expectedRows = [], finalizedRows = [];
  let received = 0, encodedChars = 0, earliest = Infinity, latest = 0;
  for await (const bundle of bundles) {
    if (++received > maxWindowSnapshots) throw new Error('Too many signed x402 snapshots');
    if (!Array.isArray(bundle?.envelopes) || bundle.envelopes.length !== 2 ||
      bundle.envelopes.some(envelope => typeof envelope?.payload !== 'string')) {
      throw new Error('Invalid x402 window evidence bundle');
    }
    encodedChars += bundle.envelopes.reduce((size,envelope) => size+envelope.payload.length,0);
    if (encodedChars > maxWindowEncodedChars) throw new Error('x402 window evidence exceeds the byte budget');
    const {metadata,expected,finalized}=decodeEnvelopes(bundle,trust);
    const {snapshot_id,observed_at}=metadata;
    if (observed_at < startInclusive || observed_at >= endExclusive) {
      throw new Error('Signed x402 observation is outside the requested window');
    }
    const fingerprint = bundle.envelopes.map(envelope => envelope.issuer+':'+envelope.signature).sort().join('|');
    if (snapshots.has(snapshot_id)) {
      if (snapshots.get(snapshot_id) !== fingerprint) throw new Error('Conflicting signed x402 snapshot UUID');
      continue;
    }
    if (expectedRows.length+finalizedRows.length+expected.length+finalized.length > maxWindowRows) {
      throw new Error('x402 window evidence exceeds the record budget');
    }
    snapshots.set(snapshot_id,fingerprint);
    earliest = Math.min(earliest,observed_at);
    latest = Math.max(latest,observed_at);
    expectedRows.push(...expected);
    finalizedRows.push(...finalized);
  }
  if (!snapshots.size) throw new Error('At least one signed x402 snapshot is required');
  const {excluded_test_records,unbound_expected_records,...report}=reconcileRows(expectedRows,finalizedRows,trust.environment);
  return {
    schema:'gpd33-x402-information-reconciliation-window-v1',
    observation_window:{start_inclusive:startInclusive,end_exclusive:endExclusive,first_observed_at:earliest,last_observed_at:latest},
    snapshots:snapshots.size,
    replayed_snapshots:received-snapshots.size,
    ...report,
    excluded_test_observations:excluded_test_records,
    unbound_expected_observations:unbound_expected_records
  };
}

export async function saveGpd33X402WindowReport(report,directory) {
  const window=report?.observation_window;
  if (report?.schema !== 'gpd33-x402-information-reconciliation-window-v1' ||
    !Number.isSafeInteger(window?.start_inclusive) || !Number.isSafeInteger(window?.end_exclusive)) {
    throw new Error('A valid x402 observation-window report is required');
  }
  const owner=await lstat(directory);
  if (!owner.isDirectory() || owner.uid !== process.getuid() || (owner.mode & 0o077)) {
    throw new Error('A private output directory owned by the running user is required');
  }
  const name=join(directory,'x402-'+window.start_inclusive+'-'+window.end_exclusive+'.json');
  const temporary=join(directory,'.x402-'+randomUUID()+'.tmp');
  const contents=JSON.stringify(report)+'\n';
  const file=await open(temporary,'wx',0o600);
  try {
    try {
      await file.writeFile(contents);
      await file.sync();
    } finally {
      await file.close();
    }
    try { await link(temporary,name); }
    catch(error) {
      if (error.code !== 'EEXIST') throw error;
      const {data:prior}=await readBoundedJson(name,32*1024,{privateFile:true});
      if (JSON.stringify(prior)+'\n' !== contents) throw new Error('A different private x402 window report already exists');
      return 'already_reported';
    }
    return 'reported';
  } finally {
    await unlink(temporary);
  }
}

async function * evidenceFiles(paths) {
  for (const file of paths) yield (await readBoundedJson(file,12*1024*1024,{privateFile:true})).data;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args=process.argv.slice(2);
    let report;
    if (args[0] === '--window') {
      const [,start,end,trustFile,outputDirectory,...bundleFiles]=args;
      if (!start || !end || !trustFile || !outputDirectory || !bundleFiles.length || bundleFiles.length > maxWindowSnapshots ||
        !/^[1-9][0-9]{0,15}$/.test(start) || !/^[1-9][0-9]{0,15}$/.test(end)) {
        throw new Error('Expected window start, end, pinned policy, private output and signed bundles');
      }
      const {data:trust}=await readBoundedJson(trustFile,256*1024,{privateFile:true});
      const windowReport=await reconcileSignedGpd33X402Window(evidenceFiles(bundleFiles),trust,
        {startInclusive:Number(start),endExclusive:Number(end)});
      report={status:await saveGpd33X402WindowReport(windowReport,outputDirectory)};
    } else {
      const [bundleFile,trustFile,snapshot]=args;
      if (args.length !== 3) throw new Error('Expected bundle, pinned policy and snapshot');
      const [{data:bundle},{data:trust}]=await Promise.all([
        readBoundedJson(bundleFile,12*1024*1024),readBoundedJson(trustFile,256*1024)
      ]);
      report=reconcileSignedGpd33X402Evidence(bundle,trust,snapshot);
    }
    process.stdout.write(JSON.stringify(report)+'\n');
  } catch {
    process.stderr.write('x402 reconciliation failed. Check independently signed ledgers and the requested snapshot.\n');
    process.exitCode=1;
  }
}
