import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function testReconciledGrowth(one,concurrent) {
  const statement='select public.gpd33_ingest_reconciled_growth($1,$2,$3,$4) result';
  const count=(confirmed,invoices=confirmed)=>({food_grocery:{confirmed_orders:confirmed,reconciled_invoices:invoices}});
  const submit=(id,time,environment,counts)=>one(statement,[id,time,environment,JSON.stringify(counts)]);
  const plan=()=>one('select public.gpd33_catalog_planning_reconciled() result');
  const now=await one('select floor(extract(epoch from now()))::int result');
  const testId=randomUUID(),liveId=randomUUID();
  const invalid={ok:false,status:400,error:'invalid_reconciled_growth_snapshot'};
  assert.deepEqual(await submit(randomUUID(),now,'unknown',{}),invalid);
  assert.deepEqual(await submit(randomUUID(),now,'live',{anime_collectibles:{confirmed_orders:1,reconciled_invoices:1}}),invalid);
  assert.deepEqual(await submit(randomUUID(),now,'live',count(0,1)),invalid);
  assert.deepEqual(await submit(randomUUID(),now,'live',count(11)),invalid);
  assert.deepEqual(await submit(randomUUID(),now,'live',count('1')),invalid);
  assert.deepEqual(await submit(randomUUID(),now,'live',count(1.5)),invalid);
  assert.deepEqual(await submit(randomUUID(),now,'live',{food_grocery:{...count(1).food_grocery,customer_id:'fixture'}}),invalid);
  const expired=await submit(randomUUID(),now-86401,'live',{});
  assert.equal(expired.error,'reconciled_growth_snapshot_not_current');
  assert.equal((await submit(randomUUID(),now+310,'live',{})).error,expired.error);

  assert.deepEqual(await submit(testId,now,'test',count(10)),{ok:true,replayed:false});
  assert.deepEqual((await plan()).reconciled_transaction_signals,{});
  assert.equal((await submit(testId,now,'live',count(10))).error,'reconciled_growth_snapshot_conflict');
  const liveRequests=[submit(liveId,now-30,'live',count(3,2)),
    concurrent.query(statement,[liveId,now-30,'live',JSON.stringify(count(3,2))]).then(result=>result.rows[0].result)];
  const liveReceipts=await Promise.all(liveRequests);
  assert.equal(liveReceipts.filter(item=>item.ok).length,2);
  assert.deepEqual(liveReceipts.map(item=>item.replayed).sort(),[false,true]);
  assert.equal((await submit(liveId,now-30,'live',count(3))).error,'reconciled_growth_snapshot_conflict');

  await one(`insert into public.gpd33_reconciled_growth(snapshot_id,environment,observed_at,received_at,domain_counts)
    values ($1,'live',$2,now()-interval '8 days','{}') returning true result`,[randomUUID(),now-691200]);
  assert.equal((await submit(randomUUID(),now-40,'live',count(9))).ok,true);
  assert.equal((await plan()).reconciled_transaction_observed_at,now-30);
  assert.deepEqual((await plan()).reconciled_transaction_signals,count(3,2));
  assert.equal(await one("select count(*)::int result from public.gpd33_reconciled_growth where received_at<now()-interval '7 days'"),0);

  assert.equal((await submit(randomUUID(),now-10,'live',{})).ok,true);
  assert.deepEqual((await plan()).reconciled_transaction_signals,{});
  for(let i=0;i<5;i++){
    assert.equal((await submit(randomUUID(),now-20,'live',count(1))).ok,true);
  }
  assert.equal((await submit(randomUUID(),now,'live',count(1))).error,'reconciled_growth_daily_limit');
  assert.deepEqual(await submit(liveId,now-30,'live',count(3,2)),{ok:true,replayed:true});
  console.log('PASS reconciled growth storage bounds, concurrent replay, environment isolation and latest-only planning');
}
