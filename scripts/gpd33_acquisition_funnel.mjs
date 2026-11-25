import {createPublicKey, verify} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readBoundedJson} from './gpd33_reconcile_acquire.mjs';

const contexts = {
  journeys:'gpd33-acquisition-journeys-v1',
  outcomes:'gpd33-acquisition-outcomes-v1'
};
const channelId = /^[a-z][a-z0-9_-]{0,49}$/;
const issuerId = /^[A-Za-z0-9_-]{1,80}$/;
const cohortId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const maxWindowSeconds = 31 * 86400;
const maxChannels = 24;
const maxCount = 1000000;
const maxWorkUnits = 24;
const capPerChannel = 4;
const utf8 = new TextDecoder('utf-8',{fatal:true});

function boundedBytes(value,limit) {
  if (typeof value !== 'string' || value.length > Math.ceil(limit*4/3) || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('Invalid acquisition evidence encoding');
  }
  const bytes=Buffer.from(value,'base64url');
  if (bytes.toString('base64url') !== value) throw new Error('Invalid acquisition evidence encoding');
  return bytes;
}

function authenticate(bundle,trust) {
  const environment=bundle?.environment;
  if (!['test','live'].includes(environment) || bundle.schema_version!==1 || trust?.schema_version!==1 ||
    trust.environment!==environment || !trust.issuers || Object.keys(trust.issuers).length!==2 ||
    !trust.channels || !Array.isArray(bundle.envelopes) || bundle.envelopes.length!==2) {
    throw new Error('Pinned acquisition evidence policy is required');
  }
  const channels=Object.entries(trust.channels);
  if (!channels.length || channels.length>maxChannels ||
    channels.some(([channel,policy]) => !channelId.test(channel) || typeof policy?.authorized_free_work!=='boolean')) {
    throw new Error('Invalid acquisition channel policy');
  }
  const byRole=new Map(), keys=new Set();
  let metadata;
  for (const envelope of bundle.envelopes) {
    const issuer=envelope?.issuer;
    if (typeof issuer!=='string' || !issuerId.test(issuer) || !Object.hasOwn(trust.issuers,issuer)) {
      throw new Error('Unknown acquisition evidence issuer');
    }
    const {role,public_key:rawKey}=trust.issuers[issuer] || {};
    if (!Object.hasOwn(contexts,role) || byRole.has(role) || typeof rawKey!=='string' ||
      !/^[a-f0-9]{64}$/.test(rawKey) || keys.has(rawKey)) {
      throw new Error('Acquisition evidence authorities must have different pinned keys and roles');
    }
    keys.add(rawKey);
    const key=createPublicKey({format:'jwk',key:{
      kty:'OKP',crv:'Ed25519',x:Buffer.from(rawKey,'hex').toString('base64url')
    }});
    const payloadBytes=boundedBytes(envelope.payload,128*1024);
    const signature=boundedBytes(envelope.signature,64);
    if (signature.length!==64 || !verify(null,payloadBytes,key,signature)) {
      throw new Error('Invalid acquisition evidence signature');
    }
    const payload=JSON.parse(utf8.decode(payloadBytes));
    const {cohort_id,window_start,window_end}=payload || {};
    if (payload?.issuer!==issuer || payload.context!==contexts[role] || payload.environment!==environment ||
      payload.attribution!=='verified_first_touch' || typeof cohort_id!=='string' || !cohortId.test(cohort_id) ||
      !Number.isSafeInteger(window_start) || !Number.isSafeInteger(window_end) || window_start<1 ||
      window_end<=window_start || window_end-window_start>maxWindowSeconds ||
      !Array.isArray(payload.rows) || payload.rows.length>channels.length) {
      throw new Error('Invalid signed acquisition cohort');
    }
    if (metadata && (metadata.cohort_id!==cohort_id || metadata.window_start!==window_start || metadata.window_end!==window_end)) {
      throw new Error('Acquisition cohort evidence does not match');
    }
    metadata={cohort_id,window_start,window_end};
    byRole.set(role,payload.rows);
  }
  return {environment,channels,metadata,journeys:byRole.get('journeys'),outcomes:byRole.get('outcomes')};
}

const count=value => Number.isSafeInteger(value) && value>=0 && value<=maxCount;
const money=value => value===null || (typeof value==='string' && /^(0|[1-9][0-9]{0,23})$/.test(value));

function indexChannels(rows,channels) {
  const indexed=new Map();
  for (const row of rows) {
    if (!row || !channels.has(row.channel) || indexed.has(row.channel)) {
      throw new Error('Unknown or repeated acquisition measurement channel');
    }
    indexed.set(row.channel,row);
  }
  return indexed;
}

function linkEvidence(channels,journeys,outcomes) {
  const allowed=new Set(channels.map(([channel]) => channel));
  const byJourney=indexChannels(journeys,allowed);
  const byOutcome=indexChannels(outcomes,allowed);
  return channels.map(([channel]) => {
    const journey=byJourney.get(channel);
    const outcome=byOutcome.get(channel);
    const {visits=null,activations=null,handoffs=null}=journey || {};
    const {verified_orders=null,x402_information_usdc_atomic=null,brokerage_usdc_atomic=null}=outcome || {};
    if (journey && (![visits,activations,handoffs].every(count) || activations>visits || handoffs>activations)) {
      throw new Error('Invalid linked acquisition journey counts');
    }
    if (outcome && (!journey || (verified_orders!==null && (!count(verified_orders) || verified_orders>handoffs)) ||
      !money(x402_information_usdc_atomic) || !money(brokerage_usdc_atomic) ||
      (brokerage_usdc_atomic!==null && brokerage_usdc_atomic!=='0' && !(verified_orders>0)))) {
      throw new Error('Invalid or unlinked acquisition outcome counts');
    }
    return {channel,visits,activations,handoffs,verified_orders,x402_information_usdc_atomic,brokerage_usdc_atomic};
  });
}

function prioritize(rows,channels,cohort,budget) {
  const available=rows.filter(row => channels.get(row.channel).authorized_free_work)
    .sort((a,b) => a.channel.localeCompare(b.channel));
  if (!available.length) return {requested_units:budget,unallocated_units:budget,allocations:[]};
  // Rotate exact ties across cohorts. All eligible channels get a baseline before units are repeated.
  const start=Number.parseInt(cohort.slice(-8),16)%available.length;
  const ranked=available.map((row,index) => {
    const qualified=row.visits>=20 && row.activations>=5;
    const orderEvidence=row.verified_orders!==null;
    const score=qualified ? (row.handoffs+(orderEvidence?2*row.verified_orders:0))/row.visits : 0;
    return {channel:row.channel,units:0,tie:(index+available.length-start)%available.length,score,
      basis:qualified?(orderEvidence?'verified_orders_and_handoffs':'measured_handoffs'):'limited_or_missing_sample'};
  });
  let remaining=budget;
  while (remaining>0) {
    const candidates=ranked.filter(row => row.units<capPerChannel);
    if (!candidates.length) break;
    candidates.sort((a,b) =>
      Number(a.units>0)-Number(b.units>0) ||
      b.score/(b.units+1)-a.score/(a.units+1) ||
      a.units-b.units || a.tie-b.tie);
    candidates[0].units++;
    remaining--;
  }
  return {
    requested_units:budget,unallocated_units:remaining,
    allocations:ranked.filter(row => row.units>0).map(row => ({
      channel:row.channel,units:row.units,basis:row.basis
    }))
  };
}

/** Offline cohort-scoped funnel. The planning output is a preview and never acts on a channel. */
export function measureSignedGpd33AcquisitionFunnel(bundle,trust,{budget=0}={}) {
  if (!Number.isSafeInteger(budget) || budget<0 || budget>maxWorkUnits) {
    throw new Error('Free acquisition planning budget must be between 0 and 24 units');
  }
  const {environment,channels,metadata,journeys,outcomes}=authenticate(bundle,trust);
  const funnel=linkEvidence(channels,journeys,outcomes);
  return {
    schema:'gpd33-acquisition-funnel-v1',
    scope:environment==='test'?'test_only':'supplied_live_evidence_only',
    ...metadata,attribution:'independently_signed_linked_aggregates',
    channels:funnel,
    planning_only:{environment,...prioritize(funnel,new Map(channels),metadata.cohort_id,budget)}
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [bundleFile,trustFile,units]=process.argv.slice(2);
    if (process.argv.length!==5 || !/^(?:0|[1-9][0-9]?)$/.test(units)) throw new Error('Expected private evidence, trust and budget');
    const [{data:bundle},{data:trust}]=await Promise.all([
      readBoundedJson(bundleFile,512*1024,{privateFile:true}),
      readBoundedJson(trustFile,128*1024,{privateFile:true})
    ]);
    process.stdout.write(JSON.stringify(measureSignedGpd33AcquisitionFunnel(bundle,trust,{budget:Number(units)}))+'\n');
  } catch {
    process.stderr.write('Acquisition funnel preview failed. Check private signed evidence and the budget.\n');
    process.exitCode=1;
  }
}
