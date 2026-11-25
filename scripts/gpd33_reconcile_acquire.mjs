import {constants} from 'node:fs';
import {lstat, open} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {reconcileSignedGpd33Evidence} from './gpd33_reconcile_signed.mjs';

const issuerName = /^[A-Za-z0-9_-]{1,80}$/;
const snapshotId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const maxRegistryBytes = 256 * 1024;
const maxEnvelopeBytes = 12 * 1024 * 1024;
const maxSnapshotBytes = 32 * 1024 * 1024;
const utf8 = new TextDecoder('utf-8', {fatal:true});

export async function readBoundedJson(file, limit) {
  // O_NONBLOCK prevents opening a FIFO from waiting on a writer. Only regular files qualify.
  const descriptor = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await descriptor.stat({bigint:true});
    if (!before.isFile() || before.size < 1n || before.size > BigInt(limit)) {
      throw new Error('Evidence input must be a bounded regular file');
    }
    // Read at most the observed size plus one byte even if the file grows after stat.
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let used = 0;
    while (used < buffer.length) {
      const {bytesRead} = await descriptor.read(buffer,used,buffer.length-used,used);
      if (!bytesRead) break;
      used += bytesRead;
    }
    const after = await descriptor.stat({bigint:true});
    if (BigInt(used) !== before.size || after.size !== before.size || after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs) {
      throw new Error('Evidence input changed while being read');
    }
    return {size:used, data:JSON.parse(utf8.decode(buffer.subarray(0,used)))};
  } finally {
    await descriptor.close();
  }
}

export async function readGpd33EvidenceRegistry(registryFile) {
  return (await readBoundedJson(registryFile,maxRegistryBytes)).data;
}

export async function acquireGpd33Snapshot(directory, registryFile, expectedSnapshotId) {
  if (typeof expectedSnapshotId !== 'string' || !snapshotId.test(expectedSnapshotId)) {
    throw new Error('Expected snapshot UUID is required');
  }
  if (!(await lstat(directory)).isDirectory()) throw new Error('Evidence path must be a staging directory');
  const trust = await readGpd33EvidenceRegistry(registryFile);
  const issuers = Object.keys(trust?.issuers ?? {});
  if (!issuers.length || issuers.length > 64 || !issuers.every(name => issuerName.test(name))) {
    throw new Error('Invalid evidence issuer names');
  }
  const envelopes = [];
  let remainingBytes = maxSnapshotBytes;
  // Read only files named by the independently configured trust registry.
  for (const issuer of issuers) {
    const file = join(directory,issuer + '.json');
    const {size,data} = await readBoundedJson(file,Math.min(remainingBytes,maxEnvelopeBytes));
    if (data?.issuer !== issuer) throw new Error('Evidence file does not match its configured issuer');
    remainingBytes -= size;
    envelopes.push(data);
  }
  const report = reconcileSignedGpd33Evidence({schema_version:1,environment:trust.environment,envelopes},trust);
  if (report.snapshot_id !== expectedSnapshotId) throw new Error('Evidence does not match the requested snapshot');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [directory, registryFile, expectedSnapshotId] = process.argv.slice(2);
    if (process.argv.length !== 5) throw new Error('Expected staging directory, trust registry and snapshot UUID');
    const report = await acquireGpd33Snapshot(directory,registryFile,expectedSnapshotId);
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
  } catch {
    process.stderr.write('Evidence acquisition failed. Check the private staging directory, trust registry and snapshot UUID.\n');
    process.exitCode = 1;
  }
}
