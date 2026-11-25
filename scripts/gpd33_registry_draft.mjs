import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const EXPECTED_NAME='io.github.Mike05102/anime-intelligence-mcp';
const EXPECTED_ORIGIN='https://anime-intelligence.goodmy0312.workers.dev';
const EXPECTED_REPO='https://github.com/Mike05102/anime-intelligence-mcp';
const VERSION=/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const BUILD=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/;
const MAX_METADATA_BYTES=64*1024;

export function buildMcpRegistryDraft(baseline,version){
  if(typeof version!=='string'||version.length>30||!VERSION.test(version)
    ||baseline?.name!==EXPECTED_NAME||baseline.websiteUrl!==EXPECTED_ORIGIN
    ||baseline.repository?.url!==EXPECTED_REPO||baseline.repository?.source!=='github'
    ||baseline.$schema!=='https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json'
    ||!Array.isArray(baseline.remotes)||baseline.remotes.length!==1
    ||baseline.remotes[0].type!=='streamable-http'||baseline.remotes[0].url!==EXPECTED_ORIGIN+'/mcp'
    ||typeof baseline.description!=='string'||!baseline.description.trim()||baseline.description.length>100
    ||typeof baseline.title!=='string'||!baseline.title.trim()||baseline.title.length>100){
    throw new Error('Registry baseline or requested version is invalid');
  }
  return {
    $schema:baseline.$schema,name:baseline.name,title:baseline.title,description:baseline.description,
    websiteUrl:baseline.websiteUrl,repository:{url:baseline.repository.url,source:'github'},
    version,remotes:[{type:'streamable-http',url:baseline.remotes[0].url}]
  };
}

export function verifyMcpRegistryDiscovery(draft,expectedBuild,{health,mcp,gpd}){
  const origin=draft.websiteUrl;
  if(typeof expectedBuild!=='string'||!BUILD.test(expectedBuild))throw new Error('Expected Worker build ID is invalid');
  if(health?.ok!==true||health.version!==draft.version||health.build_id!==expectedBuild||health.status!=='online'){
    throw new Error('Worker health does not confirm the expected deployment');
  }
  if(mcp?.version!==draft.version||mcp.endpoint!==draft.remotes[0].url||mcp.transport!=='streamable-http'
    ||!Array.isArray(mcp.supported_protocol_versions)||!mcp.supported_protocol_versions.includes('2025-11-25')){
    throw new Error('Published MCP endpoint metadata disagrees with the registry draft');
  }
  const surface={mcp_url:'/mcp',openapi_url:'/openapi.json',x402_url:'/.well-known/x402',
    merchant_directory_url:'/v1/merchant/directory',purchase_decision_url:'/v1/purchase-decision'};
  if(gpd?.schema!=='gpd-agent-discovery-v1'||Object.entries(surface).some(([key,path])=>gpd[key]!==origin+path)){
    throw new Error('GPD discovery metadata disagrees with the registry draft');
  }
}

export async function readPublicRegistryMetadata(url,fetchImpl,{allowMissing=false,maxBytes=MAX_METADATA_BYTES}={}){
  const response=await fetchImpl(url,{headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(8000)});
  if(response.status===404&&allowMissing&&!response.redirected&&(!response.url||response.url===url)){
    await response.body?.cancel();
    return null;
  }
  const length=response.headers.get('content-length');
  const type=response.headers.get('content-type')||'';
  if(response.status!==200||response.redirected||(response.url&&response.url!==url)||!response.body
    ||!/^application\/json(?:\s*;|$)/i.test(type)
    ||(length!==null&&(!/^\d+$/.test(length)||Number(length)>maxBytes))){
    await response.body?.cancel();
    throw new Error('Registry discovery endpoint returned an invalid response');
  }
  const reader=response.body.getReader();
  let size=0;
  const chunks=[];
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>maxBytes)throw new Error('Registry discovery metadata exceeded the byte limit');
      chunks.push(value);
    }
  }finally{
    await reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
  try{
    const metadata=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));
    if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))throw new Error('Expected metadata object');
    return metadata;
  }
  catch{throw new Error('Registry discovery returned invalid JSON');}
}

export async function readRegistrySurfaces(origin,fetchImpl=fetch){
  if(origin!==EXPECTED_ORIGIN)throw new Error('Production registry origin mismatch');
  const read=path=>readPublicRegistryMetadata(origin+path,fetchImpl);
  const [health,mcp,gpd]=await Promise.all(['/health','/.well-known/mcp.json','/.well-known/gpd'].map(read));
  return {health,mcp,gpd};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const [mode,version,build]=process.argv.slice(2);
    if((mode==='--draft'&&process.argv.length!==4)||(mode==='--live'&&process.argv.length!==5)
      ||!['--draft','--live'].includes(mode))throw new Error('Expected --draft <version> or --live <version> <build-id>');
    const baseline=JSON.parse(await readFile(new URL('../server.json',import.meta.url),'utf8'));
    const draft=buildMcpRegistryDraft(baseline,version);
    if(mode==='--live'){
      if(typeof build!=='string'||!BUILD.test(build))throw new Error('Expected Worker build ID is invalid');
      verifyMcpRegistryDiscovery(draft,build,await readRegistrySurfaces(draft.websiteUrl));
    }
    process.stdout.write(JSON.stringify(draft,null,2)+'\n');
  }catch(error){
    process.stderr.write('Registry draft check failed: '+error.message+'\n');
    process.exitCode=1;
  }
}
