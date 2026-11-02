-- Scheduler prerequisites. Keep extension installation separate from
-- cron-job management so a failed scheduler migration cannot leave a job
-- change partially applied.
create extension if not exists pg_cron with schema pg_catalog;
create schema if not exists extensions;
create extension if not exists pg_net with schema extensions;
