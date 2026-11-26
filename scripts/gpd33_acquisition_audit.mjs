import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {buildMcpRegistryDraft,readPublicRegistryMetadata,readRegistrySurfaces,verifyMcpRegistryDiscovery} from './gpd33_registry_draft.mjs';
import {observeMcpRegistryListing} from './gpd33_registry_observe.mjs';

const MCP_PROTOCOL='2025-11-25';

async function verifyMcpConnection(endpoint,version,onboarding,fetchImpl){
  const rpc=(id,method,params)=>readPublicRegistryMetadata(endpoint,(url,options)=>fetchImpl(url,{
    ...options,method:'POST',headers:{accept:'application/json, text/event-stream','content-type':'application/json',
      'mcp-protocol-version':MCP_PROTOCOL},body:JSON.stringify({jsonrpc:'2.0',id,method,params})
  }),{maxBytes:128*1024});
  const initialized=await rpc(1,'initialize',{
    protocolVersion:MCP_PROTOCOL,capabilities:{},clientInfo:{name:'gpd-public-acquisition-audit',version:'1.0.0'}
  });
  if(initialized.jsonrpc!=='2.0'||initialized.id!==1||initialized.result?.protocolVersion!==MCP_PROTOCOL
    ||initialized.result.serverInfo?.version!==version||!initialized.result.capabilities?.tools){
    throw new Error('Public MCP initialization did not match the deployment');
  }

  const notice=await fetchImpl(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),
    headers:{accept:'application/json, text/event-stream','content-type':'application/json','mcp-protocol-version':MCP_PROTOCOL},
    body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})});
  await notice.body?.cancel();
  if(notice.status!==202||notice.redirected||(notice.url&&notice.url!==endpoint)){
    throw new Error('Public MCP initialization notice was rejected');
  }

  const listed=await rpc(2,'tools/list',{});
  const tools=listed.result?.tools;
  const free=onboarding?.free_mcp_tools;
  if(listed.jsonrpc!=='2.0'||listed.id!==2||!Array.isArray(tools)||tools.length>100
    ||!Array.isArray(free)||free.length<2||free.length>20
    ||!free.includes('product_resolve')||!free.includes('merchant_directory')||!free.includes('merchant_gtin_search')
    ||onboarding.paid_decision_mcp_tool!=='universal_purchase_decision'){
    throw new Error('Public MCP tool list did not match onboarding');
  }
  const byName=new Map(tools.map(tool=>[tool?.name,tool?.annotations]));
  if(byName.size!==tools.length||free.some(name=>byName.get(name)?.readOnlyHint!==true||byName.get(name)?.paid===true)
    ||byName.get(onboarding.paid_decision_mcp_tool)?.paid!==true
    ||byName.get(onboarding.paid_decision_mcp_tool)?.endpoint!=='/v1/purchase-decision'){
    throw new Error('Public MCP buying tool and free discovery tool metadata disagree');
  }

  const barcode='4901234567894';
  const trial=await rpc(3,'tools/call',{name:'product_resolve',arguments:{gtin:barcode}});
  const resolved=trial.result?.structuredContent;
  if(trial.jsonrpc!=='2.0'||trial.id!==3||trial.result?.isError===true
    ||resolved?.ok!==true||resolved.version!==version||resolved.identifiers?.gtin!==barcode
    ||resolved.identity_key!=='gtin:'+barcode.padStart(14,'0')){
    throw new Error('Public MCP free trial did not resolve the test identifier');
  }
}

const SOLANA_MAINNET='solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOLANA_ADDRESS=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

async function verifyUnsignedChallenge(url,expected,fetchImpl){
  const resourceUrl=url;
  if(expected.jan){
    const requestUrl=new URL(url);
    requestUrl.searchParams.set('gtin',expected.jan);
    url=requestUrl.href;
  }
  const response=await fetchImpl(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(8000),
    headers:{accept:'application/json'}});
  try{
    const header=response.headers.get('payment-required');
    if(response.status!==402||response.redirected||(response.url&&response.url!==url)
      ||!header||header.length>12000||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(header)){
      throw new Error('Unsigned x402 challenge unavailable');
    }
    const challenge=JSON.parse(Buffer.from(header,'base64').toString('utf8'));
    const accepted=Array.isArray(challenge?.accepts)&&challenge.accepts.length===1?challenge.accepts[0]:null;
    if(challenge?.x402Version!==2||challenge.resource?.url!==resourceUrl||accepted?.scheme!=='exact'
      ||accepted.network!==SOLANA_MAINNET||accepted.asset!==USDC||accepted.payTo!==expected.recipient
      ||accepted.amount!==expected.atomicAmount||!SOLANA_ADDRESS.test(accepted.extra?.feePayer||'')){
      throw new Error('Unsigned x402 challenge differs from approved payment terms');
    }
    if(expected.jan){
      const reader=response.body.getReader();
      const chunks=[];
      let size=0;
      try{
        for(;;){
          const {done,value}=await reader.read();
          if(done)break;
          size+=value.byteLength;
          if(size>16384)throw new Error('Unsigned product preview exceeds the byte limit');
          chunks.push(value);
        }
      }finally{reader.releaseLock();}
      const preview=JSON.parse(Buffer.concat(chunks).toString('utf8')).product_preview;
      if(preview?.jan_code!==expected.jan||!preview.canonical_product_id||!preview.name)
        throw new Error('Unsigned product preview does not match the approved JAN');
    }
  }finally{await response.body?.cancel();}
}

export async function auditGpdMcpAcquisition(baseline,expectedVersion,expectedBuild,{fetchImpl=fetch,now=Date.now(),expectedPayment}={}){
  const draft=buildMcpRegistryDraft(baseline,expectedVersion);
  if(typeof expectedBuild!=='string'||!/^[-a-zA-Z0-9._]{1,120}$/.test(expectedBuild)){
    throw new Error('Expected deployed build ID is required');
  }
  if(expectedPayment!==undefined&&(!expectedPayment||typeof expectedPayment.recipient!=='string'
    ||!SOLANA_ADDRESS.test(expectedPayment.recipient)||typeof expectedPayment.atomicAmount!=='string'
    ||!/^[1-9][0-9]{0,11}$/.test(expectedPayment.atomicAmount))){
    throw new Error('Expected x402 recipient and positive USDC atomic amount are required');
  }
  const [surfaces,listing]=await Promise.all([
    readRegistrySurfaces(draft.websiteUrl,fetchImpl),
    observeMcpRegistryListing(baseline,expectedVersion,{fetchImpl,now})
  ]);
  verifyMcpRegistryDiscovery(draft,expectedBuild,surfaces);
  const onboarding=surfaces.gpd.onboarding;
  if(onboarding?.guide_url!==draft.websiteUrl+'/agents'||onboarding.examples_url!==draft.websiteUrl+'/agents/examples'
    ||onboarding.readiness_url!==draft.websiteUrl+'/agents/readiness'||onboarding.mcp_registry_name!==draft.name
    ||onboarding.mcp_transport!==draft.remotes[0].type){
    throw new Error('Public onboarding metadata disagrees with the registry draft');
  }
  await verifyMcpConnection(draft.remotes[0].url,draft.version,onboarding,fetchImpl);
  if(expectedPayment)await verifyUnsignedChallenge(surfaces.gpd.purchase_decision_url,expectedPayment,fetchImpl);
  return {schema:'gpd-mcp-acquisition-audit-v1',scope:'public_mcp_listing_and_read_only_connection',
    version:draft.version,build_id:expectedBuild,observed_at:listing.observed_at,registry_status:listing.status,
    mcp_connection:'verified',free_trial:'product_identity_verified',
    ...(expectedPayment?{unsigned_x402_challenge:'verified'}:{}),
    ...(expectedPayment?.jan?{unsigned_product_preview:'verified'}:{}),channel_ready:listing.status==='listing_verified'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(![4,6,7].includes(process.argv.length)||(process.argv[6]&&!/^(45|49)\d{11}$/.test(process.argv[6])))throw new Error('Expected deployed version and build ID, optionally recipient, atomic amount and catalogue JAN');
    const baseline=JSON.parse(await readFile(new URL('../server.json',import.meta.url),'utf8'));
    const result=await auditGpdMcpAcquisition(baseline,process.argv[2],process.argv[3],{
      expectedPayment:process.argv.length>=6?{recipient:process.argv[4],atomicAmount:process.argv[5],jan:process.argv[6]}:undefined
    });
    process.stdout.write(JSON.stringify(result)+'\n');
    if(!result.channel_ready)process.exitCode=2;
  }catch{
    process.stderr.write('MCP acquisition audit could not verify the expected deployment and public connection.\n');
    process.exitCode=1;
  }
}
