import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const TARGET=240000;
const PROTECTED_PRODUCTS_BASELINE=284909568;
const NON_EVENT_DB_BASELINE=316607635;
const GPD_BYTES=400000000;
const FREE_DB_BYTES=500000000;
const root=new URL('../',import.meta.url);
const repoFile=path=>readFile(new URL(path,root),'utf8');
const parent=await mkdtemp(join(tmpdir(),'gpd33-capacity-'));
const socket=join(parent,'socket'),databasePath=join(parent,'data');
const postgresBin=resolve(process.argv[2]||'/usr/lib/postgresql/17/bin');
const demandOnly=process.argv.includes('--demand-only');
const logicalCopy=process.argv.includes('--logical-copy');
const archiveRestore=process.argv.includes('--archive-restore');
const retainedEvents=archiveRestore||process.argv.includes('--retained-events');
let activeDatabase=databasePath;
const importPath=process.env.GPD33_PG_MODULE;
let client,started=false;

function execute(name,args){
  const result=spawnSync(name,args,{encoding:'utf8',timeout:60000});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(name+' failed: '+result.stderr.trim());
}
const command=(name,args)=>execute(join(postgresBin,name),args);

try{
  const pg=await import(importPath?pathToFileURL(resolve(importPath)).href:'pg');
  await mkdir(socket,{mode:0o700});
  command('initdb',['-D',databasePath,'-A','trust','-U','postgres','--locale=C.UTF-8','-E','UTF8','--no-instructions']);
  command('pg_ctl',['-D',databasePath,'-l',join(parent,'postgres.log'),'-o',
    `-k "${socket}" -p 55471 -c listen_addresses='' -c maintenance_work_mem=128MB -c timezone=UTC`,'-w','start']);
  started=true;
  client=new pg.default.Client({host:socket,port:55471,user:'postgres',database:'postgres',ssl:false});
  await client.connect();
  const sql=(query,params=[])=>client.query(query,params);
  const scalar=async(query,params=[])=>(await sql(query,params)).rows[0].value;
  const worker=await repoFile('releases/GPD33_0_COMPLETE_WORKER.js');
  const domains=JSON.parse(worker.match(/const UNIVERSAL_GENERIC_DOMAINS=(\[[\s\S]*?\]);/)[1]);
  assert.equal(domains.length,24);
  await sql(await repoFile('tests/gpd33_fixture.sql'));
  await sql(await repoFile('supabase/migrations/20261125053000_gpd33_catalog.sql'));
  await sql(`
    create extension pg_trgm;
    alter table public.products set unlogged;
    alter table public.products
      add column brand text,add column scale text,add column series text,add column edition text,
      add column msrp_jpy numeric(12,2),add column franchise text,add column limited_type text,
      add column official_url text,add column buy_wait_status text,add column image_source_url text,
      add column official_image_url text,add column image_last_checked_at timestamptz,
      add column original_release_date date,add column recommendation_reason text,
      add column recommendation_updated_at timestamptz;
    create index on public.products(brand);
    create index on public.products(franchise);
    create index on public.products(manufacturer);
    create index on public.products using gin (canonical_name_ja gin_trgm_ops);
    create index on public.products using gin (canonical_name_en gin_trgm_ops);
    create unlogged table public.products_trimmed (like public.products including all);
  `);
  const catalogCounts=await sql(`
    create temporary table capacity_samples as
    with source as (
      select n,(n-1)%24+1 as domain_id,lpad((9000000+n)::text,13,'0') as stem,
        (n*17)%3000+1 as brand_id, (n*7)%200+1 as seller_id,
        (n-1)/24 as variant,
        timestamptz '2026-11-26 00:00:00+00' - (n%600000)*interval '1 second' as checked_at
      from generate_series(1,$1) n
    ), coded as (
      select *,stem||((10-(select sum(substr(stem,i,1)::int*case when i%2=1 then 3 else 1 end)
        from generate_series(1,13) i)%10)%10)::text as gtin14,
        ($2::text[])[domain_id] as domain,
        'Fixture Brand '||brand_id as manufacturer
      from source
    )
    select *,case when variant%5=0 then substr(gtin14,2) else substr(gtin14,3) end as reported_gtin,
      domain||' 商品シリーズ '||manufacturer||' '||upper(substr(md5(n::text),1,10))||
        ' モデル / édition '||(n%700)||' '||repeat('型式 ',n%7) as title,
      'https://offers.example.test/products/'||md5((n*3)::text)||'?variant='||variant as offer_url,
      case when domain='food_grocery' and variant%3=0 then 2 else 1 end as source_id
    from coded
  `,[TARGET,domains]);
  assert.equal(catalogCounts.command,'SELECT');
  const distribution=await sql('select domain,count(*)::int n,count(distinct gtin14)::int distinct_n from capacity_samples group by domain');
  assert.equal(distribution.rowCount,24);
  assert.ok(distribution.rows.every(row=>row.n===10000&&row.distinct_n===10000));
  assert.equal(await scalar('select count(distinct gtin14)::int value from capacity_samples'),TARGET);

  const productMetadata=extra=>`jsonb_strip_nulls(jsonb_build_object(
    'universal_commerce',true,'domain',domain,'gpd33_verified',true,
    'canonical_quality','structured_product_barcode','identity_key','gtin:'||gtin14,
    'identifiers',jsonb_build_object('gtin',reported_gtin,'mpn','F-'||n),
    'evidence_level',case when source_id=2 then 'usda_fdc_branded_package' else 'independent_marketplace_fields' end,
    'provider',case when source_id=2 then 'usda_fdc' else 'ebay' end,
    'provider_product_id',md5(n::text),'ingestion_version','33.0.0','gpd33_variant','fixture-'||variant
  ) ${extra})`;
  async function loadProducts(table,keepMarketMetadata){
    const extra=keepMarketMetadata?`||case when source_id=2 then jsonb_build_object(
      'catalog_attribution','USDA Agricultural Research Service, FoodData Central (CC0 1.0)')
      else jsonb_build_object('market_url',offer_url,'merchant','Fixture Seller '||seller_id,
        'last_observed_price',(n%10000)::numeric/100,'last_observed_currency','JPY',
        'last_observed_stock','in_stock','last_observed_shipping',n%50,'market_observed_at',checked_at) end`:
      `||case when source_id=2 then jsonb_build_object(
        'catalog_attribution','USDA Agricultural Research Service, FoodData Central (CC0 1.0)') else '{}'::jsonb end`;
    await sql(`
      insert into public.${table}(canonical_name_ja,canonical_name_en,manufacturer,jan_code,image_status,source_product_key,
        product_type,product_status,identification_confidence,source_last_checked_at,metadata)
      select title,title,manufacturer,case when length(reported_gtin)=13 then reported_gtin end,'pending',
        'universal:gtin:'||gtin14,domain,'active',.9,checked_at,${productMetadata(extra)}
      from capacity_samples
    `);
    await sql('vacuum (analyze) public.'+table);
  }
  if(!demandOnly){
    await loadProducts('products',true);
    await loadProducts('products_trimmed',false);
  }
  await sql(`
    create unlogged table public.capacity_brand(id int primary key,name text not null unique);
    create unlogged table public.capacity_domain(id smallint primary key,name text not null unique);
    create unlogged table public.capacity_source(id smallint primary key,name text not null unique);
    create unlogged table public.capacity_products(
      gtin bigint primary key,
      display_id uuid not null unique default gen_random_uuid(),
      domain_id smallint not null references public.capacity_domain(id),
      brand_id int not null references public.capacity_brand(id),
      source_id smallint not null references public.capacity_source(id),
      source_record bigint not null,
      checked_at timestamptz not null,
      title text not null
    );
    create index on public.capacity_products(domain_id,checked_at);
    insert into public.capacity_brand select distinct brand_id,manufacturer from capacity_samples;
    insert into public.capacity_domain select distinct domain_id,domain from capacity_samples;
    insert into public.capacity_source values (1,'marketplace_structured_match'),(2,'usda_fdc_branded_package');
    insert into public.capacity_products(gtin,domain_id,brand_id,source_id,source_record,checked_at,title)
      select gtin14::bigint,domain_id,brand_id,source_id,n,checked_at,title from capacity_samples;
  `);
  async function size(table){
    const {rows:[result]}=await sql(`select pg_table_size($1::regclass)::bigint table_bytes,
      pg_indexes_size($1::regclass)::bigint index_bytes,pg_total_relation_size($1::regclass)::bigint total_bytes`,
      ['public.'+table]);
    return Object.fromEntries(Object.entries(result).map(([k,v])=>[k,Number(v)]));
  }
  await sql('vacuum (analyze) public.capacity_products');
  const [compact,brands,taxonomy,providers]=await Promise.all(
    ['capacity_products','capacity_brand','capacity_domain','capacity_source'].map(size)
  );
  const dictionaries=brands.total_bytes+taxonomy.total_bytes+providers.total_bytes;
  const measurements={compact,dictionaries};
  const scenarios={compact_exact:compact.total_bytes+dictionaries};
  // Order the initial load by category so BRIN can prune unrelated blocks in category reads.
  // Exact identity lookups retain both btree indexes and arbitrary persisted UUIDs.
  await sql(`
    create unlogged table public.capacity_products_lean(
      gtin bigint primary key,
      display_id uuid not null unique,
      checked_at timestamptz not null,
      source_record bigint not null,
      brand_id int not null references public.capacity_brand(id),
      domain_id smallint not null references public.capacity_domain(id),
      source_id smallint not null references public.capacity_source(id),
      reported_gtin_length smallint not null check (reported_gtin_length in (8,12,13,14)),
      title text not null
    );
    insert into public.capacity_products_lean
      select p.gtin,p.display_id,p.checked_at,p.source_record,p.brand_id,p.domain_id,p.source_id,
        length(s.reported_gtin),p.title
      from public.capacity_products p join capacity_samples s on s.n=p.source_record
      order by p.domain_id,p.gtin;
    create index capacity_lean_category_brin on public.capacity_products_lean using brin(domain_id)
      with (pages_per_range=16,autosummarize=on);
  `);
  await sql('vacuum (analyze) public.capacity_products_lean');
  const leanEvidenceMatches=await scalar(`select count(*)::int value
    from public.capacity_products_lean l join public.capacity_products p using(gtin)
    join capacity_samples s on s.n=l.source_record
    where (l.display_id,l.checked_at,l.source_record,l.brand_id,l.domain_id,l.source_id,l.title)
      =(p.display_id,p.checked_at,p.source_record,p.brand_id,p.domain_id,p.source_id,p.title)
    and right(lpad(l.gtin::text,14,'0'),l.reported_gtin_length)=s.reported_gtin`);
  assert.equal(leanEvidenceMatches,TARGET);
  const leanBatchPlan=await sql(`explain (analyze,buffers,format json)
    select gtin,display_id,checked_at,title from public.capacity_products_lean
    where domain_id=12 order by checked_at desc,gtin limit 40`);
  const leanPlan=leanBatchPlan.rows[0]['QUERY PLAN'][0].Plan;
  const planNames=node=>[(node['Index Name']||node['Node Type']),...(node.Plans||[]).flatMap(planNames)];
  assert.ok(planNames(leanPlan).includes('capacity_lean_category_brin'));
  const leanExactPlan=await sql(`explain (format json)
    select gtin,display_id,source_record from public.capacity_products_lean where gtin=90000011`);
  assert.equal(leanExactPlan.rows[0]['QUERY PLAN'][0].Plan['Node Type'],'Index Scan');
  measurements.lean_category_brin={...await size('capacity_products_lean'),
    matching_evidence_rows:leanEvidenceMatches,category_page_returned:leanPlan['Actual Rows'],
    category_page_plan:planNames(leanPlan),category_page_ms:leanPlan['Actual Total Time']};
  scenarios.lean_category_brin=measurements.lean_category_brin.total_bytes+dictionaries;
  if(!demandOnly){
    const [current,trimmed]=await Promise.all(['products','products_trimmed'].map(size));
    await sql('create index on public.capacity_products using gin (title gin_trgm_ops)');
    const compactTitleSearch=await size('capacity_products');
    await createOfferTable('capacity_offer',false);
    await sql(`
      insert into public.capacity_offer
        select gtin14::bigint,seller_id,(variant%8)+1,(variant%8)+1,1,nullif(n%8,0),
          n::bigint*10000,checked_at,offer_url from capacity_samples
    `);
    await sql('vacuum (analyze) public.capacity_offer');
    const offer=await size('capacity_offer');
    await sql(`update public.capacity_offer set stock_quantity=3,observed_at=observed_at+interval '1 day'
      where product_gtin%10=0`);
    await sql('vacuum (analyze) public.capacity_offer');
    const offerAfterRefresh=await size('capacity_offer');
    for(const table of ['products','products_trimmed','capacity_offer']){
      assert.equal(await scalar('select count(*)::int value from public.'+table),TARGET);
    }
    Object.assign(measurements,{current,trimmed,compactTitleSearch,offer,offerAfterRefresh});
    Object.assign(scenarios,{
      current:current.total_bytes,
      trimmed_metadata:trimmed.total_bytes,
      compact_with_title_search:compactTitleSearch.total_bytes+dictionaries,
      compact_exact_and_one_offer:compact.total_bytes+dictionaries+offer.total_bytes,
      compact_with_title_and_one_offer:compactTitleSearch.total_bytes+dictionaries+offer.total_bytes,
      compact_with_title_and_refreshed_offer:compactTitleSearch.total_bytes+dictionaries+offerAfterRefresh.total_bytes
    });
  }

  async function createOfferTable(table,expiring){
    await sql(`
      create unlogged table public.${table}(
        product_gtin bigint not null references public.capacity_products(gtin),
        merchant int not null,
        country smallint not null,
        currency smallint not null,
        stock_status smallint not null,
        stock_quantity int,
        price_atomic bigint not null,
        observed_at timestamptz not null,
        url text not null
        ${expiring?', expires_at timestamptz not null check(expires_at>observed_at)':''},
        primary key(product_gtin,merchant,country)
      );
      create index on public.${table}(product_gtin,country) where stock_status=1;
      ${expiring?'create index on public.'+table+'(expires_at);':''}
    `);
  }

  const identitySummary=()=>scalar(`select jsonb_build_object(
    'count',count(*),'domains',count(distinct domain_id),
    'gtin_uuid_digest',md5(string_agg(gtin::text||':'||display_id::text,',' order by gtin))
  ) value from public.capacity_products`);
  const originalIdentities=await identitySummary();
  assert.equal(originalIdentities.count,TARGET);
  assert.equal(originalIdentities.domains,domains.length);
  const demandCache=[];
  const sampleStart="timestamptz '2026-11-26 00:00:00+00'";
  for(const [percentage,perDomain] of [[1,100],[5,500],[10,1000]]){
    const table='capacity_demand_'+percentage,limit=perDomain*domains.length;
    const perCohort=perDomain/4;
    await createOfferTable(table,true);
    await sql(`
      insert into public.${table}
      select gtin14::bigint,seller_id,(variant%8)+1,(variant%8)+1,1,nullif(n%8,0),
        n::bigint*10000,${sampleStart}+(variant/$2)*interval '6 hours',offer_url,
        ${sampleStart}+(variant/$2)*interval '6 hours'+interval '24 hours'
      from capacity_samples where variant<$1
    `,[perDomain,perCohort]);
    await sql('vacuum (analyze) public.'+table);
    const initial=await size(table),daily=[];
    assert.equal(await scalar('select count(*)::int value from public.'+table),limit);
    for(let round=0;round<12;round++){
      const from=perDomain+round*perCohort,until=from+perCohort;
      const clock=`${sampleStart}+interval '${24+round*6} hours'`;
      await sql('begin');
      const expired=await sql('delete from public.'+table+' where expires_at<='+clock);
      assert.equal(expired.rowCount,perCohort*domains.length);
      const inserted=await sql(`
        insert into public.${table}
          select gtin14::bigint,seller_id,(variant%8)+1,(variant%8)+1,1,nullif(n%8,0),
            n::bigint*10000,${clock},offer_url,${clock}+interval '24 hours'
          from capacity_samples where variant>=$1 and variant<$2
      `,[from,until]);
      assert.equal(inserted.rowCount,expired.rowCount);
      await sql('commit');
      if(round%4===3){
        await sql('vacuum (analyze) public.'+table);
        daily.push(await size(table));
      }
    }
    assert.equal(await scalar('select count(*)::int value from public.'+table),limit);
    assert.equal(await scalar('select count(*)::int value from public.'+table+
      " where expires_at<="+sampleStart+"+interval '90 hours'"),0);
    const growthBytes=compact.total_bytes+dictionaries+daily.at(-1).total_bytes;
    scenarios['compact_demand_offer_'+percentage+'pct']=growthBytes;
    scenarios['lean_demand_offer_'+percentage+'pct']=scenarios.lean_category_brin+daily.at(-1).total_bytes;
    demandCache.push({percent_of_products:percentage,max_offers:limit,expiry_hours:24,rotation_hours:6,
      rotations:12,initial,daily_after_vacuum:daily});
  }
  assert.deepEqual(await identitySummary(),originalIdentities);
  measurements.demand_cache=demandCache;
  let logicalCopyResult=null;
  if(logicalCopy){
    await sql('create schema capacity_restore');
    const tables=['capacity_brand','capacity_domain','capacity_source','capacity_products','capacity_demand_5'];
    for(const table of tables){
      await sql(`create unlogged table capacity_restore.${table} (like public.${table} including all);
        insert into capacity_restore.${table} select * from public.${table}`);
      assert.equal(await scalar(`select count(*)::int value from (select * from public.${table}
        except select * from capacity_restore.${table}) difference`),0);
      assert.equal(await scalar(`select count(*)::int value from (select * from capacity_restore.${table}
        except select * from public.${table}) difference`),0);
    }
    await sql(`alter table capacity_restore.capacity_products
      add foreign key (brand_id) references capacity_restore.capacity_brand(id),
      add foreign key (domain_id) references capacity_restore.capacity_domain(id),
      add foreign key (source_id) references capacity_restore.capacity_source(id);
      alter table capacity_restore.capacity_demand_5
      add foreign key (product_gtin) references capacity_restore.capacity_products(gtin)`);
    logicalCopyResult={scope:'same_cluster_logical_table_copy',products:TARGET,demand_offers:12000,
      all_rows_and_product_ids_match:true,foreign_keys_validated:true,
      products_total_bytes:(await sql("select pg_total_relation_size('capacity_restore.capacity_products')::bigint bytes")).rows[0].bytes};
  }
  const exactLookup=await sql('explain (format json) select display_id,title from public.capacity_products where gtin=90000011');
  assert.equal(exactLookup.rows[0]['QUERY PLAN'][0].Plan['Node Type'],'Index Scan');

  if(retainedEvents){
    // Match the existing audited index layout and column types.
    await sql(`
      create table public.capacity_retained (like public.api_events including all);
      create index on public.capacity_retained(endpoint);
      create index on public.capacity_retained(event_type);
      create index on public.capacity_retained(payer_hash);
      create index on public.capacity_retained(product_id);
      create index on public.capacity_retained(occurred_at desc);
    `);
    measurements.retained_events=[];
    for(const extraRows of [1000,5000,10000,20000]){
      await sql('truncate public.capacity_retained restart identity');
      await sql(`
        insert into public.capacity_retained(event_type,endpoint,occurred_at,product_id,payer_hash,
          amount_atomic,amount_usdc,payment_network,transaction_hash,metadata)
        select case when n<=118 then (array['payment_retry_received','payment_attempt','payment_verified','paid_call',
          'payment_verify_failed','payment_settlement_failed','x402_failed'])[n%7+1]
          else (array['api_call','universal_product_snapshot','universal_discovery_persist_error'])[n%3+1] end,
          '/v1/fixture/'||n%15,'2026-11-25 18:00:00+00'::timestamptz-n*interval '1 second',
          case when n%3<>0 then md5(n::text)::uuid::text end,case when n<=118 then md5((n+1)::text) end,
          case when n<=118 then 1000000 end,case when n<=118 then 1 end,
          case when n<=118 then 'solana:fixture' end,case when n<=118 then md5((n+2)::text) end,
          jsonb_build_object('request_id','fixture-'||n,'payload',
            (select string_agg(md5(n::text||':'||i),'' order by i) from generate_series(1,case
              when n<=118 then 21 when n%20=0 then 90 else 24 end) i))
        from generate_series(1,118+$1::int) n
      `,[extraRows]);
      await sql('vacuum (analyze) public.capacity_retained');
      const measured=await size('capacity_retained');
      measurements.retained_events.push({fixture_payment_rows:118,fixture_other_rows:extraRows,...measured});
      scenarios['lean_demand1pct_with_'+extraRows+'_retained_fixture_events']=
        scenarios.lean_demand_offer_1pct+measured.total_bytes;
    }
    const before=await scalar('select pg_current_wal_insert_lsn()::text value');
    await sql(`
      create table public.capacity_retained_restore (like public.capacity_retained including all);
      alter table public.capacity_retained_restore enable row level security;
      revoke all on public.capacity_retained_restore from public,anon,authenticated;
      grant select,insert on public.capacity_retained_restore to service_role;
      insert into public.capacity_retained_restore select * from public.capacity_retained order by id;
      select setval(pg_get_serial_sequence('public.capacity_retained_restore','id'),
        (select max(id) from public.capacity_retained_restore));
    `);
    const restoreWalBytes=Number(await scalar(
      'select pg_wal_lsn_diff(pg_current_wal_insert_lsn(),$1::pg_lsn)::bigint value',[before]));
    const differences=await scalar(`select count(*)::int value from (
      (select * from public.capacity_retained except all select * from public.capacity_retained_restore)
      union all
      (select * from public.capacity_retained_restore except all select * from public.capacity_retained)
    ) differences`);
    assert.equal(differences,0);
    const nextId=await scalar(`select nextval(pg_get_serial_sequence('public.capacity_retained_restore','id'))::int value`);
    assert.equal(nextId,20119);
    measurements.retained_restore={scope:'same_cluster_logged_sql_copy',rows:20118,differences,next_id:nextId,
      physical_bytes:(await size('capacity_retained_restore')).total_bytes,generated_wal_bytes:restoreWalBytes};
  }

  const budgets=Object.fromEntries(Object.entries(scenarios).map(([key,bytes])=>{
    const subtotal=NON_EVENT_DB_BASELINE+bytes;
    return [key,{additional_bytes:bytes,bytes_per_product:Math.round(bytes/TARGET),
      subtotal_non_event_baseline_plus_growth:subtotal,balance_to_400m:GPD_BYTES-subtotal,
      balance_to_500m:FREE_DB_BYTES-subtotal}];
  }));
  const legacyPage=demandOnly?null:await sql(`select id,source_product_key,product_type,manufacturer,canonical_name_ja,
    canonical_name_en,metadata from public.products order by source_product_key limit 40`);
  const compactPage=await sql(`select p.display_id as id,lpad(p.gtin::text,14,'0') as gtin,d.name as product_type,
    b.name as manufacturer,p.title,p.source_record,s.name as source,p.checked_at
    from public.capacity_products p join public.capacity_brand b on b.id=p.brand_id
    join public.capacity_domain d on d.id=p.domain_id join public.capacity_source s on s.id=p.source_id
    order by p.gtin limit 40`);
  const projectionBytes={
    page_size:40,current_product_lookup_utf8_bytes:legacyPage?Buffer.byteLength(JSON.stringify(legacyPage.rows)):null,
    compact_identity_profile_utf8_bytes:Buffer.byteLength(JSON.stringify(compactPage.rows))
  };
  if(archiveRestore){
    const targets=[
      ['capacity_brand','id',3000],
      ['capacity_domain','id',24],
      ['capacity_source','id',2],
      ['capacity_products_lean','gtin',TARGET],
      ['capacity_demand_1','product_gtin,merchant,country',2400],
      ['capacity_retained_restore','id',20118]
    ];
    // Keep archive validation independent of unlogged-table recovery semantics.
    await sql(`alter table public.capacity_demand_1
      drop constraint capacity_demand_1_product_gtin_fkey,
      add constraint capacity_demand_1_product_gtin_fkey
        foreign key (product_gtin) references public.capacity_products_lean(gtin)`);
    for(const [table] of targets){
      await sql('alter table public.'+table+' set logged');
    }
    const refreshTable='capacity_products_lean';
    const initial=await size(refreshTable);
    const walStart=await scalar('select pg_current_wal_insert_lsn()::text value');
    const rounds=[];
    for(let round=0;round<7;round++){
      const updated=await sql(`update public.capacity_products_lean
        set checked_at=checked_at+interval '1 day' where source_record % 10=$1`,[round]);
      assert.equal(updated.rowCount,TARGET/10);
      const beforeVacuum=await size(refreshTable);
      await sql('vacuum (analyze) public.capacity_products_lean');
      rounds.push({updated:updated.rowCount,before_vacuum:beforeVacuum,after_vacuum:await size(refreshTable)});
    }
    const refreshWal=Number(await scalar(
      'select pg_wal_lsn_diff(pg_current_wal_insert_lsn(),$1::pg_lsn)::bigint value',[walStart]));
    const stableIdentities=await scalar(`select count(*)::int value
      from public.capacity_products_lean l join public.capacity_products p using(gtin)
      where (l.display_id,l.source_record,l.brand_id,l.domain_id,l.source_id,l.title)
        =(p.display_id,p.source_record,p.brand_id,p.domain_id,p.source_id,p.title)
      and l.checked_at=p.checked_at+case when l.source_record % 10<7 then interval '1 day' else interval '0' end`);
    assert.equal(stableIdentities,TARGET);
    measurements.logged_identity_refresh={initial,rounds,wal_bytes:refreshWal,
      non_event_baseline_plus_peak_bytes:NON_EVENT_DB_BASELINE+dictionaries+
        (await size('capacity_demand_1')).total_bytes+(await size('capacity_retained_restore')).total_bytes+
        Math.max(initial.total_bytes,...rounds.map(round=>round.before_vacuum.total_bytes))};
    async function archiveManifest(){
      const result={};
      for(const [table,order,count] of targets){
        const rows=await scalar(`select jsonb_build_object('rows',count(*),
          'digest',encode(sha256(convert_to(string_agg(row_to_json(r)::text,E'\\n' order by ${order}),'UTF8')),'hex'))
          value from public.${table} r`);
        assert.equal(rows.rows,count);
        const indexes=await scalar(`select jsonb_agg(pg_get_indexdef(indexrelid) order by indexrelid) value
          from pg_index where indrelid=$1::regclass and indisvalid and indisready`,['public.'+table]);
        const constraints=await scalar(`select jsonb_agg(pg_get_constraintdef(oid) order by conname) value
          from pg_constraint where conrelid=$1::regclass and convalidated`,['public.'+table]);
        result[table]={...rows,indexes,constraints};
      }
      result.event_security=await scalar(`select jsonb_build_object('rls',relrowsecurity,
        'anon_select',has_table_privilege('anon',oid,'SELECT'),
        'authenticated_select',has_table_privilege('authenticated',oid,'SELECT'),
        'service_select',has_table_privilege('service_role',oid,'SELECT'),
        'service_insert',has_table_privilege('service_role',oid,'INSERT')) value
        from pg_class where oid='public.capacity_retained_restore'::regclass`);
      assert.deepEqual(result.event_security,{rls:true,anon_select:false,authenticated_select:false,
        service_select:true,service_insert:true});
      return result;
    }
    const expected=await archiveManifest();
    await client.end();
    client=null;
    command('pg_ctl',['-D',activeDatabase,'-m','fast','-w','stop']);
    started=false;
    const archive=join(parent,'physical.tar.gz'), restored=join(parent,'restored');
    execute('tar',['-czf',archive,'-C',databasePath,'.']);
    await mkdir(restored,{mode:0o700});
    execute('tar',['-xzf',archive,'-C',restored]);
    activeDatabase=restored;
    command('pg_ctl',['-D',activeDatabase,'-l',join(parent,'restored.log'),'-o',
      `-k "${socket}" -p 55471 -c listen_addresses='' -c timezone=UTC`,'-w','start']);
    started=true;
    client=new pg.default.Client({host:socket,port:55471,user:'postgres',database:'postgres',ssl:false});
    await client.connect();
    const actual=await archiveManifest();
    assert.deepEqual(actual,expected);
    const nextId=await scalar(`select nextval(pg_get_serial_sequence('public.capacity_retained_restore','id'))::int value`);
    assert.equal(nextId,20120);
    measurements.archive_restore={scope:'synthetic_local_clean_shutdown_physical_archive',
      archive_bytes:(await stat(archive)).size,products:TARGET,offers:2400,retained_events:20118,
      restored_tables:targets.length,row_digests_indexes_constraints_and_rls_match:true,next_event_id:nextId};
  }
  process.stdout.write(JSON.stringify({
    scope:'synthetic_isolated_postgres',server_version:await scalar("select current_setting('server_version') value"),
    categories:domains.length,products_per_category:10000,total_products:TARGET,
    production_protected_products_historical_bytes:PROTECTED_PRODUCTS_BASELINE,
    production_non_event_db_baseline_bytes:NON_EVENT_DB_BASELINE,projection_bytes:projectionBytes,
    measurements,all_product_identities_preserved:true,logical_copy:logicalCopyResult,
    budgets
  },null,2)+'\n');
}finally{
  try{if(client)await client.end();}
  finally{
    try{if(started)command('pg_ctl',['-D',activeDatabase,'-m','fast','-w','stop']);}
    finally{await rm(parent,{recursive:true,force:true});}
  }
}
