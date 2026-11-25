import {spawn} from 'node:child_process';
import {createPrivateKey, createPublicKey, randomUUID, sign, verify} from 'node:crypto';
import {link, lstat, open, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readBoundedJson, readGpd33EvidenceBundle, readGpd33EvidenceRegistry} from './gpd33_reconcile_acquire.mjs';
import {assertFreshHttpsGpd33Evidence} from './gpd33_reconcile_https.mjs';
import {authenticateGpd33OrderEvidenceSnapshot} from './gpd33_reconcile_signed.mjs';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const referenceHash = /^[a-f0-9]{64}$/;
const issuerId = /^[a-zA-Z0-9_-]{1,80}$/;
const maxBindings = 100;
const maxOutputBytes = 128 * 1024;

function asBinding(row) {
  if (!row || ![row.handoff_id,row.merchant_id].every(value => typeof value === 'string' && uuid.test(value)) ||
    typeof row.order_reference_hash !== 'string' || !referenceHash.test(row.order_reference_hash)) {
    throw new Error('Invalid authorized external order binding');
  }
  return {
    handoff_id:row.handoff_id,merchant_id:row.merchant_id,order_reference_hash:row.order_reference_hash
  };
}

function readOnlyHandoffsWithPsql(snapshot,env) {
  if (!/^[a-z0-9.-]+\.[a-z0-9]+$/i.test(env.PGHOST || '') || !/^[a-z0-9_-]+$/i.test(env.PGDATABASE || '') ||
    !/^[a-z0-9_.-]+$/i.test(env.PGUSER || '') || env.PGSSLMODE !== 'verify-full') {
    throw new Error('Explicit PostgreSQL host, database, user and verify-full TLS are required');
  }
  const connection = Object.fromEntries(['PATH','PGPORT','PGPASSWORD','PGPASSFILE','PGSSLROOTCERT']
    .filter(name => typeof env[name] === 'string').map(name => [name,env[name]]));
  return new Promise((resolve,reject) => {
    const child = spawn('psql',['--no-psqlrc','--no-password','--quiet','--tuples-only','--no-align',
      '--host',env.PGHOST,'--dbname',env.PGDATABASE,'--username',env.PGUSER,'--set','ON_ERROR_STOP=1','--file','-'],
    {env:{...connection,PGSSLMODE:'verify-full',PGCONNECT_TIMEOUT:'5',PGOPTIONS:'-c statement_timeout=8000 -c default_transaction_read_only=on'},
      stdio:['pipe','pipe','ignore'],signal:AbortSignal.timeout(15000)});
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk => {
      output += chunk;
      if (output.length > maxOutputBytes) child.kill();
    });
    child.stdin.on('error',() => {});
    child.once('error',() => reject(new Error('Handoff evidence database connection failed')));
    child.once('close',code => {
      if (code !== 0 || output.length > maxOutputBytes) return reject(new Error('Read-only handoff evidence query failed'));
      try { resolve(JSON.parse(output)); } catch { reject(new Error('Invalid handoff evidence query result')); }
    });
    // Both interpolated values have been validated below. JSON contains only UUIDs and lowercase hex.
    child.stdin.end("select public.gpd33_export_handoff_evidence(" + snapshot.observed_at +
      "::bigint,'" + JSON.stringify(snapshot.bindings) + "'::jsonb);\n");
  });
}

export async function exportGpd33SignedHandoffEvidence(orderBundle,trust,issuer,snapshotId,keyJwk,{
  loadRows,now=Date.now
}={}){
  if (typeof issuer !== 'string' || !issuerId.test(issuer) || typeof snapshotId !== 'string' || !uuid.test(snapshotId) ||
    typeof loadRows !== 'function') throw new Error('Pinned issuer, snapshot and read-only handoff loader are required');
  const {environment,rows,metadata} = authenticateGpd33OrderEvidenceSnapshot(orderBundle,trust);
  if (metadata.snapshot_id !== snapshotId) throw new Error('Authorized order evidence snapshot does not match');
  if (environment === 'live') assertFreshHttpsGpd33Evidence(metadata.observed_at,now);
  const authority = Object.hasOwn(trust.issuers,issuer) ? trust.issuers[issuer] : null;
  if (authority?.role !== 'handoffs') throw new Error('Pinned handoff evidence issuer required');
  const key = createPrivateKey({key:keyJwk,format:'jwk'});
  const publicKey = createPublicKey(key);
  const keyProbe = Buffer.from('gpd33-handoff-export-issuer-check-v1');
  if (key.asymmetricKeyType !== 'ed25519' ||
    Buffer.from(publicKey.export({format:'jwk'}).x,'base64url').toString('hex') !== authority.public_key ||
    !verify(null,keyProbe,publicKey,sign(null,keyProbe,key))) {
    throw new Error('Private key does not match the pinned handoff evidence issuer');
  }

  const bindings = new Map();
  for (const row of rows) {
    const binding = asBinding(row);
    const prior = bindings.get(binding.handoff_id);
    if (prior && (prior.merchant_id !== binding.merchant_id || prior.order_reference_hash !== binding.order_reference_hash)) {
      throw new Error('Conflicting authorized order bindings');
    }
    bindings.set(binding.handoff_id,binding);
    if (bindings.size > maxBindings) throw new Error('Too many authorized bindings in one export');
  }
  const response = await loadRows({observed_at:metadata.observed_at,
    bindings:[...bindings.values()].sort((a,b) => a.handoff_id.localeCompare(b.handoff_id))});
  if (response?.ok !== true || !Array.isArray(response.rows) || response.rows.length > bindings.size) {
    throw new Error('Invalid handoff evidence query result');
  }
  const emitted = new Set();
  const verified = response.rows.map(row => {
    const binding = asBinding(row);
    const expected = bindings.get(binding.handoff_id);
    if (!expected || expected.merchant_id !== binding.merchant_id || expected.order_reference_hash !== binding.order_reference_hash ||
      emitted.has(binding.handoff_id) || !['order_reported','cancelled'].includes(row.state) ||
      row.catalog_identity !== 'verified_canonical' || typeof row.product_domain !== 'string' ||
      !/^[a-z_]{1,60}$/.test(row.product_domain)) throw new Error('Handoff response is outside authorized evidence bindings');
    emitted.add(binding.handoff_id);
    return {...binding,environment,state:row.state,product_domain:row.product_domain,catalog_identity:'verified_canonical'};
  });
  verified.sort((a,b) => a.handoff_id.localeCompare(b.handoff_id));
  const payload = Buffer.from(JSON.stringify({context:'gpd33-handoffs-v1',issuer,environment,...metadata,rows:verified}));
  return {issuer,payload:payload.toString('base64url'),signature:sign(null,payload,key).toString('base64url')};
}

export async function saveGpd33HandoffEnvelope(envelope,directory) {
  if (!envelope || typeof envelope.issuer !== 'string' || !issuerId.test(envelope.issuer)) throw new Error('Invalid issuer name');
  const owner = await lstat(directory);
  if (!owner.isDirectory() || owner.uid !== process.getuid() || (owner.mode & 0o077)) {
    throw new Error('A private output directory owned by the running user is required');
  }
  const name = join(directory,envelope.issuer+'.json');
  const temporary = join(directory,'.gpd-handoff-envelope-'+randomUUID()+'.tmp');
  const file = await open(temporary,'wx',0o600);
  try {
    try {
      await file.writeFile(JSON.stringify(envelope)+'\n');
      await file.sync();
    } finally {
      await file.close();
    }
    try { await link(temporary,name); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const {data:prior} = await readBoundedJson(name,maxOutputBytes,{privateFile:true});
      if (prior?.issuer !== envelope.issuer || prior.payload !== envelope.payload || prior.signature !== envelope.signature) {
        throw new Error('A different evidence envelope already exists');
      }
      return 'already_exported';
    }
    return 'exported';
  } finally {
    await unlink(temporary);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [ordersFile,trustFile,issuer,snapshotId,keyFile,directory] = process.argv.slice(2);
    if (process.argv.length !== 8 || process.env.GPD_HANDOFF_EXPORT_APPROVED !== '1') {
      throw new Error('An explicitly approved read-only export is required');
    }
    const [orders,trust,{data:key}] = await Promise.all([
      readGpd33EvidenceBundle(ordersFile),readGpd33EvidenceRegistry(trustFile),readBoundedJson(keyFile,8192,{privateFile:true})
    ]);
    if (trust.environment !== 'live') throw new Error('Configured database evidence export requires pinned live trust');
    const envelope = await exportGpd33SignedHandoffEvidence(orders,trust,issuer,snapshotId,key,{
      loadRows:snapshot => readOnlyHandoffsWithPsql(snapshot,process.env)
    });
    process.stdout.write(JSON.stringify({status:await saveGpd33HandoffEnvelope(envelope,directory)})+'\n');
  } catch {
    process.stderr.write('Handoff evidence export failed. Check the approved read-only database, signed order snapshot and private issuer configuration.\n');
    process.exitCode = 1;
  }
}
