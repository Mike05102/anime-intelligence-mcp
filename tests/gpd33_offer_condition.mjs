import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function testOfferCondition(one,seller,offer) {
  const buyer=randomUUID(),boundKey=randomUUID(),gtin='00012345678905';
  const request=(key,condition,quantity=1)=>one(
    "select public.gpd33_request_condition_bound_handoff($1,$2,$3,$4,'JP',$5,$6) result",
    [buyer,key,offer,quantity,gtin,condition]
  );
  const update=(condition)=>one(`
    update public.merchant_offers set gtin='0012345678905',source_updated_at=now(),
      stock_status='in_stock',stock_quantity=2,condition=$2 where id=$1 returning true result`,[offer,condition]);
  const conditionChanged={ok:false,status:409,error:'offer_condition_changed'};

  await update(null);
  assert.deepEqual(await request(boundKey,'USED'),conditionChanged);
  assert.equal((await request(boundKey,'  ')).error,'invalid_offer_condition');
  assert.equal((await request(boundKey,'A'.repeat(41))).error,'invalid_offer_condition');
  await update(' Ｕｓｅｄ ');
  assert.deepEqual(await request(boundKey,'NEW'),conditionChanged);
  const created=await request(boundKey,'USED');
  assert.equal(created.ok,true);
  await update('new');
  const replay=await request(boundKey,' used ');
  assert.equal(replay.replayed,true);
  assert.equal(replay.handoff_id,created.handoff_id);
  assert.equal((await request(boundKey,'NEW')).error,'request_id_conflict');
  assert.equal((await request(boundKey,null)).error,'request_id_conflict');
  assert.equal((await request(boundKey,'USED',2)).error,'request_id_conflict');
  assert.equal((await request(randomUUID(),'NEW')).ok,true);

  const inbox=await one('select public.gpd33_merchant_handoffs($1,$2) result',[seller,created.handoff_id]);
  assert.equal(inbox.handoffs[0].expected_condition,'USED');
  const unboundKey=randomUUID();
  assert.equal((await request(unboundKey,null)).ok,true);
  assert.equal((await request(unboundKey,null)).replayed,true);
  assert.equal((await request(unboundKey,'NEW')).error,'request_id_conflict');
  console.log('PASS condition-bound GTIN handoff eligibility, seller evidence and replay');
}
