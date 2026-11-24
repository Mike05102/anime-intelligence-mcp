from pathlib import Path
src=Path('releases/GPD32_9_COMPLETE_WORKER.js').read_text()
def once(a,b):
 global src
 assert src.count(a)==1,(a[:100],src.count(a))
 src=src.replace(a,b,1)
once('const VERSION="32.9.0";','const VERSION="33.0.0";')
once('20261124-3209-bounded-discovery-a1','20261124-3300-identity-growth-a1')
once('add("version_32",VERSION==="32.0.0");','add("version_33",VERSION==="33.0.0");')
start=src.index('function ebayDetailGtins(detail)')
end=src.index('\n',start)
src=src[:start]+r'''function gpd33StructuredGtin(value,isbn=false){
  const raw=String(value??"").trim().replace(/[\s-]/g,"").toUpperCase();
  if(isbn&&/^\d{9}[\dX]$/.test(raw)&&isbn10Valid(raw)){
    const stem="978"+raw.slice(0,9);let sum=0;
    for(let i=0;i<stem.length;i++)sum+=Number(stem[i])*(i%2?3:1);
    return stem+String((10-sum%10)%10);
  }
  return /^\d{8,14}$/.test(raw)&&!/^(\d)\1+$/.test(raw)&&validGtin(raw)?raw:null;
}
function ebayDetailGtins(detail){
  const values=[];
  const add=(v,isbn=false)=>{for(const x of (Array.isArray(v)?v:[v])){const g=gpd33StructuredGtin(x,isbn);if(g)values.push(g);}};
  for(const p of [detail,detail?.product]){if(!p)continue;for(const k of ["gtin","upc","ean","jan"])add(p[k]);add(p.isbn,true);}
  for(const a of (Array.isArray(detail?.localizedAspects)?detail.localizedAspects:[])){
    const n=String(a?.name||"").trim();
    if(/^(GTIN(?:-\d+)?|UPC|EAN|JAN|ISBN(?:-1[03])?)$/i.test(n))add(a.value,/ISBN/i.test(n));
  }
  const unique=[...new Map(values.map(g=>[g.padStart(14,"0"),g])).values()];
  return unique.length===1?unique:[];
}'''+src[end:]
once('rotated.filter(o=>o._provisional_replay).slice(0,2)','rotated.filter(o=>o._provisional_replay).slice(0,1)')
once('const dg=ebayDetailGtins(detail).find(validGtin);','const dg=ebayDetailGtins(detail)[0];')
once('const payload=prior?{...row,metadata:{...(prior.metadata||{}),...(row.metadata||{})}}:row;', '''if(prior&&(!prior.metadata?.universal_commerce||prior.metadata?.domain!==domain)){
              promotionDiagnostics.existing_other_domain=(promotionDiagnostics.existing_other_domain||0)+1;continue;
            }
            const payload=prior?{...row,metadata:{...(prior.metadata||{}),...(row.metadata||{})}}:row;''')
start=src.index('const existing=await sbOptional(env,',src.index('const promotionRows=[...promotionMap.values()]'))
end=src.index('\n',start)
line=src[start:end]
assert 'source_product_key=in.' in line and line.endswith('||[];'),line
src=src[:start]+line.replace('sbOptional(env,','sb(env,').replace('||[];',';')+'''
      if(!Array.isArray(existing)||new Set(existing.map(x=>x.source_product_key)).size!==existing.length)throw new Error("canonical_preflight_ambiguous");'''+src[end:]
helper='''function gpd33RankQuery(x){
  const runs=Number(x.history_runs||0),newCount=Number(x.history_canonical_new_count||0);
  return (runs===0?1.5:0)+Math.min(5,newCount/Math.max(1,runs))+universalIdentityRoleScore(x)
    -(runs>0&&newCount===0?2:0)-(x.last_run_age_hours!==null&&x.last_run_age_hours<12?3:0);
}
async function gpd33DomainCounts(env,domains){
  const result={};
  for(const domain of domains){
    try{result[domain]=await sbCount(env,"product_type=eq."+encodeURIComponent(domain)+"&metadata->>universal_commerce=eq.true&metadata->>domain=eq."+encodeURIComponent(domain),{mode:"exact"});}
    catch{result[domain]=null;}
  }
  return result;
}
'''
once('async function universalDemandRefresh(env,limit=6){',helper+'async function universalDemandRefresh(env,limit=6){')
once('const rotationDomain=UNIVERSAL_GENERIC_DOMAINS[rotationSlot];','''const baselineDomain=UNIVERSAL_GENERIC_DOMAINS[rotationSlot];
  const alternateDomain=UNIVERSAL_GENERIC_DOMAINS[(rotationSlot+1+Math.floor(now/14400000)%23)%UNIVERSAL_GENERIC_DOMAINS.length];
  const counts=await gpd33DomainCounts(env,[baselineDomain,alternateDomain]);
  const rotationDomain=Math.floor(now/14400000)%3!==0&&counts[baselineDomain]!==null&&counts[alternateDomain]!==null&&counts[baselineDomain]-counts[alternateDomain]>=1000?alternateDomain:baselineDomain;''')
start=src.index('  if(anchorCandidate&&eligible(anchorCandidate))')
end=src.index('  // Regression guard',start)
src=src[:start]+'''  if(rotationCandidates.length){
    const preferred=[...rotationCandidates].sort((a,b)=>(gpd33RankQuery(b)+(b.family===anchorFamily?0.25:0))-(gpd33RankQuery(a)+(a.family===anchorFamily?0.25:0)))[0];
    if(eligible(preferred))commit(preferred,"identity");
  }
'''+src[end:]
once('const m=latestCompleted?.metadata||{},e=latestExpansion?.metadata||{};','''const categoryRows=await gpd33DomainCounts(env,UNIVERSAL_GENERIC_DOMAINS.slice(Math.floor(Date.now()/600000)%6*4,Math.floor(Date.now()/600000)%6*4+4));
  const m=latestCompleted?.metadata||{},e=latestExpansion?.metadata||{};''')
once('events,growth_24h:growth24h,latest_discovery:', 'events,growth_24h:growth24h,category_sample:{counts:categoryRows,target_per_category:10000,scope:"universal_product_rows_not_independently_verified_identities"},latest_discovery:')
out=Path('releases/GPD33_0_CANDIDATE_WORKER.js')
out.write_text(src)
print('Created',out,out.stat().st_size)
def function(name,next_marker):
 a=src.index('function '+name+'(')
 b=src.index(next_marker,a)
 return src[a:b]
test='const assert = require("node:assert/strict");\n'
test+='function digitsOnly(v){return String(v||"").replace(/[^0-9]/g,"");}\n'
test+=function('validGtin','function isbn10Valid')
test+=function('isbn10Valid','function normalizeUniversalIdentifiers')
test+=function('gpd33StructuredGtin','async function ebaySearch')
test+='''
assert.equal(gpd33StructuredGtin("4901234567894"),"4901234567894");
assert.equal(gpd33StructuredGtin("4901234567890"),null);
assert.equal(gpd33StructuredGtin("0000000000000"),null);
assert.equal(gpd33StructuredGtin("0306406152",true),"9780306406157");
assert.deepEqual(ebayDetailGtins({title:"4901234567894"}),[]);
assert.deepEqual(ebayDetailGtins({localizedAspects:[{name:"Serial number",value:"4901234567894"}]}),[]);
assert.deepEqual(ebayDetailGtins({localizedAspects:[{name:"EAN",value:"4901234567894"}]}),["4901234567894"]);
assert.deepEqual(ebayDetailGtins({gtin:"4901234567894",product:{isbn:"0306406152"}}),[]);
console.log("PASS structured identity tests");
'''
Path('/tmp/gpd33-test.cjs').write_text(test)
