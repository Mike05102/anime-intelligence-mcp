from pathlib import Path
src=Path('releases/GPD32_5_COMPLETE_WORKER.js').read_text()
def once(old,new):
 global src
 assert src.count(old)==1,(old[:100],src.count(old))
 src=src.replace(old,new,1)
once('const VERSION="32.5.0";','const VERSION="32.6.0";')
once('20261119-3205-ten-thousand-per-domain-a1','20261119-3206-batched-canonical-writes-a1')
once('select=source_product_key,canonical_name_ja,canonical_name_en,manufacturer,metadata&source_product_key=in.', 'select=id,source_product_key,jan_code,canonical_name_ja,canonical_name_en,manufacturer,metadata&source_product_key=in.')
needle='''        const confirmed=[];let insertedCount=0;
        for(const row of accepted){'''
repl='''        const confirmed=[];let insertedCount=0;
        // Batch preflight: check all JAN owners in one read instead of one read
        // per candidate. Never assume source_product_key has a unique index.
        // Batch INSERT only fresh, unambiguous identities. Any batch failure
        // falls back to the original individually verified write path.
        const batchInserted=new Set();
        const janCodes=[...new Set(accepted.map(r=>r.jan_code).filter(Boolean))];
        const janOwnerMap=new Map();
        let janPreflightOk=true;
        if(janCodes.length){
          try{
            const janList=janCodes.map(v=>'"'+String(v).replace(/"/g,'\\"')+'"').join(",");
            const janRows=await sb(env,`/products?select=id,source_product_key,jan_code,canonical_name_ja,canonical_name_en,manufacturer,metadata&jan_code=in.(${encodeURIComponent(janList)})&limit=${janCodes.length*2+2}`);
            if(!Array.isArray(janRows))throw new Error("batch_jan_lookup_not_array");
            for(const j of janRows){
              if(janOwnerMap.has(j.jan_code))throw new Error("duplicate_jan_in_database");
              janOwnerMap.set(j.jan_code,j);
            }
          }catch(e){janPreflightOk=false;promotionDiagnostics.batch_preflight_error=safeError(e);}
        }
        const batchCandidates=[];
        if(janPreflightOk){
          const seenKeys=new Set(),seenJans=new Set();
          for(const row of accepted){
            if(existingMap.has(row.source_product_key))continue;
            if(row.jan_code&&(janOwnerMap.has(row.jan_code)||seenJans.has(row.jan_code)))continue;
            if(seenKeys.has(row.source_product_key))continue;
            seenKeys.add(row.source_product_key);
            if(row.jan_code)seenJans.add(row.jan_code);
            batchCandidates.push(row);
          }
        }
        promotionDiagnostics.batch_candidates=batchCandidates.length;
        // Limit the atomic insert batch to bound memory and DB statement size.
        // On a uniqueness race, Postgres rolls back the batch; individual
        // conflict-aware fallback then resolves each identity safely.
        for(let i=0;i<batchCandidates.length;i+=8){
          const group=batchCandidates.slice(i,i+8);
          try{
            const inserted=await sb(env,"/products",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(group)});
            if(!Array.isArray(inserted)||inserted.length!==group.length)throw new Error("batch_insert_not_confirmed");
            const expected=new Set(group.map(x=>x.source_product_key));
            if(inserted.some(x=>!expected.has(x.source_product_key))||new Set(inserted.map(x=>x.source_product_key)).size!==group.length)throw new Error("batch_insert_identity_mismatch");
            for(const row of inserted){batchInserted.add(row.source_product_key);confirmed.push(row);}
            insertedCount+=inserted.length;
          }catch(e){
            promotionDiagnostics.batch_insert_fallback=(promotionDiagnostics.batch_insert_fallback||0)+group.length;
            promotionDiagnostics.batch_insert_error=safeError(e);
            // A response validation error can occur after a committed insert.
            // The per-item path always rechecks source key and JAN ownership.
          }
        }
        promotionDiagnostics.batch_inserted=batchInserted.size;
        for(const row of accepted){
          if(batchInserted.has(row.source_product_key))continue;'''
once(needle,repl)
out=Path('releases/GPD32_6_COMPLETE_WORKER.js')
out.write_text(src)
print('Created',out,out.stat().st_size)
