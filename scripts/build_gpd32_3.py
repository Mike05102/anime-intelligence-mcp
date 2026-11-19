from pathlib import Path
src=Path('releases/GPD32_2_COMPLETE_WORKER.js').read_text()
replacements=[
 ('if(enrichmentDiagnostics.attempted>=3)break;', 'if(enrichmentDiagnostics.attempted>=5)break;'),
 ('const identityOffset=identityTargets.length?Math.floor(Date.parse(now)/600000)%identityTargets.length:0;', 'const identityOffset=identityTargets.length?(Math.floor(Date.now()/600000)*5)%identityTargets.length:0;'),
 ('const VERSION="32.2.0";','const VERSION="32.3.0";'),
 ('20261119-3202-identity-enrichment-a1','20261119-3203-identity-coverage-a1')
]
for a,b in replacements:
    assert src.count(a)==1,(a,src.count(a))
    src=src.replace(a,b,1)
# More independent detail lookups per cycle; never promote unverifiable listings.
# The diagnostic makes the actual yield per lookup observable.
needle='identity_detail_mpn_found:enrichmentDiagnostics.mpn_found,provisional_listings_staged:enrichmentDiagnostics.staged'
assert src.count(needle)==1
src=src.replace(needle,'identity_detail_mpn_found:enrichmentDiagnostics.mpn_found,identity_detail_yield:enrichmentDiagnostics.attempted?Number(((enrichmentDiagnostics.gtin_found+enrichmentDiagnostics.mpn_found)/enrichmentDiagnostics.attempted).toFixed(3)):0,identity_detail_budget:5,provisional_listings_staged:enrichmentDiagnostics.staged')
out=Path('releases/GPD32_3_COMPLETE_WORKER.js')
out.write_text(src)
print('Wrote',out,out.stat().st_size)
