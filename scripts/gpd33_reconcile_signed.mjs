import {createPublicKey, verify} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {reconcileGpd33Evidence} from './gpd33_reconcile.mjs';

const roles = ['handoffs', 'orders', 'fees', 'receipts'];
const contexts = {
  handoffs: 'gpd33-handoffs-v1',
  orders: 'gpd33-external-order-ledger-v1',
  fees: 'gpd33-agreed-fees-v1',
  receipts: 'gpd33-finalized-settlement-v1'
};
const unsigned = /^(?:[A-Za-z0-9_-]+)$/;
const rawPublicKey = /^[a-f0-9]{64}$/;
const keyName = /^[A-Za-z0-9_-]{1,80}$/;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const qualifiedNetwork = /^[a-z0-9-]{3,8}:[A-Za-z0-9_-]{1,32}$/;
const maxPayload = 8 * 1024 * 1024;
const utf8 = new TextDecoder('utf-8', {fatal:true});

function bytes(value, max) {
  if (typeof value !== 'string' || value.length > Math.ceil(max * 4 / 3) || !unsigned.test(value)) {
    throw new Error('Invalid signed encoding');
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) throw new Error('Non-canonical signed encoding');
  return decoded;
}

export function validateGpd33EvidenceRegistry(trust, environment) {
  if (!trust || trust.schema_version !== 1 || trust.environment !== environment ||
    !trust.issuers || typeof trust.issuers !== 'object') {
    throw new Error('Environment trust policy is missing');
  }
  const keys = new Set();
  const authorities = new Map();
  for (const [issuer, authority] of Object.entries(trust.issuers)) {
    if (!keyName.test(issuer) || !authority || !roles.includes(authority.role) ||
      typeof authority.public_key !== 'string' || !rawPublicKey.test(authority.public_key) ||
      keys.has(authority.public_key)) {
      throw new Error('Invalid or reused issuer key');
    }
    keys.add(authority.public_key);
    authorities.set(issuer, authority);
    if (['orders','fees'].includes(authority.role) &&
      (!Array.isArray(authority.merchant_ids) || !authority.merchant_ids.length ||
        !authority.merchant_ids.every(id => typeof id === 'string' && uuid.test(id)))) {
      throw new Error('Merchant issuer scope is missing');
    }
    if (authority.role === 'receipts' &&
      (!Array.isArray(authority.networks) || !authority.networks.length ||
        !authority.networks.every(network => typeof network === 'string' && qualifiedNetwork.test(network)))) {
      throw new Error('Settlement issuer scope is missing');
    }
  }
  if (authorities.size > 64 || !roles.every(role => [...authorities.values()].some(authority => authority.role === role))) {
    throw new Error('Required evidence authority is missing');
  }
  return authorities;
}

function decodeSnapshot(envelope, issuer, authority, environment) {
  const body = bytes(envelope.payload, maxPayload);
  const signature = bytes(envelope.signature, 64);
  const publicKey = createPublicKey({format:'jwk',key:{
    kty:'OKP',crv:'Ed25519',x:Buffer.from(authority.public_key,'hex').toString('base64url')
  }});
  if (signature.length !== 64 || !verify(null, body, publicKey, signature)) {
    throw new Error('Invalid evidence signature');
  }
  const payload = JSON.parse(utf8.decode(body));
  if (!payload || payload.context !== contexts[authority.role] || payload.issuer !== issuer ||
    payload.environment !== environment || typeof payload.snapshot_id !== 'string' ||
    !uuid.test(payload.snapshot_id) || !Number.isSafeInteger(payload.observed_at) || payload.observed_at < 1 ||
    !Array.isArray(payload.rows) || payload.rows.length > 20000 ||
    payload.rows.some(row => !row || typeof row !== 'object' || Array.isArray(row) || row.environment !== environment)) {
    throw new Error('Invalid signed snapshot');
  }
  return payload;
}

function normalizeRows(rows, authority) {
  if (authority.role === 'handoffs') return rows;
  if (authority.role === 'orders') {
    return rows.map(row => {
      if (!authority.merchant_ids.includes(row.merchant_id) || !['confirmed','cancelled'].includes(row.state)) {
        throw new Error('Order is outside issuer scope or has no recognized state');
      }
      return {...row, verification:'authoritative_ledger'};
    });
  }
  if (authority.role === 'fees') {
    return rows.map(row => {
      if (!authority.merchant_ids.includes(row.merchant_id) || row.contract_state !== 'executed') {
        throw new Error('Fee is outside issuer scope or contract is unexecuted');
      }
      return {...row, approval:'contract_verified'};
    });
  }
  return rows.map(row => {
    if (!authority.networks.includes(row.network) || row.settlement_state !== 'finalized') {
      throw new Error('Receipt is outside issuer scope or transfer is unfinalized');
    }
    return {...row, verification:'finalized_ledger'};
  });
}

/**
 * Authenticate a complete snapshot against a registry supplied independently by the operator.
 * Returned rows contain private evidence and are for local reconciliation only.
 */
export function authenticateGpd33EvidenceSnapshot(bundle, trust) {
  if (!bundle || bundle.schema_version !== 1 || !['test','live'].includes(bundle.environment) ||
    !Array.isArray(bundle.envelopes) || !bundle.envelopes.length || bundle.envelopes.length > 64) {
    throw new Error('Invalid signed evidence bundle');
  }
  const authorities = validateGpd33EvidenceRegistry(trust, bundle.environment);
  const input = {schema_version:1,environment:bundle.environment,handoffs:[],orders:[],fees:[],receipts:[]};
  const includedIssuers = new Set();
  let metadata;
  for (const envelope of bundle.envelopes) {
    if (!envelope || !authorities.has(envelope.issuer) || includedIssuers.has(envelope.issuer)) {
      throw new Error('Unknown or repeated evidence issuer');
    }
    includedIssuers.add(envelope.issuer);
    const authority = authorities.get(envelope.issuer);
    const payload = decodeSnapshot(envelope,envelope.issuer,authority,bundle.environment);
    const {snapshot_id, observed_at} = payload;
    if (metadata && (metadata.snapshot_id !== snapshot_id || metadata.observed_at !== observed_at)) {
      throw new Error('Evidence was combined from different snapshots');
    }
    metadata = {snapshot_id, observed_at};
    for (const row of normalizeRows(payload.rows,authority)) input[authority.role].push(row);
  }

  // Require every pinned authority so dropping an issuer's envelope cannot silently remove conflicting
  // records or refunds. A trusted source with no records must sign an explicit empty array.
  if (includedIssuers.size !== authorities.size) {
    throw new Error('Required evidence issuer is missing');
  }
  return {input,metadata};
}

export function reconcileSignedGpd33Evidence(bundle, trust) {
  const {input,metadata}=authenticateGpd33EvidenceSnapshot(bundle,trust);
  return {...reconcileGpd33Evidence(input), ...metadata, evidence:'signed_pinned_sources'};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error('Expected local evidence and trust-registry files');
    const [bundle,trust] = await Promise.all(process.argv.slice(2).map(async file =>
      JSON.parse(await readFile(file,'utf8'))));
    process.stdout.write(JSON.stringify(reconcileSignedGpd33Evidence(bundle,trust),null,2)+'\n');
  } catch {
    process.stderr.write('Signed reconciliation failed. Check the private evidence files and pinned trust registry.\n');
    process.exitCode = 1;
  }
}
