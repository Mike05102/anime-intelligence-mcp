from pathlib import Path
src=Path('releases/GPD32_6_COMPLETE_WORKER.js').read_text()
def once(old,new):
 global src
 n=src.count(old)
 assert n==1,(old[:100],n)
 src=src.replace(old,new,1)
once('const VERSION="32.6.0";','const VERSION="32.7.0";')
once('20261119-3206-batched-canonical-writes-a1','20261119-3207-identity-throughput-a1')
# Most marketplace offers have no structured identifier. Raise the verified
# eBay detail lookup ceiling from 5 to 10 per 10-minute cron invocation.
# Preserve strict GTIN/manufacturer+MPN gates and per-item error isolation.
once('if(enrichmentDiagnostics.attempted>=5)break;','if(enrichmentDiagnostics.attempted>=10)break;')
once('Math.floor(Date.now()/600000)*5)%identityTargets.length','Math.floor(Date.now()/600000)*10)%identityTargets.length')
once('identity_detail_budget:5','identity_detail_budget:10')
# Replay remains capped at two; at least eight lookups can inspect fresh offers.
out=Path('releases/GPD32_7_COMPLETE_WORKER.js')
out.write_text(src)
print('Created',out,out.stat().st_size)
