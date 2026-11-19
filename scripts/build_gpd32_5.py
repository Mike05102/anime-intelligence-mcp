from pathlib import Path
src=Path('releases/GPD32_4_COMPLETE_WORKER.js').read_text()
def once(old,new):
 global src
 n=src.count(old)
 assert n==1,(old[:100],n)
 src=src.replace(old,new,1)
once('const VERSION="32.4.0";','const VERSION="32.5.0";')
once('20261119-3204-provisional-replay-a1','20261119-3205-ten-thousand-per-domain-a1')
once('const UNIVERSAL_PROACTIVE_SEEDS=Object.entries(UNIVERSAL_EXPANSION_PROFILES).flatMap(([domain,p])=>p.anchors.map(query=>({domain,query})));',
'''// Growth objective: 10,000 distinct verified canonical products per generic domain.
 // This is a TARGET, not a claim about current database counts.
const UNIVERSAL_GENERIC_DOMAIN_TARGET=10000;
const UNIVERSAL_PROACTIVE_SEEDS=Object.entries(UNIVERSAL_EXPANSION_PROFILES).flatMap(([domain,p])=>p.anchors.map(query=>({domain,query})));''')
once('  const rotationCandidates=scored.filter(x=>x.domain===rotationDomain);\n  if(rotationCandidates.length){\n    const preferred=[...rotationCandidates].sort((a,b)=>universalIdentityRoleScore(b)-universalIdentityRoleScore(a))[0];\n    if(eligible(preferred))commit(preferred,"identity");\n  }',
'''  const rotationCandidates=scored.filter(x=>x.domain===rotationDomain);
  // Each domain is visited once every four hours. Rotate product families
  // within that domain instead of repeatedly choosing the highest scoring
  // query, which causes repeated marketplace listings and little new coverage.
  // Rotate through all known anchor families before revisiting an anchor.
  const rotationProfile=genericDomainProfile(rotationDomain);
  const rotationAnchors=Array.isArray(rotationProfile.anchors)?rotationProfile.anchors:[];
  const domainVisit=Math.floor(now/(600000*UNIVERSAL_GENERIC_DOMAINS.length));
  const anchorQuery=rotationAnchors.length?rotationAnchors[domainVisit%rotationAnchors.length]:null;
  const anchorFamily=anchorQuery?universalQueryFamily(rotationDomain,anchorQuery):null;
  const anchorCandidate=anchorFamily?rotationCandidates.find(x=>x.family===anchorFamily):null;
  if(anchorCandidate&&eligible(anchorCandidate))commit(anchorCandidate,"identity");
  else if(rotationCandidates.length){
    // Favor previously untried query families, then proven canonical yield.
    const preferred=[...rotationCandidates].sort((a,b)=>{
      const ar=Number(a.history_runs||0),br=Number(b.history_runs||0);
      if(ar!==br)return ar-br;
      return universalIdentityRoleScore(b)-universalIdentityRoleScore(a);
    })[0];
    if(eligible(preferred))commit(preferred,"identity");
  }''')
once('  await logEvent(env,"universal_expansion_run",{endpoint:"cron",metadata:{budget,selected:picked.length,',
'''  await logEvent(env,"universal_expansion_run",{endpoint:"cron",metadata:{generic_domain_target_per_category:UNIVERSAL_GENERIC_DOMAIN_TARGET,generic_domain_target_count:UNIVERSAL_GENERIC_DOMAINS.length,generic_domain_target_total:UNIVERSAL_GENERIC_DOMAIN_TARGET*UNIVERSAL_GENERIC_DOMAINS.length,rotation_domain:rotationDomain,rotation_anchor_query:anchorQuery,rotation_visit:domainVisit,budget,selected:picked.length,''')
once('  return {ok:true,mode:"checkpointed_canonical_identity_offer_join",budget,selected:picked.length,',
'''  return {ok:true,mode:"checkpointed_canonical_identity_offer_join",generic_domain_target_per_category:UNIVERSAL_GENERIC_DOMAIN_TARGET,generic_domain_target_count:UNIVERSAL_GENERIC_DOMAINS.length,generic_domain_target_total:UNIVERSAL_GENERIC_DOMAIN_TARGET*UNIVERSAL_GENERIC_DOMAINS.length,rotation_domain:rotationDomain,rotation_anchor_query:anchorQuery,budget,selected:picked.length,''')
# Do not manufacture evidence scores for replayed listings that lack
# market price, currency or other reliable purchase evidence.
once('        if(o._provisional_replay&&dg)o.evidence_score=Math.max(55,offerEvidenceScore(o));',
'''        if(o._provisional_replay&&dg)o.evidence_score=offerEvidenceScore(o);''')
once('          if(o._provisional_replay)o.evidence_score=Math.max(55,offerEvidenceScore(o));',
'''          if(o._provisional_replay)o.evidence_score=offerEvidenceScore(o);''')
out=Path('releases/GPD32_5_COMPLETE_WORKER.js')
out.write_text(src)
print('Created',out,out.stat().st_size)
