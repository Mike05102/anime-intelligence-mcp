-- Read-only inventory. Returns catalog metadata and relation sizes only.
with targets as (
  select c.*, n.nspname
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('products','api_events')
),
service_role as (
  select oid, rolbypassrls from pg_catalog.pg_roles where rolname='service_role'
)
select jsonb_pretty(jsonb_build_object(
  'postgres_version', current_setting('server_version'),
  'statement_timeout', current_setting('statement_timeout'),
  'database_bytes', pg_database_size(current_database()),
  'roles', (select jsonb_object_agg(rolname,rolbypassrls) from pg_catalog.pg_roles
    where rolname in ('service_role','anon','authenticated')),
  'tables', (select jsonb_object_agg(t.relname,jsonb_build_object(
    'kind',t.relkind,'rls',t.relrowsecurity,'estimated_rows',t.reltuples,
    'bytes',pg_total_relation_size(t.oid),
    'privileges',(select jsonb_build_object('select',has_table_privilege(r.oid,t.oid,'SELECT'),
      'insert',has_table_privilege(r.oid,t.oid,'INSERT'),'update',has_table_privilege(r.oid,t.oid,'UPDATE'))
      from service_role r),
    'columns',(select jsonb_object_agg(a.attname,jsonb_build_object(
      'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
      'has_default',a.atthasdef,'identity',a.attidentity,'generated',a.attgenerated))
      from pg_catalog.pg_attribute a where a.attrelid=t.oid and a.attnum>0 and not a.attisdropped),
    'constraints',(select coalesce(jsonb_object_agg(c.conname,pg_get_constraintdef(c.oid)),'{}'::jsonb)
      from pg_catalog.pg_constraint c where c.conrelid=t.oid),
    'indexes',(select coalesce(jsonb_object_agg(c.relname,jsonb_build_object(
      'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready)),'{}'::jsonb)
      from pg_catalog.pg_index i join pg_catalog.pg_class c on c.oid=i.indexrelid where i.indrelid=t.oid),
    'triggers',(select coalesce(jsonb_object_agg(x.tgname,jsonb_build_object('enabled',x.tgenabled,
      'function',x.tgfoid::regprocedure::text)),'{}'::jsonb)
      from pg_catalog.pg_trigger x where x.tgrelid=t.oid and not x.tgisinternal)
  )) from targets t),
  'gpd33_relation_names',(select coalesce(jsonb_agg(c.relname order by c.relname),'[]'::jsonb)
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and left(c.relname,6)='gpd33_'),
  'public_rpcs',(select coalesce(jsonb_agg(jsonb_build_object(
    'name',p.proname,'args',pg_get_function_identity_arguments(p.oid),
    'returns',pg_get_function_result(p.oid),'security_definer',p.prosecdef)
    order by p.proname,p.oid),'[]'::jsonb)
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f')
)) as gpd33_preflight;
