import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {readBoundedJson, readGpd33EvidenceRegistry} from './gpd33_reconcile_acquire.mjs';
import {exportGpd33CompletedDomainSignal} from './gpd33_reconcile_domain_signal.mjs';

export async function prepareGpd33GrowthEvidence(bundle, trust, expectedSnapshotId, {
  apply=false, ingest, now
}={}){
  const signal=await exportGpd33CompletedDomainSignal(bundle,trust,expectedSnapshotId,{now});
  if(!apply)return {status:'preview',environment:signal.environment,domain_counts:signal.counts_by_domain};
  if(signal.environment!=='live'||typeof ingest!=='function')throw new Error('Live signed evidence and an approved database connection are required');
  const receipt=await ingest({
    snapshot_id:signal.snapshot_id,observed_at:signal.observed_at,
    environment:signal.environment,domain_counts:signal.counts_by_domain
  });
  if(receipt?.ok!==true||typeof receipt.replayed!=='boolean'){
    throw new Error('Growth signal ingestion was not confirmed');
  }
  return {status:receipt.replayed?'already_applied':'applied',environment:'live'};
}

function ingestWithPsql(payload,env){
  // Use explicit connection settings and PostgreSQL literal quoting for the bounded aggregate.
  if(!/^[a-z0-9.-]+\.[a-z0-9]+$/i.test(env.PGHOST||'')||!/^[a-z0-9_-]+$/i.test(env.PGDATABASE||'')||
    !/^[a-z0-9_.-]+$/i.test(env.PGUSER||'')||env.PGSSLMODE!=='verify-full'){
    throw new Error('Explicit PostgreSQL host, database, user and verify-full TLS are required');
  }
  const {PGSERVICE:_service,PGSERVICEFILE:_serviceFile,...connectionEnv}=env;
  return new Promise((resolve,reject)=>{
    const child=spawn('psql',['--no-psqlrc','--no-password','--quiet','--tuples-only','--no-align',
      '--host',env.PGHOST,'--dbname',env.PGDATABASE,'--username',env.PGUSER,
      '--set','ON_ERROR_STOP=1','--set','snapshot='+payload.snapshot_id,
      '--set','observed='+payload.observed_at,'--set','counts='+JSON.stringify(payload.domain_counts),'--file','-'],
      {env:{...connectionEnv,PGCONNECT_TIMEOUT:'5',PGOPTIONS:'-c statement_timeout=8000'},stdio:['pipe','pipe','ignore'],
        signal:AbortSignal.timeout(15000)});
    let output='';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{
      output+=chunk;
      if(output.length>8192)child.kill();
    });
    child.stdin.on('error',()=>{});
    child.once('error',()=>reject(new Error('Growth signal connection failed')));
    child.once('close',code=>{
      if(code!==0||output.length>8192)return reject(new Error('Growth signal ingestion failed'));
      try{resolve(JSON.parse(output));}catch{reject(new Error('Invalid growth signal receipt'));}
    });
    child.stdin.end("select public.gpd33_ingest_reconciled_growth(:'snapshot'::uuid, :'observed'::bigint, 'live', :'counts'::jsonb);\n");
  });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const [bundleFile,trustFile,snapshot,mode]=process.argv.slice(2);
    const apply=mode==='--apply';
    if(!snapshot||(mode!==undefined&&(!apply||process.env.GPD_GROWTH_APPLY!=='1'))||process.argv.length>6){
      throw new Error('Invalid growth signal invocation');
    }
    const [{data:bundle},trust]=await Promise.all([
      readBoundedJson(bundleFile,32*1024*1024),readGpd33EvidenceRegistry(trustFile)
    ]);
    const result=await prepareGpd33GrowthEvidence(bundle,trust,snapshot,
      {apply,ingest:payload=>ingestWithPsql(payload,process.env)});
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch{
    process.stderr.write('Growth signal review failed. Verify signed evidence, trust configuration, and authorized database settings.\n');
    process.exitCode=1;
  }
}
