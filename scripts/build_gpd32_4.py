from pathlib import Path
src=Path('releases/GPD32_3_COMPLETE_WORKER.js').read_text()
def replace_once(old,new):
 global src
 assert src.count(old)==1,(old[:90],src.count(old))
 src=src.replace(old,new,1)
replace_once('const VERSION="32.3.0";','const VERSION="32.4.0";')
replace_once('20261119-3203-identity-coverage-a1','20261119-3204-provisional-replay-a1')
replace_once('    const enrichedOffers=allOffers.map(o=>({...o}));',
'''    // Replay only eBay listing references staged during the last 48h.
    // Replay listings are NOT canonical identities and must pass a fresh
    // provider detail lookup and the existing strict GTIN/brand-MPN gate.
    const enrichedOffers=allOffers.map(o=>({...o}));
    const replayDiagnostics={events_read:0,candidates:0,selected:0,verified:0,errors:[]};
    if(env.EBAY_CLIENT_ID&&env.EBAY_CLIENT_SECRET){
      try{
        const since=new Date(Date.now()-48*3600000).toISOString();
        const history=await sbOptional(env,`/api_events?select=occurred_at,metadata&event_type=eq.universal_provisional_catalog_batch&occurred_at=gte.${encodeURIComponent(since)}&order=occurred_at.desc&limit=12`);
        const rows=Array.isArray(history)?history:[];
        replayDiagnostics.events_read=rows.length;
        const seen=new Set(enrichedOffers.filter(o=>o.provider==="ebay"&&o.id).map(o=>String(o.id)));
        const queue=[];
        for(const event of rows){
          const meta=event?.metadata||{};
          if(String(meta.domain||"")!==domain)continue;
          for(const item of (Array.isArray(meta.items)?meta.items:[])){
            const id=String(item?.listing_id||"");
            if(item?.provider!=="ebay"||!id||seen.has(id)||!item?.title)continue;
            seen.add(id);
            queue.push(item);
          }
        }
        replayDiagnostics.candidates=queue.length;
        // Deterministic rotation avoids permanently selecting the newest IDs.
        const offset=queue.length?(Math.floor(Date.now()/600000)*2)%queue.length:0;
        const selected=queue.slice(offset).concat(queue.slice(0,offset)).slice(0,2);
        replayDiagnostics.selected=selected.length;
        for(const item of selected)enrichedOffers.push({
          provider:"ebay",id:String(item.listing_id),title:String(item.title).slice(0,220),
          brand:item.brand||null,url:item.url||null,merchant:item.merchant||null,
          _provisional_replay:true
        });
      }catch(e){replayDiagnostics.errors.push(safeError(e));}
    }''')
replace_once('    const identityTargets=enrichedOffers.filter(o=>o.provider==="ebay"&&o.id&&!validGtin(digitsOnly(o.gtin||o.jan_code||""))&&!o.mpn&&!o.manufacturer_part_number)',
'''    const identityTargets=enrichedOffers.filter(o=>o.provider==="ebay"&&o.id&&!validGtin(digitsOnly(o.gtin||o.jan_code||""))&&!o.mpn&&!o.manufacturer_part_number)''')
replace_once('    const identityQueue=identityTargets.slice(identityOffset).concat(identityTargets.slice(0,identityOffset));',
'''    // Reserve two of five detail calls for historical provisional candidates.
    // All remaining calls still serve newly discovered live listings.
    const rotated=identityTargets.slice(identityOffset).concat(identityTargets.slice(0,identityOffset));
    const identityQueue=rotated.filter(o=>o._provisional_replay).slice(0,2)
      .concat(rotated.filter(o=>!o._provisional_replay));''')
replace_once('        enrichmentDiagnostics.successful++;',
'''        enrichmentDiagnostics.successful++;
        if(o._provisional_replay)replayDiagnostics.verified++;''')
replace_once('        if(dg){o.gtin=dg;enrichmentDiagnostics.gtin_found++;}',
'''        if(dg){o.gtin=dg;enrichmentDiagnostics.gtin_found++;}
        // Replay has fresh detail evidence only after a successful provider call.
        if(o._provisional_replay&&dg)o.evidence_score=Math.max(55,offerEvidenceScore(o));''')
replace_once('          o.manufacturer_part_number=rawMpn;enrichmentDiagnostics.mpn_found++;',
'''          o.manufacturer_part_number=rawMpn;enrichmentDiagnostics.mpn_found++;
          if(o._provisional_replay)o.evidence_score=Math.max(55,offerEvidenceScore(o));''')
replace_once('provisional_listings_staged:enrichmentDiagnostics.staged','provisional_listings_staged:enrichmentDiagnostics.staged,provisional_replay:replayDiagnostics')
out=Path('releases/GPD32_4_COMPLETE_WORKER.js')
out.write_text(src)
print('Created',out,out.stat().st_size)
