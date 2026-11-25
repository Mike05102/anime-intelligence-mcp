begin;
set local lock_timeout='2s';

create table gpd33_maintenance.vacuum_checkpoint (
  singleton boolean primary key default true check(singleton),
  status text not null default 'waiting' check(status in ('waiting','vacuum_requested','complete','expired')),
  child_job_id bigint,
  requested_at timestamptz,
  completed_at timestamptz,
  database_before bigint,
  event_before bigint,
  database_after bigint,
  event_after bigint,
  last_vacuum timestamptz,
  payment_count bigint,
  payment_digest text,
  payment_protected boolean
);
alter table gpd33_maintenance.vacuum_checkpoint enable row level security;
revoke all on gpd33_maintenance.vacuum_checkpoint from public,anon,authenticated,service_role;
insert into gpd33_maintenance.vacuum_checkpoint default values;

create function gpd33_maintenance.finish_internal_backlog() returns void
language plpgsql security invoker set search_path='' set lock_timeout='2s' as $$
declare
  b gpd33_maintenance.backlog_state%rowtype;
  v gpd33_maintenance.vacuum_checkpoint%rowtype;
  child bigint;
  vacuum_at timestamptz;
  paid_count bigint;
  paid_digest text;
  attempts int;
  succeeded boolean;
begin
  select * into b from gpd33_maintenance.backlog_state where singleton;
  if not found then return; end if;
  select * into v from gpd33_maintenance.vacuum_checkpoint where singleton for update skip locked;
  if not found then return; end if;

  if v.status='waiting' and b.done then
    select count(*),md5(string_agg(md5(to_jsonb(e)::text),'' order by id))
    into paid_count,paid_digest from public.api_events e where e.id<=b.max_id
      and e.event_type in ('paid_call','payment_attempt','payment_verified','payment_retry_received',
                           'payment_settlement_failed','payment_verify_failed','x402_failed');
    -- pg_cron sends this as a standalone command in its own session.
    child:=cron.schedule('gpd33_post_backlog_vacuum','*/5 * * * *',
      'VACUUM (ANALYZE, SKIP_LOCKED, TRUNCATE TRUE) public.api_events;');
    update gpd33_maintenance.vacuum_checkpoint set status='vacuum_requested',child_job_id=child,
      requested_at=clock_timestamp(),database_before=pg_database_size(current_database()),
      event_before=pg_total_relation_size('public.api_events'),payment_count=paid_count,payment_digest=paid_digest
      where singleton;
    return;
  end if;

  if v.status='vacuum_requested' then
    select count(*),coalesce(bool_or(status='succeeded'),false) into attempts,succeeded
      from cron.job_run_details where jobid=v.child_job_id and end_time is not null;
    select last_vacuum into vacuum_at from pg_stat_user_tables where relid='public.api_events'::regclass;
    if succeeded and vacuum_at>=v.requested_at then
      select count(*),md5(string_agg(md5(to_jsonb(e)::text),'' order by id))
      into paid_count,paid_digest from public.api_events e where e.id<=b.max_id
        and e.event_type in ('paid_call','payment_attempt','payment_verified','payment_retry_received',
                             'payment_settlement_failed','payment_verify_failed','x402_failed');
      update gpd33_maintenance.vacuum_checkpoint set status='complete',completed_at=now(),
        database_after=pg_database_size(current_database()),event_after=pg_total_relation_size('public.api_events'),
        last_vacuum=vacuum_at,payment_protected=(paid_count=v.payment_count and paid_digest is not distinct from v.payment_digest)
        where singleton;
    elsif attempts>=3 or now()>v.requested_at+interval '30 minutes' then
      update gpd33_maintenance.vacuum_checkpoint set status='expired' where singleton;
    else
      return;
    end if;
    perform cron.unschedule(v.child_job_id);
  elsif v.status='waiting' and now()<b.expires_at then
    return;
  elsif v.status='waiting' then
    update gpd33_maintenance.vacuum_checkpoint set status='expired' where singleton;
  end if;

  if exists(select 1 from cron.job where jobname='gpd33_finish_internal_backlog' and username=current_user) then
    perform cron.unschedule('gpd33_finish_internal_backlog');
  end if;
end
$$;
revoke execute on function gpd33_maintenance.finish_internal_backlog() from public,anon,authenticated,service_role;
commit;
