import {randomUUID} from 'node:crypto';
import {link, lstat, open, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fetchApprovedMerchantOfferFeed, readMerchantFeedApproval} from './gpd33_merchant_feed_fetch.mjs';
import {acquireHttpsGpd33Snapshot, readHttpsEvidenceRegistry} from './gpd33_reconcile_https.mjs';

const snapshotUuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export async function runPartnerReview(approvalFile, registryFile, snapshotId, privateDirectory,
  {feedOptions, evidenceOptions} = {}) {
  if (typeof snapshotId !== 'string' || !snapshotUuid.test(snapshotId)) {
    throw new Error('Expected snapshot UUID is required');
  }
  const directory = await lstat(privateDirectory);
  if (!directory.isDirectory() || directory.mode & 0o077 || directory.uid !== process.getuid()) {
    throw new Error('A private output directory owned by the running user is required');
  }
  const reportPath = join(privateDirectory, snapshotId + '.json');
  // One job per directory, with a durable report per snapshot.
  const lockPath = join(privateDirectory, '.gpd-partner-review.lock');
  const lock = await open(lockPath, 'wx', 0o600);
  try {
    const exists = await lstat(reportPath).then(() => true, (error) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    });
    if (exists) return {status:'already_reviewed',snapshot_id:snapshotId};

    const [approval, trust] = await Promise.all([
      readMerchantFeedApproval(approvalFile), readHttpsEvidenceRegistry(registryFile)
    ]);
    const [merchantFeed, reconciliation] = await Promise.allSettled([
      fetchApprovedMerchantOfferFeed(approval, feedOptions),
      acquireHttpsGpd33Snapshot(trust, snapshotId, evidenceOptions)
    ]);
    if (merchantFeed.status !== 'fulfilled' || reconciliation.status !== 'fulfilled') {
      throw new Error('Approved acquisition failed or evidence could not be verified');
    }
    const report = {
      schema:'gpd-partner-review-v1',
      status:'review_required',
      snapshot_id:snapshotId,
      merchant_feed:merchantFeed.value,
      reconciliation:reconciliation.value
    };
    const temporary = join(privateDirectory, '.' + randomUUID() + '.tmp');
    const file = await open(temporary, 'wx', 0o600);
    try {
      try {
        await file.writeFile(JSON.stringify(report) + '\n');
        await file.sync();
      } finally {
        await file.close();
      }
      // Publish only after both inputs succeed. link() refuses to replace an existing report.
      await link(temporary, reportPath);
    } finally {
      await unlink(temporary);
    }
    return {status:'review_required',snapshot_id:snapshotId};
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 6) throw new Error('Missing review configuration');
    const result = await runPartnerReview(...process.argv.slice(2));
    process.stdout.write(JSON.stringify({status:result.status}) + '\n');
  } catch {
    process.stderr.write('Partner review failed. Check the private configuration, approval, expected snapshot, and lock.\n');
    process.exitCode = 1;
  }
}
