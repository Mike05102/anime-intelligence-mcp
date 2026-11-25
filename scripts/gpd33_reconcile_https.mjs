import {isIP} from 'node:net';
import {Readable} from 'node:stream';
import {requestPinnedHttps, resolvePinnedPublicIpv4} from './gpd33_merchant_feed_fetch.mjs';
import {readGpd33EvidenceRegistry} from './gpd33_reconcile_acquire.mjs';
import {reconcileSignedGpd33Evidence, validateGpd33EvidenceRegistry} from './gpd33_reconcile_signed.mjs';

export const readHttpsEvidenceRegistry = readGpd33EvidenceRegistry;

const snapshotUuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const envName = /^[A-Z][A-Z0-9_]{0,79}$/;
const perIssuerLimit = 1024 * 1024;
const batchLimit = 4 * 1024 * 1024;
const utf8 = new TextDecoder('utf-8', {fatal:true});

function configuredSources(trust, env) {
  const authorities = validateGpd33EvidenceRegistry(trust,trust.environment);
  const sources = trust.https_sources;
  if (!sources || typeof sources !== 'object' || Array.isArray(sources) ||
    Object.keys(sources).length !== authorities.size) {
    throw new Error('Each pinned evidence issuer needs one approved HTTPS source');
  }
  const urls = new Set();
  return [...authorities.keys()].map(issuer => {
    const source = Object.hasOwn(sources,issuer) ? sources[issuer] : null;
    if (!source || typeof source.url !== 'string' || source.url.length > 2048) {
      throw new Error('Evidence source requires an approved HTTPS URL');
    }
    let url;
    try { url = new URL(source.url); }
    catch { throw new Error('Invalid approved evidence URL'); }
    const host = url.hostname;
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port ||
      isIP(host) || !/\.[a-z][a-z0-9-]*$/.test(host) || /\.(localhost|local|internal)$/.test(host) ||
      urls.has(url.href)) {
      throw new Error('Invalid or repeated approved evidence URL');
    }
    urls.add(url.href);
    const headers = {accept:'application/json','accept-encoding':'identity','cache-control':'no-cache'};
    if (source.authorization_env !== undefined) {
      const variable = source.authorization_env;
      if (typeof variable !== 'string' || !envName.test(variable) || !Object.hasOwn(env,variable) ||
        typeof env[variable] !== 'string' || !/^[A-Za-z0-9._~+/=-]{1,8192}$/.test(env[variable])) {
        throw new Error('Configured evidence bearer token is unavailable or invalid');
      }
      headers.authorization = 'Bearer ' + env[variable];
    }
    return {issuer,url:url.href,headers};
  });
}

async function fetchPinnedEvidence(url,{headers,signal}){
  const endpoint = new URL(url);
  const address = await resolvePinnedPublicIpv4(endpoint.hostname,signal);
  const incoming = await requestPinnedHttps(endpoint,{address,signal,headers});
  return {status:incoming.statusCode,url,redirected:false,headers:new Headers(incoming.headers),
    body:Readable.toWeb(incoming)};
}

async function fetchEnvelope(source,fetchImpl,signal,byteLimit) {
  signal.throwIfAborted();
  let response;
  try {
    response = await fetchImpl(source.url,{method:'GET',headers:source.headers,redirect:'error',signal});
  } catch {
    if (signal.aborted) throw new Error('Evidence fetch was stopped or timed out');
    throw new Error('Approved evidence HTTPS request failed');
  }
  const type = response.headers.get('content-type')?.split(';',1)[0]?.trim().toLowerCase();
  const sizeHeader = response.headers.get('content-length');
  const encoding = response.headers.get('content-encoding');
  if (response.status !== 200 || response.redirected || (response.url && response.url !== source.url) ||
    !(type === 'application/json' || /^application\/[a-z0-9.+-]+\+json$/.test(type)) ||
    (encoding !== null && encoding.toLowerCase() !== 'identity') ||
    (sizeHeader !== null && (!/^[0-9]+$/.test(sizeHeader) || Number(sizeHeader) > byteLimit))) {
    await response.body?.cancel().catch(() => {});
    throw new Error('Rejected evidence HTTPS response');
  }
  if (!response.body) throw new Error('Missing evidence HTTPS response body');
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  const stop = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort',stop,{once:true});
  try {
    signal.throwIfAborted();
    for (;;) {
      const {done,value} = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > byteLimit) throw new Error('Evidence HTTPS response exceeded the byte limit');
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort',stop);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (sizeHeader !== null && size !== Number(sizeHeader)) throw new Error('Evidence HTTPS response length did not match');
  let envelope;
  try { envelope = JSON.parse(utf8.decode(Buffer.concat(chunks,size))); }
  catch { throw new Error('Invalid JSON evidence HTTPS response'); }
  if (envelope?.issuer !== source.issuer) throw new Error('HTTPS response did not match the configured evidence issuer');
  return {envelope,size};
}

export async function acquireHttpsGpd33Snapshot(trust,expectedSnapshotId,{fetchImpl=fetchPinnedEvidence,env=process.env,signal:callerSignal}={}) {
  if (!trust || !['test','live'].includes(trust.environment) ||
    typeof expectedSnapshotId !== 'string' || !snapshotUuid.test(expectedSnapshotId)) {
    throw new Error('A pinned environment and expected snapshot UUID are required');
  }
  const sources = configuredSources(trust,env);
  const deadline = AbortSignal.timeout(20_000);
  const signal = callerSignal ? AbortSignal.any([callerSignal,deadline]) : deadline;
  const envelopes = [];
  let bytesRemaining = batchLimit;
  for (const source of sources) {
    if (bytesRemaining <= 0) throw new Error('Evidence snapshot exceeded the byte limit');
    const {envelope,size} = await fetchEnvelope(source,fetchImpl,signal,Math.min(bytesRemaining,perIssuerLimit));
    bytesRemaining -= size;
    envelopes.push(envelope);
  }
  const report = reconcileSignedGpd33Evidence({schema_version:1,environment:trust.environment,envelopes},trust);
  if (report.snapshot_id !== expectedSnapshotId) throw new Error('HTTPS evidence does not match the requested snapshot');
  return report;
}
