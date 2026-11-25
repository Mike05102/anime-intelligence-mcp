import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function testOfferQuantity(one,offer) {
  const buyer=randomUUID(),gtin='00012345678905';
  const request=(id,units,expected=gtin)=>one(
    "select public.gpd33_request_buyer_handoff($1,$2,$3,$4,'JP',$5) result",
    [buyer,id,offer,units,expected]
  );
  const update = (quantity,stock='in_stock')=>one(`
    update public.merchant_offers set gtin='0012345678905',source_updated_at=now(),
      stock_quantity=$2,stock_status=$3 where id=$1 returning true result`,[offer,quantity,stock]);

  await update(null,'unknown');
  assert.equal((await request(randomUUID(),1)).error,'offer_destination_or_stock_unavailable');
  await update(null);
  const unreported = {ok:false,status:409,error:'offer_stock_quantity_unavailable'};
  assert.deepEqual(await request(randomUUID(),2),unreported);
  assert.deepEqual(await request(randomUUID(),2,null),unreported);
  assert.equal((await request(randomUUID(),101)).error,'invalid_buyer_handoff');
  assert.equal((await request(randomUUID(),1)).ok,true);

  await update(1);
  const bulkKey=randomUUID();
  assert.equal((await request(bulkKey,2)).error,'offer_destination_or_stock_unavailable');
  await update(2);
  const bulk=await request(bulkKey,2);
  assert.equal(bulk.ok,true);
  await update(null);
  const replay=await request(bulkKey,2);
  assert.equal(replay.handoff_id,bulk.handoff_id);
  assert.equal(replay.replayed,true);
  assert.equal((await request(bulkKey,3)).error,'request_id_conflict');

  await one('update public.merchant_offers set gtin=null where id=$1 returning true result',[offer]);
  assert.equal((await request(randomUUID(),2,null)).ok,true);
  console.log('PASS GTIN bulk quantity guard, replay and non-GTIN Parts compatibility');
}
