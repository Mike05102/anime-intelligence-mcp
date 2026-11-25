import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function testHandoffEvidence(one,seller,offer) {
  const bound=await one(
    "select public.gpd33_request_condition_bound_handoff($1,$2,$3,1,'JP','00012345678905','NEW') result",
    [randomUUID(),randomUUID(),offer]
  );
  assert.equal(bound.ok,true);
  const unbound=randomUUID();
  assert.equal((await one('select public.gpd33_create_handoff($1,$2,1) result',[unbound,offer])).ok,true);
  const reference='3'.repeat(64),unboundRef='4'.repeat(64);
  const binding={handoff_id:bound.handoff_id,merchant_id:seller,order_reference_hash:reference};
  const unboundBinding={handoff_id:unbound,merchant_id:seller,order_reference_hash:unboundRef};
  const event=(handoff,state,hash)=>one('select public.gpd33_record_handoff_event($1,$2,$3,$4,$5) result',
    [seller,handoff,randomUUID(),state,hash]);
  const snapshot=()=>one('select floor(extract(epoch from now()))::int result');
  const evidence=(at,bindings)=>one('select public.gpd33_export_handoff_evidence($1,$2) result',[at,JSON.stringify(bindings)]);

  const initial=await snapshot();
  assert.deepEqual(await evidence(initial,[binding]),{ok:true,rows:[]});
  const bad={ok:false,status:400,error:'invalid_handoff_evidence_bindings'};
  assert.deepEqual(await evidence(initial,[binding,binding]),bad);
  assert.deepEqual(await evidence(initial,Array.from({length:101},()=>({...binding,handoff_id:randomUUID()}))),bad);
  assert.deepEqual(await evidence(initial,[{...binding,customer_id:'PII'}]),bad);
  assert.deepEqual(await evidence(initial,[{...binding,order_reference_hash:'A'.repeat(64)}]),bad);
  for(const at of [initial-86401,initial+310]){
    assert.equal((await evidence(at,[binding])).error,'handoff_evidence_snapshot_not_current');
  }

  for(const [handoff,ref] of [[bound.handoff_id,reference],[unbound,unboundRef]]){
    assert.equal((await event(handoff,'accepted',null)).ok,true);
    assert.equal((await event(handoff,'order_reported',ref)).ok,true);
  }
  const at=await snapshot();
  const expected={...binding,state:'order_reported',product_domain:'food_grocery',catalog_identity:'verified_canonical'};
  assert.deepEqual(await evidence(at,[unboundBinding,binding]),{ok:true,rows:[expected]});
  assert.deepEqual((await evidence(at,[{...binding,merchant_id:randomUUID()}])).rows,[]);
  assert.deepEqual((await evidence(at,[{...binding,order_reference_hash:unboundRef}])).rows,[]);
  assert.deepEqual((await evidence(at-3600,[binding])).rows,[]);

  assert.equal((await event(bound.handoff_id,'cancelled',reference)).ok,true);
  assert.deepEqual((await evidence(await snapshot(),[binding])).rows,[{...expected,state:'cancelled'}]);
  await one("update public.gpd33_handoffs set updated_at=now()-interval '8 days' where id=$1 returning true result",[bound.handoff_id]);
  assert.deepEqual((await evidence(await snapshot(),[binding])).rows,[]);
  console.log('PASS recent exact handoff evidence binding, cancellation, scope, window and payload bounds');
}
