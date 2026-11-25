import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function testOfferFreshness(one,offer) {
  assert.deepEqual(await one(`select jsonb_build_array(
    public.gpd33_offer_source_fresh(now()-interval '7 days'),
    public.gpd33_offer_source_fresh(now()+interval '5 minutes'),
    public.gpd33_offer_source_fresh(now()-interval '7 days 1 second'),
    public.gpd33_offer_source_fresh(now()+interval '5 minutes 1 second'),
    public.gpd33_offer_source_fresh(null)
  ) result`),[true,true,false,false,false]);

  const buyer=randomUUID();
  const key=randomUUID();
  const gtin='00012345678905';
  const request=(id,expectedGtin=gtin,units=1)=>one(
    "select public.gpd33_request_buyer_handoff($1,$2,$3,$4,'JP',$5) result",
    [buyer,id,offer,units,expectedGtin]
  );
  async function updateSource(interval) {
    // Refresh ingestion timestamps too so stale reports cannot borrow recency from import time.
    await one(`update public.merchant_offers set
      source_updated_at=case when $2::interval is null then null else now()+$2::interval end,
      observed_at=now(),updated_at=now() where id=$1 returning true result`,[offer,interval]);
  }
  const before=await one('select count(*)::int result from public.gpd33_buyer_handoffs where buyer_id=$1',[buyer]);
  for(const reportAge of [null,'-7 days -1 minute','6 minutes']){
    await updateSource(reportAge);
    assert.deepEqual(await request(key),{ok:false,status:409,error:'offer_source_not_fresh'});
  }
  assert.equal(await one('select count(*)::int result from public.gpd33_buyer_handoffs where buyer_id=$1',[buyer]),before);
  await updateSource('-6 days');
  const created=await request(key);
  assert.equal(created.ok,true);
  await updateSource('-8 days');
  const replay=await request(key);
  assert.equal(replay.replayed,true);
  assert.equal(replay.handoff_id,created.handoff_id);
  assert.equal((await request(key,gtin,2)).error,'request_id_conflict');
  assert.equal((await request(randomUUID())).error,'offer_source_not_fresh');
  assert.equal((await request(randomUUID(),null)).error,'offer_source_not_fresh','omitting the GTIN must not bypass freshness');
  await one('update public.merchant_offers set gtin=null where id=$1 returning true result',[offer]);
  assert.equal((await request(randomUUID(),null)).ok,true,'a non-GTIN exact-part handoff stays available');
  console.log('PASS catalog handoff source freshness, stale replay, conflict and Parts compatibility');
}
