from pathlib import Path
src=Path('releases/GPD32_7_COMPLETE_WORKER.js').read_text()
def once(old,new):
 global src
 n=src.count(old)
 assert n==1,(old[:100],n)
 src=src.replace(old,new,1)
once('const VERSION="32.7.0";','const VERSION="32.8.0";')
once('20261119-3207-identity-throughput-a1','20261120-3208-two-query-growth-a1')
# Remove the hard one-query clamp. Two sequential searches remain bounded
# and each has its own provider/identity diagnostics and canonical gate.
once('Math.max(1,Math.min(1,Number(limit)||1))','Math.max(1,Math.min(2,Number(limit)||1))')
# Do not run two concurrent full searches on the same Cron slot. The main
# scheduled job retains one search; the independent fallback uses two only
# on slots not already assigned to universal discovery.
once('checkpointedUniversalDemandRefresh(env,1,`parallel_${task}`)','checkpointedUniversalDemandRefresh(env,2,`parallel_${task}`)')
# Expand public diagnostics to show both queries rather than hiding the
# second query's result. Keep the response privacy-safe.
once('refreshes.slice(0,3).map(x=>','refreshes.slice(0,6).map(x=>')
out=Path('releases/GPD32_8_COMPLETE_WORKER.js')
out.write_text(src)
print('Created',out,out.stat().st_size)
