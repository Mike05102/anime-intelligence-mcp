import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {buildMcpRegistryDraft,readPublicRegistryMetadata} from './gpd33_registry_draft.mjs';

const REGISTRY_ORIGIN='https://registry.modelcontextprotocol.io';
const OFFICIAL_META='io.modelcontextprotocol.registry/official';

export async function observeMcpRegistryListing(baseline,expectedVersion,{fetchImpl=fetch,now=Date.now()}={}){
  const draft=buildMcpRegistryDraft(baseline,expectedVersion);
  const observedAt=new Date(now).toISOString();
  const url=REGISTRY_ORIGIN+'/v0.1/servers/'+encodeURIComponent(draft.name)+'/versions/latest';
  const listing=await readPublicRegistryMetadata(url,fetchImpl,{allowMissing:true});
  const report={scope:'official_latest_registry_listing',observed_at:observedAt,registry_name:draft.name,
    expected_version:draft.version};
  if(listing===null)return {...report,status:'listing_missing'};
  const server=listing?.server;
  const official=listing?._meta?.[OFFICIAL_META];
  if(server?.name!==draft.name||typeof server.version!=='string'||!official||typeof official.status!=='string'){
    throw new Error('Official registry response did not identify the expected server');
  }
  if(official.status!=='active'||official.isLatest!==true)return {...report,status:'listing_not_active_latest'};
  if(server.version!==draft.version)return {...report,status:'listing_version_mismatch'};
  if(server.websiteUrl!==draft.websiteUrl||server.repository?.url!==draft.repository.url
    ||!Array.isArray(server.remotes)||server.remotes.length!==1
    ||server.remotes[0]?.type!==draft.remotes[0].type||server.remotes[0].url!==draft.remotes[0].url){
    return {...report,status:'listing_metadata_mismatch'};
  }
  return {...report,status:'listing_verified',endpoint:draft.remotes[0].url};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.length!==3)throw new Error('Expected the authorized deployed version');
    const baseline=JSON.parse(await readFile(new URL('../server.json',import.meta.url),'utf8'));
    const report=await observeMcpRegistryListing(baseline,process.argv[2]);
    process.stdout.write(JSON.stringify(report)+'\n');
    if(report.status!=='listing_verified')process.exitCode=2;
  }catch{
    process.stderr.write('Official registry listing could not be verified. Check the expected version and registry availability.\n');
    process.exitCode=1;
  }
}
