-- Schedule the send-due-reminders Edge Function with pg_cron + pg_net.
-- Before applying: rotate the previously exposed cron secret, deploy the
-- function with the new MOODTASK_CRON_SECRET, and store the matching value
-- and function URL in Vault. Never put either value in this file or Git.
-- Confirm the project's cron interval and plan support in the Supabase
-- Dashboard; this migration does not assume that a one-minute interval is
-- available for every project.

-- Fail before any cron-job operation unless the Vault secrets and extension
-- prerequisites exist. Only secret metadata is inspected here; decrypted_secret
-- is not selected or displayed.
do $$
begin
  if not exists (
    select 1 from vault.secrets where name = 'moodtask_fn_url'
  ) or not exists (
    select 1 from vault.secrets where name = 'moodtask_cron_secret'
  ) then
    raise exception
      'Cannot schedule MoodTask reminders: Vault must contain secrets named moodtask_fn_url and moodtask_cron_secret.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_extension where extname = 'pg_cron'
  ) or not exists (
    select 1 from pg_catalog.pg_extension where extname = 'pg_net'
  ) then
    raise exception
      'Cannot schedule MoodTask reminders: apply the scheduler extensions prerequisite migration first (pg_cron and pg_net are required).';
  end if;

  if pg_catalog.to_regprocedure(
    'net.http_post(text,jsonb,jsonb,jsonb,integer)'
  ) is null then
    raise exception
      'Cannot schedule MoodTask reminders: required function net.http_post(text,jsonb,jsonb,jsonb,integer) is not available.';
  end if;
end;
$$;

-- Remove any prior job with this name. pg_cron unschedule accepts a job ID,
-- so find matching IDs by jobname first. Restrict deletion to jobs owned by
-- the role running this migration; jobs owned by other roles require manual
-- review and are never removed here.
do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname = 'moodtask-send-due-reminders'
      and username = current_user
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end;
$$;

-- The scheduled command is a plain SQL statement (not a DO block).
-- Vault values are resolved at execution time and are not embedded in cron.job.
select cron.schedule(
  'moodtask-send-due-reminders',
  '* * * * *',
  $job$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'moodtask_fn_url'
        limit 1
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-moodtask-cron-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'moodtask_cron_secret'
          limit 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 5000
    ) as request_id;
  $job$
);

-- Verification (metadata only; do not query vault.decrypted_secrets):
-- select name, description from vault.secrets
-- where name in ('moodtask_fn_url', 'moodtask_cron_secret');
-- select jobid, jobname, username, database, active from cron.job
-- where jobname = 'moodtask-send-due-reminders';
-- Review cron.job.command carefully before sharing output; it should contain
-- Vault lookups by name, never the secret values themselves.

-- Undo: unschedule only jobs found under this name, using each job ID:
-- do $$
-- declare existing_job record;
-- begin
--   for existing_job in
--     select jobid from cron.job
--     where jobname = 'moodtask-send-due-reminders'
--       and username = current_user
--   loop
--     perform cron.unschedule(existing_job.jobid);
--   end loop;
-- end;
-- $$;

-- Vault setup guidance (run manually in the Dashboard, never put values in
-- source files/logs/chat): check vault.secrets name/description metadata first.
-- Do not blindly rerun vault.create_secret: it may create duplicate names or
-- fail depending on Vault behavior/schema. If a name already exists, update
-- that existing entry through the Dashboard's Vault UI; otherwise add it once.
-- Afterward, verify only the two names/descriptions using the query above.
