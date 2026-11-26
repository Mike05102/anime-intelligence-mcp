import {pathToFileURL} from 'node:url';
import {reconcileGpd33Evidence} from './gpd33_reconcile.mjs';
import {readGpd33EvidenceBundle, readGpd33EvidenceRegistry} from './gpd33_reconcile_acquire.mjs';
import {assertFreshHttpsGpd33Evidence} from './gpd33_reconcile_https.mjs';
import {authenticateGpd33OrderQualitySnapshot} from './gpd33_reconcile_signed.mjs';

// The release is a single-file Worker. Tests check this allowlist against its taxonomy.
const genericDomains = new Set([
  'consumer_electronics','automotive_parts','home_appliances','fashion','books_media','toys_hobbies',
  'beauty_personal_care','sports_outdoors','home_living','office_business','medical_supplies','food_grocery',
  'baby_kids','pet_supplies','tools_hardware','garden_outdoor','musical_instruments','jewelry_watches',
  'arts_crafts','industrial_supplies','scientific_lab','restaurant_hospitality','safety_security','general_commerce'
]);
const recentOrderWindow = 7 * 24 * 60 * 60;
const maxPerDomain = 10;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

function claimsByHandoff(rows, valueFor) {
  const claims = new Map();
  for (const row of rows) {
    if (!claims.has(row.handoff_id)) claims.set(row.handoff_id,new Set());
    claims.get(row.handoff_id).add(valueFor(row));
  }
  return claims;
}

/** Snapshot aggregate; never publish or add these counts as cumulative transactions. */
export function exportGpd33CompletedDomainSignal(bundle,trust,expectedSnapshotId,{now=Date.now}={}) {
  if (typeof expectedSnapshotId !== 'string' || !uuid.test(expectedSnapshotId)) {
    throw new Error('Expected domain-signal snapshot UUID is required');
  }
  const {input,metadata}=authenticateGpd33OrderQualitySnapshot(bundle,trust);
  if (metadata.snapshot_id !== expectedSnapshotId) throw new Error('Domain-signal snapshot does not match');
  if (input.environment === 'live') assertFreshHttpsGpd33Evidence(metadata.observed_at,now);

  const handoffs = claimsByHandoff(input.handoffs,row =>
    row.catalog_identity === 'verified_canonical' && genericDomains.has(row.product_domain) ? row.product_domain : null
  );
  const cutoff = metadata.observed_at - recentOrderWindow;
  const orderTimes = claimsByHandoff(input.orders.filter(row => row.state === 'confirmed'),row =>
    Number.isSafeInteger(row.confirmed_at) && row.confirmed_at >= cutoff && row.confirmed_at <= metadata.observed_at
      ? row.confirmed_at : null
  );
  const counts = new Map();
  // Seller invoices and transfers cannot decide which product categories GPD explores.
  const orderEvidence = {...input,fees:[],receipts:[]};
  for (const result of reconcileGpd33Evidence(orderEvidence).results) {
    if (result.order !== 'confirmed') continue;
    const domains = handoffs.get(result.handoff_id);
    const times = orderTimes.get(result.handoff_id);
    if (domains?.size !== 1 || domains.has(null) || times?.size !== 1 || times.has(null)) continue;
    const [domain] = domains;
    counts.set(domain,Math.min(maxPerDomain,(counts.get(domain) || 0)+1));
  }
  return {
    schema:'gpd33-completed-domain-signal-v1',
    environment:input.environment,
    ...metadata,
    counts_by_domain:Object.fromEntries([...counts].sort(([a],[b]) => a.localeCompare(b))
      .map(([domain,count]) => [domain,{confirmed_orders:count,reconciled_invoices:0}]))
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 5) throw new Error('Expected bundle, trust registry and snapshot UUID');
    const [bundle,trust] = await Promise.all([
      readGpd33EvidenceBundle(process.argv[2]),readGpd33EvidenceRegistry(process.argv[3])
    ]);
    const signal = exportGpd33CompletedDomainSignal(bundle,trust,process.argv[4]);
    process.stdout.write(JSON.stringify(signal,null,2)+'\n');
  } catch {
    process.stderr.write('Domain signal export failed. Check the private signed bundle, trust registry and expected snapshot.\n');
    process.exitCode = 1;
  }
}
