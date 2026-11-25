import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {auditGpdMcpAcquisition} from '../scripts/gpd33_acquisition_audit.mjs';
import {buildMcpRegistryDraft} from '../scripts/gpd33_registry_draft.mjs';

const baseline=JSON.parse(await readFile(new URL('../server.json',import.meta.url),'utf8'));
const source=await readFile(new URL('../releases/GPD33_0_COMPLETE_WORKER.js',import.meta.url),'utf8');
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const origin=baseline.websiteUrl;
const registryUrl='https://registry.modelcontextprotocol.io/v0.1/servers/'+encodeURIComponent(baseline.name)+'/versions/latest';
const handle=request=>worker.fetch(request,{},{
  waitUntil(){assert.fail('Acquisition audit must not schedule background work');}
});
const health=await (await handle(new Request(origin+'/health'))).json();
const expected=buildMcpRegistryDraft(baseline,health.version);
const now=Date.parse('2026-11-25T10:00:00Z');
const originalFetch=globalThis.fetch;
globalThis.fetch=()=>assert.fail('Acquisition audit fixtures must not use network');
try{
  const requests=[];
  const connection=(options={})=>async(url,input)=>{
    const headers=new Headers(input.headers);
    for(const header of ['authorization','x-merchant-key','x-refresh-key','payment-signature','x-payment']){
      assert.ok(!headers.has(header));
    }
    assert.equal(input.redirect,'error');
    assert.ok(input.signal instanceof AbortSignal);
    if(url===registryUrl){
      requests.push('registry');
      assert.equal(input.method,undefined);
      return options.registryMissing?new Response(null,{status:404}):Response.json({
        server:expected,_meta:{'io.modelcontextprotocol.registry/official':{status:'active',isLatest:true}}
      });
    }
    const endpoint=new URL(url);
    assert.equal(endpoint.origin,origin);
    if(input.method==='POST'){
      assert.equal(endpoint.pathname,'/mcp');
      const message=JSON.parse(input.body);
      requests.push(message.method);
      assert.ok(['initialize','notifications/initialized','tools/list'].includes(message.method));
      if(options.rejectNotice&&message.method==='notifications/initialized')return new Response(null,{status:400});
      if(options.hideTool&&message.method==='tools/list')return Response.json({
        jsonrpc:'2.0',id:2,result:{tools:[{name:'merchant_directory',annotations:{readOnlyHint:true}}]}
      });
    }else{
      assert.ok(['/health','/.well-known/mcp.json','/.well-known/gpd'].includes(endpoint.pathname));
      requests.push(endpoint.pathname);
    }
    return handle(new Request(url,input));
  };
  const run=options=>auditGpdMcpAcquisition(baseline,health.version,health.build_id,{now,fetchImpl:connection(options)});
  assert.deepEqual(await run(),{
    schema:'gpd-mcp-acquisition-audit-v1',scope:'public_mcp_listing_and_read_only_connection',version:health.version,
    build_id:health.build_id,observed_at:'2026-11-25T10:00:00.000Z',registry_status:'listing_verified',
    mcp_connection:'verified',channel_ready:true
  });
  assert.deepEqual(requests,['/health','/.well-known/mcp.json','/.well-known/gpd','registry',
    'initialize','notifications/initialized','tools/list']);
  const absent=await run({registryMissing:true});
  assert.equal(absent.registry_status,'listing_missing');
  assert.equal(absent.mcp_connection,'verified');
  assert.equal(absent.channel_ready,false);
  await assert.rejects(run({rejectNotice:true}),/notice was rejected/);
  await assert.rejects(run({hideTool:true}),/tool metadata disagree/);
  await assert.rejects(auditGpdMcpAcquisition(baseline,health.version,'other-build',{
    now,fetchImpl:connection()
  }),/expected deployment/);
}finally{globalThis.fetch=originalFetch;}
console.log('PASS external MCP acquisition readiness against isolated Worker and official-registry fixtures');
