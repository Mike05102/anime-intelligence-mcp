import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {observeMcpRegistryListing} from '../scripts/gpd33_registry_observe.mjs';
import {buildMcpRegistryDraft} from '../scripts/gpd33_registry_draft.mjs';

const baseline=JSON.parse(await readFile(new URL('../server.json',import.meta.url),'utf8'));
const version='33.0.0';
const now=Date.parse('2026-11-25T10:00:00Z');
const draft=buildMcpRegistryDraft(baseline,version);
const metaKey='io.modelcontextprotocol.registry/official';
const document={server:draft,_meta:{[metaKey]:{status:'active',isLatest:true}}};
const endpoint='https://registry.modelcontextprotocol.io/v0.1/servers/io.github.Mike05102%2Fanime-intelligence-mcp/versions/latest';
const expected=(response)=>({
  now,fetchImpl:async(url,options)=>{
    assert.equal(url,endpoint);
    assert.equal(options.redirect,'error');
    assert.deepEqual(options.headers,{accept:'application/json'});
    assert.ok(options.signal instanceof AbortSignal);
    return response;
  }
});
const observe=value=>observeMcpRegistryListing(baseline,version,expected(Response.json(value)));
assert.deepEqual(await observe(document),{
  scope:'official_latest_registry_listing',observed_at:'2026-11-25T10:00:00.000Z',
  registry_name:draft.name,expected_version:version,status:'listing_verified',endpoint:draft.remotes[0].url
});
assert.equal((await observeMcpRegistryListing(baseline,version,expected(new Response('not found',{status:404})))).status,'listing_missing');
assert.equal((await observe({...document,server:{...draft,version:'32.0.0'}})).status,'listing_version_mismatch');
assert.equal((await observe({...document,_meta:{[metaKey]:{status:'deprecated',isLatest:true}}})).status,'listing_not_active_latest');
assert.equal((await observe({...document,_meta:{[metaKey]:{status:'active',isLatest:false}}})).status,'listing_not_active_latest');
assert.equal((await observe({...document,server:{...draft,remotes:[{type:'streamable-http',url:'https://other.example'}]}})).status,'listing_metadata_mismatch');
assert.equal((await observe({...document,server:{...draft,repository:{url:'https://other.example'}}})).status,'listing_metadata_mismatch');
await assert.rejects(observe({server:{...draft,name:'other'},_meta:document._meta}),/expected server/);
await assert.rejects(observe(null),/invalid JSON/);
await assert.rejects(observeMcpRegistryListing(baseline,version,expected(new Response(null,{
  status:302,headers:{location:'https://other.example'}
}))),/invalid response/);
await assert.rejects(observeMcpRegistryListing(baseline,version,expected(Response.json(document,{
  headers:{'content-length':'65537'}
}))),/invalid response/);
console.log('PASS pinned official MCP Registry listing observer (mocks only), including version, identity, exposure and endpoint disagreement');
