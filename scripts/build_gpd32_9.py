from pathlib import Path
src=Path('releases/GPD32_8_COMPLETE_WORKER.js').read_text()
def once(a,b):
 global src
 assert src.count(a)==1,(a[:100],src.count(a))
 src=src.replace(a,b,1)
once('const VERSION="32.8.0";','const VERSION="32.9.0";')
once('20261120-3208-two-query-growth-a1','20261124-3209-bounded-discovery-a1')
once('Math.max(1,Math.min(2,Number(limit)||1))','Math.max(1,Math.min(1,Number(limit)||1))')
once('checkpointedUniversalDemandRefresh(env,2,`parallel_${task}`)','checkpointedUniversalDemandRefresh(env,1,`parallel_${task}`)')
once('if(enrichmentDiagnostics.attempted>=10)break;','if(enrichmentDiagnostics.attempted>=5)break;')
once('Math.floor(Date.now()/600000)*10)%identityTargets.length','Math.floor(Date.now()/600000)*5)%identityTargets.length')
once('identity_detail_budget:10','identity_detail_budget:5')
# Reduce large history scans and sort newest first. Only background planning
# changes; paid purchase decision, canonical validation and batch writes stay intact.
start=src.index('async function universalDemandRefresh(')
end=src.index('const history=explorationHistoryFromRows',start)
seg=src[start:end]
assert seg.count('&limit=240')==4 and seg.count('&limit=600')==1
seg=seg.replace('&limit=240','&order=occurred_at.desc&limit=24').replace('&limit=600','&order=occurred_at.desc&limit=48')
src=src[:start]+seg+src[end:]
once('const ai=Math.floor(now/21600000+di)%anchors.length;','const ai=Math.floor(now/14400000+di)%anchors.length;')
once('const preferred=[...rotationCandidates].sort((a,b)=>universalIdentityRoleScore(b)-universalIdentityRoleScore(a))[0];','''const growthRank=x=>universalIdentityRoleScore(x)+Math.min(4,Number(x.history_canonical_new_count||0)/Math.max(1,Number(x.history_runs||0)))-((Number(x.history_runs||0)>0&&Number(x.history_canonical_new_count||0)===0)?3:0)-(x.last_run_age_hours!==null&&x.last_run_age_hours<4?4:0);
    const preferred=[...rotationCandidates].sort((a,b)=>growthRank(b)-growthRank(a))[0];''')
# Avoid expensive market memory evaluation for autonomous discovery; paid
# decision and ordinary requests retain their original memory behavior.
once('const memory=await loadUniversalMarketMemory(env,domain,identityKey,q,Math.min(12,limit));','const memory=body?._discovery_mode===true?[]:await loadUniversalMarketMemory(env,domain,identityKey,q,Math.min(12,limit));')
# Add compact window telemetry from completed expansion events, not DB counts.
once('const m=latestCompleted?.metadata||{},e=latestExpansion?.metadata||{};','''let growth24h={read_ok:false};
  try{
    const since=new Date(Date.now()-86400000).toISOString();
    const rows=await sb(env,`/api_events?select=occurred_at,metadata&event_type=eq.universal_expansion_run&occurred_at=gte.${encodeURIComponent(since)}&order=occurred_at.desc&limit=150`);
    if(!Array.isArray(rows))throw new Error("telemetry_unavailable");
    const byDomain={};let reported=0;
    for(const row of rows){for(const x of (Array.isArray(row?.metadata?.refreshed)?row.metadata.refreshed:[])){const d=String(x.domain||"unknown");const n=Number(x.canonical_new||0);reported+=n;byDomain[d]=(byDomain[d]||0)+n;}}
    growth24h={read_ok:true,completed_expansion_events:rows.length,expected_cron_slots:144,reported_canonical_new:reported,by_domain:byDomain,possibly_truncated:rows.length>=150,source:"expansion_events_not_database_count"};
  }catch{}
  const m=latestCompleted?.metadata||{},e=latestExpansion?.metadata||{};''')
once('events,latest_discovery:{completed_at:','events,growth_24h:growth24h,latest_discovery:{completed_at:')
out=Path('releases/GPD32_9_COMPLETE_WORKER.js')
out.write_text(src)
print('Created',out,out.stat().st_size)
