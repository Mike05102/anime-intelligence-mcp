import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {link, lstat, open, readdir, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fetchApprovedMerchantOfferFeed, readMerchantFeedApproval} from './gpd33_merchant_feed_fetch.mjs';
import {acquireHttpsGpd33Snapshot, readHttpsEvidenceRegistry} from './gpd33_reconcile_https.mjs';

const snapshotUuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

const temporaryReportName = /^\.gpd-partner-review-[a-f0-9-]{36}\.tmp$/;

function acquireReviewLock(descriptor) {
  return new Promise((resolve,reject) => {
    // FD 3 is a duplicate of the parent's open file description. flock exits immediately;
    // the kernel lock remains active until the parent closes its descriptor or is terminated.
    const child = spawn('flock',['-n','-E','75','3'],{stdio:['ignore','ignore','ignore',descriptor.fd]});
    child.once('error',reject);
    child.once('exit',code => {
      if (code === 0 || code === 75) resolve(code === 0);
      else reject(new Error('Unable to acquire the review file lock'));
    });
  });
}

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
  // Keep the same inode across runs so racing processes always contend on the same lock.
  const lockPath = join(privateDirectory, '.gpd-partner-review.lock');
  const lock = await open(lockPath,constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK,0o600);
  try {
    const lockFile = await lock.stat();
    if (!lockFile.isFile() || lockFile.mode & 0o077 || lockFile.uid !== process.getuid()) {
      throw new Error('A private review lock file owned by the running user is required');
    }
    if (!await acquireReviewLock(lock)) return {status:'review_in_progress',snapshot_id:snapshotId};

    // Each process creates only its own named temporary report while holding this lock.
    for (const name of await readdir(privateDirectory)) {
      if (temporaryReportName.test(name)) await unlink(join(privateDirectory,name));
    }
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
    const temporary = join(privateDirectory, '.gpd-partner-review-' + randomUUID() + '.tmp');
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
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 6) throw new Error('Missing review configuration');
    const result = await runPartnerReview(...process.argv.slice(2));
    process.stdout.write(JSON.stringify({status:result.status}) + '\n');
  } catch {
    process.stderr.write('Partner review failed. Check the private configuration, approval, expected snapshot, and availability of flock.\n');
    process.exitCode = 1;
  }
}
