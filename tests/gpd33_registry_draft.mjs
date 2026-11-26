import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildMcpRegistryDraft,readRegistrySurfaces,verifyMcpRegistryDiscovery} from '../scripts/gpd33_registry_draft.mjs';

const baseline=JSON.parse(await readFile(new URL('../server.json',import.meta.url),'utf8'));
const workerSource=await readFile(new URL('../releases/GPD33_0_COMPLETE_WORKER.js',import.meta.url),'utf8');
const workerModule=await import('data:text/javascript;base64,'+Buffer.from(workerSource).toString('base64'));
const request=(path,options)=>workerModule.default.fetch(new Request(baseline.websiteUrl+path,options),{},{
  waitUntil(){assert.fail('Discovery must not schedule work');}
});
const originalFetch=globalThis.fetch;
globalThis.fetch=()=>assert.fail('Discovery must not call external services');
try{
  const health=await (await request('/health')).json();
  const draft=buildMcpRegistryDraft(baseline,health.version);
  assert.equal(draft.version,health.version);
  assert.equal(draft.name,baseline.name);
  assert.match(draft.description,/anime merchandise/);
  assert.equal(draft.remotes[0].url,baseline.websiteUrl+'/mcp');
  const observed=[];
  const surfaces=await readRegistrySurfaces(baseline.websiteUrl,(url,options)=>{
    const {origin,pathname}=new URL(url);
    assert.equal(origin,baseline.websiteUrl);
    assert.equal(options.redirect,'error');
    assert.ok(options.signal instanceof AbortSignal);
    observed.push(pathname);
    return request(pathname);
  });
  assert.deepEqual(observed,['/health','/.well-known/mcp.json','/.well-known/gpd']);
  verifyMcpRegistryDiscovery(draft,health.build_id,surfaces);
  assert.throws(()=>verifyMcpRegistryDiscovery(draft,'other-build',surfaces),/expected deployment/);
  assert.throws(()=>verifyMcpRegistryDiscovery({...draft,version:'32.0.0'},health.build_id,surfaces),/expected deployment/);
  assert.throws(()=>verifyMcpRegistryDiscovery(draft,health.build_id,{
    ...surfaces,mcp:{...surfaces.mcp,endpoint:'https://other.example/mcp'}
  }),/metadata disagrees/);
  assert.throws(()=>verifyMcpRegistryDiscovery(draft,health.build_id,{
    ...surfaces,gpd:{...surfaces.gpd,purchase_decision_url:'https://other.example/purchase'}
  }),/metadata disagrees/);
  assert.throws(()=>verifyMcpRegistryDiscovery(draft,health.build_id,{
    ...surfaces,gpd:{...surfaces.gpd,commercial_scope:undefined}
  }),/metadata disagrees/);
  assert.throws(()=>buildMcpRegistryDraft(baseline,'33.0.0-preview'),/invalid/);
  assert.throws(()=>buildMcpRegistryDraft({...baseline,description:'x'.repeat(101)},health.version),/invalid/);
  await assert.rejects(readRegistrySurfaces('https://other.example',()=>assert.fail('wrong origin must not make a request')),/origin mismatch/);
  await assert.rejects(readRegistrySurfaces(baseline.websiteUrl,()=>Promise.resolve(new Response('{}',{
    headers:{'content-type':'application/json','content-length':'65537'}
  }))),/invalid response/);

  const mcpCall=(method,params={})=>request('/mcp',{method:'POST',
    headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}).then(response=>response.json());
  assert.equal((await mcpCall('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'offline',version:'1'}}))
    .result.serverInfo.version,draft.version);
  const {result:{tools}}=await mcpCall('tools/list');
  assert.ok(tools.some(tool=>tool.name==='universal_purchase_decision'));
  assert.ok(tools.some(tool=>tool.name==='merchant_directory'));
  const openapi=await (await request('/openapi.json')).json();
  assert.equal(openapi.info.version,draft.version);
  const purchaseDecision=openapi.paths['/v1/purchase-decision'];
  assert.ok(purchaseDecision.post.requestBody.content['application/json']);
  assert.ok(purchaseDecision.post.responses['402']);
  assert.ok(purchaseDecision.get.responses['402']);
  assert.ok(openapi.paths['/v1/merchant/directory'].get);
}finally{globalThis.fetch=originalFetch;}
console.log('PASS MCP registry draft against Worker discovery surfaces, initialized tools and OpenAPI without network');
