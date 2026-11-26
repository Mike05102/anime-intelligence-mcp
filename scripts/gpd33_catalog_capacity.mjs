import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
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
const importPath=process.env.GPD33_PG_MODULE;
let client,started=false;

function command(name,args){
  const result=spawnSync(join(postgresBin,name),args,{encoding:'utf8',timeout:60000});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(name+' failed: '+result.stderr.trim());
}

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
  await loadProducts('products',true);
  await loadProducts('products_trimmed',false);
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
  const [current,trimmed,compact,brands,taxonomy,providers]=await Promise.all(
    ['products','products_trimmed','capacity_products','capacity_brand','capacity_domain','capacity_source'].map(size)
  );
  const dictionaries=brands.total_bytes+taxonomy.total_bytes+providers.total_bytes;
  await sql('create index on public.capacity_products using gin (title gin_trgm_ops)');
  const compactTitleSearch=await size('capacity_products');

  await sql(`
    create unlogged table public.capacity_offer(
      product_gtin bigint not null references public.capacity_products(gtin),
      merchant int not null,
      country smallint not null,
      currency smallint not null,
      stock_status smallint not null,
      stock_quantity int,
      price_atomic bigint not null,
      observed_at timestamptz not null,
      url text not null,
      primary key(product_gtin,merchant,country)
    );
    create index on public.capacity_offer(product_gtin,country) where stock_status=1;
    insert into public.capacity_offer
      select gtin14::bigint,seller_id,(variant%8)+1,(variant%8)+1,1,nullif(n%8,0),
        n::bigint*10000,checked_at,offer_url from capacity_samples;
  `);
  await sql('vacuum (analyze) public.capacity_offer');
  const offer=await size('capacity_offer');
  await sql(`update public.capacity_offer set stock_quantity=3,observed_at=observed_at+interval '1 day'
    where product_gtin%10=0`);
  await sql('vacuum (analyze) public.capacity_offer');
  const offerAfterRefresh=await size('capacity_offer');
  for(const table of ['products','products_trimmed','capacity_products','capacity_offer']){
    assert.equal(await scalar('select count(*)::int value from public.'+table),TARGET);
  }
  const exactLookup=await sql('explain (format json) select display_id,title from public.capacity_products where gtin=90000011');
  assert.equal(exactLookup.rows[0]['QUERY PLAN'][0].Plan['Node Type'],'Index Scan');

  const scenarios={
    current:current.total_bytes,
    trimmed_metadata:trimmed.total_bytes,
    compact_exact:compact.total_bytes+dictionaries,
    compact_with_title_search:compactTitleSearch.total_bytes+dictionaries,
    compact_exact_and_one_offer:compact.total_bytes+dictionaries+offer.total_bytes,
    compact_with_title_and_one_offer:compactTitleSearch.total_bytes+dictionaries+offer.total_bytes,
    compact_with_title_and_refreshed_offer:compactTitleSearch.total_bytes+dictionaries+offerAfterRefresh.total_bytes
  };
  const budgets=Object.fromEntries(Object.entries(scenarios).map(([key,bytes])=>{
    const subtotal=NON_EVENT_DB_BASELINE+bytes;
    return [key,{additional_bytes:bytes,bytes_per_product:Math.round(bytes/TARGET),
      subtotal_non_event_baseline_plus_growth:subtotal,balance_to_400m:GPD_BYTES-subtotal,
      balance_to_500m:FREE_DB_BYTES-subtotal}];
  }));
  const legacyPage=await sql(`select id,source_product_key,product_type,manufacturer,canonical_name_ja,
    canonical_name_en,metadata from public.products order by source_product_key limit 40`);
  const compactPage=await sql(`select p.display_id as id,lpad(p.gtin::text,14,'0') as gtin,d.name as product_type,
    b.name as manufacturer,p.title,p.source_record,s.name as source,p.checked_at
    from public.capacity_products p join public.capacity_brand b on b.id=p.brand_id
    join public.capacity_domain d on d.id=p.domain_id join public.capacity_source s on s.id=p.source_id
    order by p.gtin limit 40`);
  const projectionBytes={
    page_size:40,current_product_lookup_utf8_bytes:Buffer.byteLength(JSON.stringify(legacyPage.rows)),
    compact_identity_profile_utf8_bytes:Buffer.byteLength(JSON.stringify(compactPage.rows))
  };
  process.stdout.write(JSON.stringify({
    scope:'synthetic_isolated_postgres',server_version:await scalar("select current_setting('server_version') value"),
    categories:domains.length,products_per_category:10000,total_products:TARGET,
    production_protected_products_historical_bytes:PROTECTED_PRODUCTS_BASELINE,
    production_non_event_db_baseline_bytes:NON_EVENT_DB_BASELINE,projection_bytes:projectionBytes,
    measurements:{current,trimmed,compact,dictionaries,compactTitleSearch,offer,offerAfterRefresh},
    budgets
  },null,2)+'\n');
}finally{
  try{if(client)await client.end();}
  finally{
    try{if(started)command('pg_ctl',['-D',databasePath,'-m','fast','-w','stop']);}
    finally{await rm(parent,{recursive:true,force:true});}
  }
}
