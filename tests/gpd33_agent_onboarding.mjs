import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../releases/GPD33_0_COMPLETE_WORKER.js',import.meta.url),'utf8');
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const origin='https://gpd.example';
const publicKey='sb_publishable_test';
const configured={GPD_BUYER_SELF_SERVICE:'1',GPD_AGENT_SIGNUP_DISCOVERY:'1',
  SUPABASE_URL:'https://buyerproject.supabase.co',SUPABASE_PUBLISHABLE_KEY:publicKey,
  SUPABASE_SECRET_KEY:'do-not-publish-service-key',REFRESH_KEY:'do-not-publish-refresh-key'};
const request=(path,env={},options)=>worker.fetch(new Request(origin+path,options),env,{
  waitUntil(){assert.fail('Onboarding discovery must not schedule background work');}
});
const globalFetch=globalThis.fetch;
globalThis.fetch=()=>assert.fail('Onboarding discovery must not request external services');
try{
  const variants=[
    [{},'unavailable',false],
    [{...configured,GPD_AGENT_SIGNUP_DISCOVERY:'0'},'account_verification_configured',false],
    [{...configured,SUPABASE_URL:'https://custom.example'},'account_verification_configured',false],
    [{...configured,SUPABASE_URL:'http://buyerproject.supabase.co'},'unavailable',false],
    [{...configured,SUPABASE_URL:'https://user:secret@buyerproject.supabase.co'},'unavailable',false],
    [configured,'registration_advertised',true]
  ];
  for(const [env,mode,advertised] of variants){
    const manifestRes=await request('/.well-known/gpd',env);
    assert.equal(manifestRes.status,200);
    const manifest=await manifestRes.json();
    assert.equal(manifest.buyer.mode,mode);
    assert.equal(manifest.onboarding.mcp_transport,'streamable-http');
    assert.equal(Boolean(manifest.buyer.registration),advertised);
    if(advertised){
      assert.deepEqual(manifest.buyer.registration,{project_url:'https://buyerproject.supabase.co',
        publishable_key:publicKey,confirmation_required:true});
    }else{
      assert.doesNotMatch(JSON.stringify(manifest),/sb_publishable_test/);
    }
    const readiness=await (await request('/agents/readiness',env)).json();
    assert.deepEqual(readiness.buyer_configuration,{
      mode,discovery_url:origin+'/.well-known/gpd',scope:'configuration_only'
    });
    const page=await (await request('/agents',env)).text();
    assert.match(page,/href="https:\/\/gpd\.example\/\.well-known\/gpd"/);
    assert.match(page,/href="https:\/\/gpd\.example\/v1\/parts\/search\?query=industrial/);
    assert.match(page,/href="https:\/\/gpd\.example\/v1\/merchant\/directory"/);
    assert.doesNotMatch(page,/sb_publishable_test|buyerproject\.supabase\.co/);
    if(advertised)assert.match(page,/Open the discovery manifest for the registration provider/);
    for(const output of [JSON.stringify(manifest),JSON.stringify(readiness),page]){
      assert.doesNotMatch(output,/do-not-publish-service-key|do-not-publish-refresh-key/);
    }
  }
  const insecure=await request('/v1/agent/account',{...configured,SUPABASE_URL:'http://buyerproject.supabase.co'},{
    headers:{authorization:'Bearer buyer.session.token'}
  });
  assert.equal(insecure.status,503);
  const manifest=await (await request('/.well-known/gpd')).json();
  const tools=await (await request('/mcp',{},{
    method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})
  })).json();
  const byName=new Map(tools.result.tools.map(tool=>[tool.name,tool]));
  for(const name of manifest.onboarding.free_mcp_tools){
    assert.equal(byName.get(name)?.annotations?.readOnlyHint,true);
    assert.notEqual(byName.get(name)?.annotations?.paid,true);
  }
  assert.equal(byName.get(manifest.onboarding.paid_decision_mcp_tool)?.annotations?.paid,true);
  const examples=await (await request('/agents/examples')).json();
  assert.equal(examples.free_product_identity.url,origin+'/v1/product/resolve?gtin=4901234567894&domain=anime_collectibles');
  assert.equal(examples.free_merchant_discovery.url,origin+'/v1/merchant/directory?limit=10');
  assert.equal(examples.discovery.manifest,origin+'/.well-known/gpd');
}finally{globalThis.fetch=globalFetch;}
console.log('PASS buyer activation discovery, conditional public signup and read-only agent quickstart without network');
