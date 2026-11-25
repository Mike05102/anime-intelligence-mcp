import assert from 'node:assert/strict';
import {createHash, createHmac, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';

export async function testHandoffJourney(query, seller, offer) {
  const source = await readFile(new URL('../releases/GPD33_0_COMPLETE_WORKER.js', import.meta.url), 'utf8');
  const {default: worker} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const env = {REFRESH_KEY: 'fixture-admin', SUPABASE_URL: 'https://isolated-db.example', SUPABASE_SECRET_KEY: 'fixture-db'};
  const rpc = {
    gpd33_create_handoff: ['handoff', 'offer', 'units'],
    gpd33_record_handoff_event: ['seller', 'handoff', 'event', 'new_state', 'reference_hash'],
    gpd33_buyer_handoff_status: ['handoff'],
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
    if (url.pathname === '/rest/v1/merchants') {
      const merchantKeyHash = createHash('sha256').update('fixture-merchant').digest('hex');
      assert.equal(url.searchParams.get('merchant_api_key_hash'), 'eq.' + merchantKeyHash);
      const merchant = await query("select to_jsonb(m) result from merchants m where id=$1 and status='active'", [seller]);
      return Response.json([merchant]);
    }
    const method = url.pathname.split('/').at(-1);
    assert.ok(Object.hasOwn(rpc, method), 'Unexpected request: ' + url.pathname);
    const body = JSON.parse(init.body);
    const keys = rpc[method];
    const parameters = keys.map((_, i) => '$' + (i + 1));
    assert.ok(!init.body.includes('fixture-order'));
    return Response.json(await query('select public.' + method + '(' + parameters.join(',') + ') result', keys.map(key => body[key])));
  };
  const request = (path, headers, body) => worker.fetch(new Request('https://gpd.example' + path, {
    method: body ? 'POST' : 'GET', headers: {'content-type': 'application/json', ...headers},
    body: body ? JSON.stringify(body) : undefined
  }), env, {waitUntil(task) { pending.push(task); }});
  try {
    const handoff = randomUUID();
    const admin = {'x-refresh-key': env.REFRESH_KEY};
    const create = await request('/admin/handoffs', admin, {handoff_id:handoff, offer_id:offer, quantity:1, buyer_authorized:true});
    assert.equal(create.status, 200);
    const {tracking_token: token} = await create.json();
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
    const merchant = {'x-merchant-key':'fixture-merchant'};
    for (const state of ['accepted', 'order_reported', 'cancelled']) {
      const body = {handoff_id:handoff,event_id:randomUUID(),state};
      if (state !== 'accepted') body.order_reference = 'fixture-order';
      const recorded = await request('/v1/merchant/handoffs/events', merchant, body);
      assert.equal(recorded.status, 200, await recorded.clone().text());
      const status = await readStatus(token);
      assert.equal(status.headers.get('cache-control'), 'no-store');
      assert.deepEqual(Object.keys(await status.clone().json()).sort(), ['evidence', 'handoff_id', 'handoff_state', 'ok', 'updated_at']);
      const result = await status.json();
      assert.equal(result.evidence,'merchant_reported');
      assert.equal(result.handoff_state, state);
      const replay = await request('/v1/merchant/handoffs/events', merchant, body);
      assert.equal((await replay.json()).replayed, true);
    }
    const outcomes = await (await request('/admin/business-outcomes', admin)).json();
    assert.equal(outcomes.merchant_reported_handoffs.orders_reported_by_merchants, 2);
    assert.equal(outcomes.metrics.verified_outcomes.confirmed_goods_transactions, null);
    assert.equal(outcomes.metrics.verified_outcomes.reconciled_external_revenue_usdc, null);
  } finally {
    await Promise.allSettled(pending);
    globalThis.fetch = originalFetch;
  }
  console.log('PASS Worker-to-PostgreSQL handoff, tracking, retries, cancellation and evidence separation');
}
