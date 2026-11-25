import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {fingerprintPartnerReview,publishApprovedMerchantFeed} from '../scripts/gpd33_merchant_feed_publish.mjs';
import {assertReconciliationFromHandoff} from './gpd33_reconcile_journey.mjs';
import {createHash, createHmac, generateKeyPairSync, randomUUID, sign} from 'node:crypto';
import {readFile} from 'node:fs/promises';

export async function testHandoffJourney(query, seller, offer) {
  const source = await readFile(new URL('../releases/GPD33_0_COMPLETE_WORKER.js', import.meta.url), 'utf8');
  const {default: worker} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const env = {REFRESH_KEY: 'fixture-admin', SUPABASE_URL: 'https://isolated-db.example', SUPABASE_SECRET_KEY: 'fixture-db'};
  const buyer = randomUUID();
  const merchantKey='mai_000000000000000000000000fixture';
  const buyerToken = 'fixture.buyer.token';
  const otherBuyer = randomUUID();
  const keys = generateKeyPairSync('ed25519');
  const rawKey = Buffer.from(keys.publicKey.export({format:'jwk'}).x,'base64url').toString('hex');
  env.GPD_MERCHANT_SIGNING_KEYS = JSON.stringify({[seller]:rawKey});
  const rpc = {
    gpd33_create_handoff: ['handoff', 'offer', 'units'],
    gpd33_import_merchant_stock_feed: ['seller','offers'],
    gpd33_request_condition_bound_handoff: ['buyer', 'request_key', 'offer', 'units', 'country','expected_gtin','expected_condition'],
    gpd33_record_handoff_event: ['seller', 'handoff', 'event', 'new_state', 'reference_hash'],
    gpd33_buyer_handoff_status: ['handoff'],
    gpd33_list_buyer_handoffs: ['buyer','lookup','page_size'],
    gpd33_merchant_handoffs: ['seller','lookup'],
    gpd33_handoff_outcomes: [],
    gpd33_business_outcomes: []
  };
  const originalFetch = globalThis.fetch;
  let dbCalls = 0;
  const pending = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, env.SUPABASE_URL);
    dbCalls++;
    if (url.pathname === '/auth/v1/user') {
      assert.equal(init.headers.apikey, 'fixture-publishable');
      if(init.headers.authorization === 'Bearer fixture.other.token') {
        return Response.json({id:otherBuyer,email_confirmed_at:'2026-11-25T00:00:00Z'});
      }
      return init.headers.authorization === 'Bearer ' + buyerToken
        ? Response.json({id:buyer,email_confirmed_at:'2026-11-25T00:00:00Z'})
        : Response.json({error:'unauthenticated'}, {status:401});
    }
    if (url.pathname === '/rest/v1/products') {
      assert.equal(url.searchParams.get('source_product_key'),'eq.universal:gtin:00012345678905');
      return Response.json([{id:randomUUID(),source_product_key:'universal:gtin:00012345678905',
        product_type:'food_grocery',manufacturer:'Example',canonical_name_ja:'Example Pasta',metadata:{gpd33_verified:true}}]);
    }
    if (url.pathname === '/rest/v1/merchant_offers') {
      const gtin = url.searchParams.get('gtin');
      if(gtin)assert.match(gtin,/^in\.\(/);
      else assert.equal(url.searchParams.get('normalized_part_number'), 'eq.EX-123');
      const eligible = await query("select to_jsonb(o) result from merchant_offers o where id=$1 and active", [offer]);
      const offerFields = {manufacturer:'Example',part_number:'EX-123',gtin:'0012345678905',stock_status:'in_stock',price:12,currency:'JPY',source_updated_at:new Date().toISOString()};
      return Response.json([
        {...eligible,...offerFields,id:randomUUID(),ships_to:[]},
        {...eligible,...offerFields,ships_to:['JP']},
        {...eligible,...offerFields,id:randomUUID(),ships_to:['JP'],stock_status:'out_of_stock'}
      ]);
    }
    if (url.pathname === '/rest/v1/merchants') {
      const merchantKeyHash = createHash('sha256').update(merchantKey).digest('hex');
      if (url.searchParams.has('merchant_api_key_hash')) {
        assert.equal(url.searchParams.get('merchant_api_key_hash'), 'eq.' + merchantKeyHash);
      } else {
        assert.equal(url.searchParams.get('id'), 'in.("' + seller + '")');
      }
      const merchant = await query("select to_jsonb(m) result from merchants m where id=$1 and status='active'", [seller]);
      return Response.json([merchant]);
    }
    const method = url.pathname.split('/').at(-1);
    assert.ok(Object.hasOwn(rpc, method), 'Unexpected request: ' + url.pathname);
    const body = JSON.parse(init.body);
    const keys = rpc[method];
    const parameters = keys.map((_, i) => '$' + (i + 1));
    assert.ok(!init.body.includes('fixture-order'));
    return Response.json(await query('select public.' + method + '(' + parameters.join(',') + ') result', keys.map(key => key==='offers'?JSON.stringify(body[key]):body[key])));
  };
  const request = (path, headers, body, bindings=env) => worker.fetch(new Request('https://gpd.example' + path, {
    method: body ? 'POST' : 'GET', headers: {'content-type': 'application/json', ...headers},
    body: body ? JSON.stringify(body) : undefined
  }), bindings, {waitUntil(task) { pending.push(task); }});
  try {
    const admin = {'x-refresh-key': env.REFRESH_KEY};
    const merchantHeaders={'x-merchant-key':merchantKey};
    const feedPath='/v1/merchant/offers/feed-import';
    const feedOffer={merchant_sku:'fixture-sku',manufacturer:'Example',part_number:'EX-123',
      title:'Updated fixture',gtin:'012345678905',condition:'new',stock_status:'in_stock',stock_quantity:2,price:'12.50',currency:'JPY',
      ships_to:['JP'],product_url:'https://merchant.example/fixture',source_updated_at:new Date().toISOString()};
    const importFeed=(item,merchantId=seller)=>request(feedPath,merchantHeaders,{merchant_id:merchantId,offers:[item]});
    assert.equal((await importFeed(feedOffer,randomUUID())).status,403);
    assert.equal((await request(feedPath,merchantHeaders,{merchant_id:seller,offers:[feedOffer,feedOffer]})).status,400);
    const approvalExpiry=new Date(Date.now()+86400000).toISOString();
    const approval={merchant_id:seller,feed_url:'https://merchant.example/feed.json',
      approved_until:approvalExpiry,product_origins:['https://merchant.example']};
    const review={schema:'gpd-partner-review-v1',status:'review_required',snapshot_id:randomUUID(),
      merchant_feed:{schema:'gpd-merchant-offer-feed-preview-v1',status:'operator_review_required',
        merchant_id:seller,feed_url:approval.feed_url,offer_count:1,upsert_payload:{offers:[feedOffer]}}};
    const writeApproval={schema:'gpd-merchant-feed-write-approval-v1',allow_publish:true,
      snapshot_id:review.snapshot_id,merchant_id:seller,approved_until:approvalExpiry,worker_origin:'https://gpd.example',
      report_sha256:fingerprintPartnerReview(review)};
    const written=await publishApprovedMerchantFeed(review,approval,writeApproval,{
      apiKey:merchantKey,resolve:async()=> '93.184.215.14',
      request:async (url,options)=>{
        const response=url.pathname==='/v1/merchant/me'
          ?Response.json({ok:true,merchant:{id:seller,verified:true}})
          :await request(url.pathname,options.headers,JSON.parse(options.body));
        return Object.assign(Readable.from([Buffer.from(await response.text())]),
          {statusCode:response.status,headers:Object.fromEntries(response.headers)});
      }
    });
    assert.equal(written.new_or_updated,1);
    assert.equal((await (await importFeed(feedOffer)).json()).ignored,1);
    assert.equal((await (await importFeed({...feedOffer,price:'1',source_updated_at:new Date(Date.now()-86400000).toISOString()})).json()).ignored,1);
    const savedOffer=await query("select jsonb_build_object('id',id,'price',price,'stock_quantity',stock_quantity) result from merchant_offers where merchant_sku='fixture-sku'");
    assert.deepEqual(savedOffer,{id:offer,price:12.5,stock_quantity:2});
    const conflict={...feedOffer,part_number:'EX-456',source_updated_at:new Date(Date.now()+60_000).toISOString()};
    assert.equal((await (await importFeed(conflict)).json()).ignored,1);
    const freshOffer={...feedOffer,merchant_sku:'new-fixture-sku'};
    assert.equal((await (await importFeed(freshOffer)).json()).new_or_updated,1);
    assert.equal((await (await importFeed(freshOffer)).json()).ignored,1);
    const unknown={...freshOffer,condition:undefined,stock_quantity:null,source_updated_at:new Date(Date.now()+60000).toISOString()};
    assert.equal((await (await importFeed(unknown)).json()).new_or_updated,1);
    assert.equal(await query("select stock_quantity result from merchant_offers where merchant_sku='new-fixture-sku'"),null);
    assert.equal(await query("select condition result from merchant_offers where merchant_sku='new-fixture-sku'"),'unknown');


    const search = '/v1/merchant/search?part_number=EX-123&manufacturer=Example';
    const unscoped = await (await request(search, {})).json();
    assert.equal(unscoped.handoff_candidate_offer_id, null);
    const scoped = await (await request(search + '&buyer_country=JP', {})).json();
    assert.equal(scoped.handoff_candidate_offer_id, offer);
    assert.equal(scoped.offers.filter(item => item.handoff_candidate).length, 1);
    const generic = await (await request('/v1/merchant/search?gtin=012345678905&buyer_country=JP',{})).json();
    assert.equal(generic.handoff_candidate_offer_id,offer);
    const buyerHeaders = {authorization:'Bearer '+buyerToken};
    const beforeDiscovery = dbCalls;
    const disabledManifest = await (await request('/.well-known/gpd',{})).json();
    assert.equal(disabledManifest.buyer.enabled,false);
    assert.equal(disabledManifest.buyer.registration,null);
    assert.equal(disabledManifest.mcp_url,'https://gpd.example/mcp');
    assert.equal(dbCalls,beforeDiscovery);
    assert.equal((await request('/v1/agent/account',buyerHeaders)).status,503);

    const input = {request_id:randomUUID(),offer_id:generic.handoff_candidate_offer_id,
      quantity:1,buyer_country:'JP',buyer_authorized:true,condition:'new',gtin:generic.product.gtin,buyer_id:randomUUID()};
    const createBuyer = (body,headers=buyerHeaders) => request('/v1/handoffs',headers,body);
    assert.equal((await createBuyer(input)).status,503);
    env.GPD_BUYER_SELF_SERVICE='1';
    env.SUPABASE_PUBLISHABLE_KEY='fixture-publishable';
    const signupEnv={...env,GPD_AGENT_SIGNUP_DISCOVERY:'1',SUPABASE_URL:'https://example.supabase.co',
      SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'};
    const publicResponse=await request('/.well-known/gpd',{},undefined,signupEnv);
    assert.deepEqual((await publicResponse.json()).buyer.registration,{
      project_url:'https://example.supabase.co',publishable_key:'sb_publishable_fixture',confirmation_required:true
    });
    const secretResponse=await request('/.well-known/gpd',{},undefined,{...signupEnv,SUPABASE_PUBLISHABLE_KEY:'sb_secret_fixture'});
    assert.equal((await secretResponse.json()).buyer.registration,null);
    const accountResponse=await request('/v1/agent/account',buyerHeaders);
    assert.equal(accountResponse.headers.get('cache-control'),'no-store');
    assert.deepEqual(await accountResponse.json(),{ok:true,account_id:buyer,verified:true});
    assert.equal((await request('/v1/agent/account',{authorization:'Bearer bad.test.token'})).status,401);

    assert.equal((await createBuyer(input,{authorization:'Bearer bad.test.token'})).status,401);
    assert.equal((await createBuyer({...input,buyer_authorized:false})).status,400);
    assert.equal((await createBuyer({...input,condition:{unexpected:true}})).status,400);
    assert.equal((await createBuyer({...input,condition:'used'})).status,409);
    assert.equal((await createBuyer({...input,buyer_country:'US'})).status,404);
    assert.equal((await createBuyer({...input,quantity:3})).status,404);
    assert.equal((await createBuyer({...input,gtin:'4901234567894'})).status,409);
    const [create,retry] = await Promise.all([createBuyer(input),createBuyer(input)]);
    assert.equal(create.status,200,await create.clone().text());
    assert.equal(retry.status,200,await retry.clone().text());
    const created = await create.json(), repeated = await retry.json();
    const {tracking_token:token,handoff_id:handoff} = created;
    assert.equal(repeated.handoff_id,handoff);
    const historyPath = '/v1/handoffs?request_id=' + input.request_id;
    const historyResponse = await request(historyPath,buyerHeaders);
    assert.equal(historyResponse.status,200);
    assert.equal(historyResponse.headers.get('cache-control'),'no-store');
    const {handoffs:history} = await historyResponse.json();
    assert.equal(history.length,1);
    assert.equal(history[0].handoff_id,handoff);
    assert.equal(history[0].handoff_state,'requested');
    assert.equal(history[0].expected_condition,'NEW');
    assert.equal('buyer_id' in history[0],false);
    assert.equal('tracking_token' in history[0],false);
    assert.equal('order_reference_hash' in history[0],false);
    const foreignHistory = await request(historyPath + '&buyer_id=' + buyer,{authorization:'Bearer fixture.other.token'});
    assert.deepEqual(await foreignHistory.json(),{ok:true,handoffs:[]});
    assert.equal((await request('/v1/handoffs?limit=31',buyerHeaders)).status,400);
    assert.equal(await query('select buyer_id result from gpd33_buyer_handoffs where handoff_id=$1',[handoff]),buyer);
    assert.equal((await createBuyer({...input,quantity:2})).status,409);
    assert.equal((await createBuyer({...input,condition:undefined})).status,409);
    await query("update merchant_offers set condition='used' where id=$1 returning true result",[offer]);
    assert.equal((await createBuyer({...input,condition:'NEW'})).status,200);
    assert.equal((await createBuyer({...input,request_id:randomUUID()})).status,409);
    await query("update merchant_offers set condition='new' where id=$1 returning true result",[offer]);
    const [id, expiry, signature] = token.split('.');
    assert.equal(id, handoff);
    const readStatus = (credential) => request('/v1/handoffs/status', {authorization:'Bearer ' + credential});
    const countBefore = dbCalls;
    assert.equal((await readStatus([randomUUID(), expiry, signature].join('.'))).status, 401);
    const expired = Math.floor(Date.now()/1000) - 1;
    const expiredSignature = createHmac('sha256',env.REFRESH_KEY).update('gpd-handoff-read-v1|' + handoff + '|' + expired).digest('hex');
    assert.equal((await readStatus([handoff,expired,expiredSignature].join('.'))).status,401);
    assert.equal(dbCalls, countBefore, 'Invalid credentials must be rejected before querying Postgres');
    assert.equal((await (await readStatus(token)).json()).handoff_state, 'requested');
    const merchant = {'x-merchant-key':merchantKey};
    const inbox = await (await request('/v1/merchant/handoffs?handoff_id='+handoff,merchant)).json();
    assert.equal(inbox.handoffs[0].destination,'JP');
    assert.equal(inbox.handoffs[0].expected_condition,'NEW');
    assert.ok(!JSON.stringify(inbox).includes(buyer));
    for (const state of ['accepted', 'order_reported', 'cancelled']) {
      const body = {handoff_id:handoff,event_id:randomUUID(),state};
      if (state !== 'accepted') body.order_reference = 'fixture-order';
      const eventPath = '/v1/merchant/handoffs/events';
      assert.equal((await request(eventPath,merchant,body)).status,401);
      const referenceHash = body.order_reference
        ? createHash('sha256').update('gpd33-order|' + seller + '|' + body.order_reference).digest('hex') : null;
      const signedBody = (signedAt) => ({
        ...body, signed_at:signedAt, signature:sign(null,Buffer.from(JSON.stringify([
          'gpd-merchant-handoff-v1',seller,handoff,body.event_id,state,referenceHash,signedAt
        ])),keys.privateKey).toString('hex')
      });
      const now = Math.floor(Date.now()/1000);
      const signed = signedBody(now);
      assert.equal((await request(eventPath,merchant,signedBody(now-301))).status,401);
      assert.equal((await request(eventPath,merchant,{...signed,event_id:randomUUID()})).status,401);
      const recorded = await request(eventPath,merchant,signed);
      assert.equal(recorded.status, 200, await recorded.clone().text());
      const status = await readStatus(token);
      assert.equal(status.headers.get('cache-control'), 'no-store');
      assert.deepEqual(Object.keys(await status.clone().json()).sort(), ['evidence', 'handoff_id', 'handoff_state', 'ok', 'updated_at']);
      const result = await status.json();
      assert.equal(result.evidence,'merchant_reported');
      assert.equal(result.handoff_state, state);
      const replay = await request(eventPath,merchant,signed);
      assert.equal((await replay.json()).replayed, true);
      if (state === 'order_reported' || state === 'cancelled') await assertReconciliationFromHandoff(query,handoff);
    }
    const outcomes = await (await request('/admin/business-outcomes', admin)).json();
    assert.equal(outcomes.merchant_reported_handoffs.orders_reported_by_merchants, 2);
    assert.equal(outcomes.metrics.verified_outcomes.confirmed_goods_transactions, null);
    assert.equal(outcomes.metrics.verified_outcomes.reconciled_external_revenue_usdc, null);
    for(let i=0;i<2;i++){
      assert.equal((await createBuyer({...input,request_id:randomUUID()})).status,200);
    }
    assert.equal((await createBuyer({...input,request_id:randomUUID()})).status,429);
    assert.equal((await createBuyer(input)).status,200);
    const planning = () => query('select public.gpd33_catalog_planning_growth() result');
    assert.deepEqual((await planning()).account_handoff_signals,{});
    const secondBuyer=randomUUID();
    const second=await query('select public.gpd33_request_buyer_handoff($1,$2,$3,1,$4,$5) result',
      [secondBuyer,randomUUID(),offer,'JP',generic.product.gtin]);
    assert.equal(second.ok,true);
    await query('select public.gpd33_record_handoff_event($1,$2,$3,$4,null) result',
      [seller,second.handoff_id,randomUUID(),'accepted']);
    assert.deepEqual((await planning()).account_handoff_signals,{food_grocery:{buyers:2,responsive_sellers:1}});


  } finally {
    await Promise.allSettled(pending);
    globalThis.fetch = originalFetch;
  }
  console.log('PASS Worker-to-PostgreSQL handoff, tracking, retries, cancellation and evidence separation');
}
