import assert from 'node:assert/strict';

export async function testMerchantGtin(worker, domains) {
  const origin='https://gpd.example';
  const env={SUPABASE_URL:'https://db.example',SUPABASE_SECRET_KEY:'fixture-db'};
  const seller='10000000-0000-4000-8000-000000000001';
  const system='10000000-0000-4000-8000-000000000002';
  const ordinary='10000000-0000-4000-8000-000000000003';
  const offer='10000000-0000-4000-8000-000000000004';
  const product='10000000-0000-4000-8000-000000000005';
  const keys='00012345678905';
  let domain='food_grocery', mode='normal';
  const calls=[];
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async input=>{
    const url=new URL(input), query=url.searchParams;
    calls.push(url);
    const row={id:offer,merchant_id:seller,manufacturer:'Example',gtin:'0012345678905',
      stock_status:'in_stock',stock_quantity:1,ships_to:['JP'],price:10,currency:'JPY'};
    if(url.pathname==='/rest/v1/products'){
      assert.equal(query.get('source_product_key'),'eq.universal:gtin:'+keys);
      assert.equal(query.get('metadata->>gpd33_verified'),'eq.true');
      return Response.json(mode==='missing'?[]:[{id:product,source_product_key:'universal:gtin:'+keys,
        product_type:domain,canonical_name_ja:'対象商品',manufacturer:'Example'}]);
    }
    if(url.pathname==='/rest/v1/merchant_offers'){
      assert.equal(query.get('gtin'),'in.(012345678905,0012345678905,00012345678905)');
      assert.equal(query.get('active'),'eq.true');
      assert.equal(query.get('limit'),'40');
      return mode==='failed'?Response.json({error:'unavailable'},{status:503}):Response.json([
        row,
        {...row,id:'10000000-0000-4000-8000-000000000006',manufacturer:'Other'},
        {...row,id:'10000000-0000-4000-8000-000000000007',merchant_id:system},
        {...row,id:'10000000-0000-4000-8000-000000000008',merchant_id:ordinary},
        {...row,id:'10000000-0000-4000-8000-000000000009',stock_quantity:0},
        {...row,id:'10000000-0000-4000-8000-000000000010',gtin:'012345678906'}
      ]);
    }
    if(url.pathname==='/rest/v1/merchants'){
      assert.equal(query.get('verified'),'eq.true');
      return Response.json([
        {id:seller,status:'active',verified:true},
        {id:system,status:'active',verified:true,system_managed:'true'},
        {id:ordinary,status:'active',verified:false}
      ]);
    }
    throw new Error('Unexpected DB request '+url.pathname);
  };
  const request = (gtin,more='')=>worker.fetch(new Request(origin+'/v1/merchant/search?gtin='+gtin+more),env,{waitUntil(){}});
  try {
    for (domain of domains) {
      const countBefore=calls.length;
      const response=await request('012345678905','&buyer_country=JP&limit=1');
      assert.equal(response.status,200,await response.clone().text());
      const result=await response.json();
      assert.equal(result.product.domain,domain);
      assert.equal(result.handoff_candidate_offer_id,offer);
      assert.equal(result.count,1);
      assert.equal(calls.length-countBefore,3);
    }
    const destination=(await (await request('00012345678905','&buyer_country=JP')).json());
    assert.equal(destination.handoff_candidate_offer_id,offer);
    assert.equal(destination.offers.length,3);
    assert.equal(destination.offers.filter(item=>item.handoff_candidate).length,1);
    assert.ok(!JSON.stringify(destination).includes('system_managed'));
    assert.equal((await (await request('0012345678905')).json()).handoff_candidate_offer_id,null);
    assert.equal((await (await request('012345678905','&buyer_country=US')).json()).count,0);
    assert.equal((await request('012345678905','&manufacturer=Different')).status,404);
    assert.equal((await request('012345678905','&part_number=conflict')).status,400);
    const invalidBefore=calls.length;
    assert.equal((await request('012345678906')).status,400);
    assert.equal((await request('012345678905','&limit=0')).status,400);
    assert.equal(calls.length,invalidBefore);
    domain='anime_collectibles';
    assert.equal((await request('012345678905')).status,404);
    domain='food_grocery';
    mode='missing';
    assert.equal((await request('012345678905')).status,404);
    mode='failed';
    assert.equal((await request('012345678905')).status,503);
  } finally {
    globalThis.fetch=originalFetch;
  }
  console.log('PASS verified catalog GTIN matching in all 24 domains and bounded merchant lookup');
}
