-- Add per-task reminder schedules and Web Push subscriptions.
-- This migration is additive; it does not modify or remove existing task data.

create unique index if not exists tasks_id_user_id_unique
  on public.tasks (id, user_id);

create table if not exists public.task_reminders (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  minutes_before integer not null
    check (minutes_before between 1 and 525600),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  constraint task_reminders_task_owner_fkey
    foreign key (task_id, user_id)
    references public.tasks (id, user_id)
    on delete cascade,
  constraint task_reminders_unique_offset unique (task_id, minutes_before)
);

create index if not exists task_reminders_user_enabled_idx
  on public.task_reminders (user_id, enabled, task_id);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique
    check (endpoint ~ '^https://[^/]+/.+'),
  p256dh text not null check (char_length(p256dh) between 1 and 512),
  auth text not null check (char_length(auth) between 1 and 512),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint push_subscriptions_expiry_valid
    check (expires_at is null or expires_at > created_at)
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid not null
    references public.task_reminders (id) on delete cascade,
  task_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  deadline_at timestamptz not null,
  scheduled_at timestamptz not null,
  status text not null default 'processing'
    check (status in ('processing', 'sent', 'failed', 'skipped')),
  attempt_count smallint not null default 1 check (attempt_count between 1 and 3),
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[A-Z0-9_]{1,40}$'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint notification_events_reminder_deadline_unique
    unique (reminder_id, deadline_at),
  constraint notification_events_task_owner_fkey
    foreign key (task_id, user_id)
    references public.tasks (id, user_id)
    on delete cascade
);

create index if not exists notification_events_user_created_idx
  on public.notification_events (user_id, created_at desc);

create or replace function public.list_due_task_reminders(
  p_now timestamptz,
  p_limit integer default 200
)
returns table (
  reminder_id uuid,
  task_id uuid,
  user_id uuid,
  minutes_before integer,
  scheduled_at timestamptz,
  task_title text,
  task_description text,
  task_start_at timestamptz,
  task_deadline_at timestamptz,
  task_priority text,
  task_status text,
  task_created_at timestamptz,
  task_updated_at timestamptz,
  task_completed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    reminder.id,
    task.id,
    reminder.user_id,
    reminder.minutes_before,
    task.deadline_at - make_interval(mins => reminder.minutes_before),
    task.title,
    task.description,
    task.start_at,
    task.deadline_at,
    task.priority,
    task.status,
    task.created_at,
    task.updated_at,
    task.completed_at
  from public.task_reminders as reminder
  join public.tasks as task
    on task.id = reminder.task_id
   and task.user_id = reminder.user_id
  left join public.notification_events as event
    on event.reminder_id = reminder.id
   and event.deadline_at = task.deadline_at
  where p_now is not null
    and reminder.enabled
    and task.status = 'active'
    and task.deadline_at - make_interval(mins => reminder.minutes_before) <= p_now
    and task.deadline_at - make_interval(mins => reminder.minutes_before) > task.start_at
    and (
      task.deadline_at > p_now
      or reminder.minutes_before = (
        select min(overdue_reminder.minutes_before)
        from public.task_reminders as overdue_reminder
        where overdue_reminder.task_id = task.id
          and overdue_reminder.user_id = task.user_id
          and overdue_reminder.enabled
      )
    )
    and (
      event.id is null
      or (
        event.status = 'failed'
        and event.attempt_count < 3
        and event.updated_at <= p_now - interval '5 minutes'
      )
      or (
        event.status = 'processing'
        and event.attempt_count < 3
        and event.updated_at <= p_now - interval '10 minutes'
      )
    )
    and not exists (
      select 1
      from public.task_reminders as newer_reminder
      left join public.notification_events as newer_event
        on newer_event.reminder_id = newer_reminder.id
       and newer_event.deadline_at = task.deadline_at
      where newer_reminder.task_id = task.id
        and newer_reminder.user_id = task.user_id
        and newer_reminder.enabled
        and task.deadline_at - make_interval(mins => newer_reminder.minutes_before)
          > task.deadline_at - make_interval(mins => reminder.minutes_before)
        and task.deadline_at - make_interval(mins => newer_reminder.minutes_before)
          <= p_now
        and task.deadline_at - make_interval(mins => newer_reminder.minutes_before)
          > task.start_at
        and (
          newer_event.id is null
          or newer_event.status in ('failed', 'processing')
        )
    )
  order by task.deadline_at - make_interval(mins => reminder.minutes_before)
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

alter table public.task_reminders enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_events enable row level security;

revoke all on public.task_reminders from anon;
revoke all on public.push_subscriptions from anon;
revoke all on public.notification_events from anon;

grant select, insert, update, delete on public.task_reminders to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select on public.notification_events to authenticated;
grant all on public.task_reminders to service_role;
grant all on public.push_subscriptions to service_role;
grant all on public.notification_events to service_role;

drop policy if exists "task_reminders_select_own" on public.task_reminders;
create policy "task_reminders_select_own"
  on public.task_reminders for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "task_reminders_insert_own_task" on public.task_reminders;
create policy "task_reminders_insert_own_task"
  on public.task_reminders for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.tasks as task
      where task.id = task_id
        and task.user_id = (select auth.uid())
    )
  );

drop policy if exists "task_reminders_update_own_task" on public.task_reminders;
create policy "task_reminders_update_own_task"
  on public.task_reminders for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.tasks as task
      where task.id = task_id
        and task.user_id = (select auth.uid())
    )
  );

drop policy if exists "task_reminders_delete_own" on public.task_reminders;
create policy "task_reminders_delete_own"
  on public.task_reminders for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own"
  on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions;
create policy "push_subscriptions_insert_own"
  on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "push_subscriptions_update_own" on public.push_subscriptions;
create policy "push_subscriptions_update_own"
  on public.push_subscriptions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "push_subscriptions_delete_own" on public.push_subscriptions;
create policy "push_subscriptions_delete_own"
  on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "notification_events_select_own" on public.notification_events;
create policy "notification_events_select_own"
  on public.notification_events for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.claim_task_reminder_event(
  p_reminder_id uuid,
  p_task_id uuid,
  p_user_id uuid,
  p_deadline_at timestamptz,
  p_scheduled_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_id uuid;
begin
  insert into public.notification_events (
    reminder_id,
    task_id,
    user_id,
    deadline_at,
    scheduled_at,
    status,
    attempt_count
  )
  select
    reminder.id,
    task.id,
    reminder.user_id,
    task.deadline_at,
    p_scheduled_at,
    'processing',
    1
  from public.task_reminders as reminder
  join public.tasks as task
    on task.id = reminder.task_id
   and task.user_id = reminder.user_id
  where reminder.id = p_reminder_id
    and reminder.task_id = p_task_id
    and reminder.user_id = p_user_id
    and reminder.enabled
    and reminder.minutes_before between 1 and 525600
    and task.status = 'active'
    and task.deadline_at = p_deadline_at
    and p_scheduled_at = task.deadline_at
      - make_interval(mins => reminder.minutes_before)
    and p_scheduled_at <= now()
    and p_scheduled_at > task.start_at
  on conflict (reminder_id, deadline_at) do update
    set status = 'processing',
        attempt_count = public.notification_events.attempt_count + 1,
        last_error_code = null,
        updated_at = now()
    where public.notification_events.attempt_count < 3
      and (
        (
          public.notification_events.status = 'failed'
          and public.notification_events.updated_at <= now() - interval '5 minutes'
        )
        or (
          public.notification_events.status = 'processing'
          and public.notification_events.updated_at <= now() - interval '10 minutes'
        )
      )
  returning id into claimed_id;

  if claimed_id is not null then
    insert into public.notification_events (
      reminder_id,
      task_id,
      user_id,
      deadline_at,
      scheduled_at,
      status,
      attempt_count
    )
    select
      older_reminder.id,
      task.id,
      older_reminder.user_id,
      task.deadline_at,
      task.deadline_at - make_interval(mins => older_reminder.minutes_before),
      'skipped',
      1
    from public.task_reminders as older_reminder
    join public.tasks as task
      on task.id = older_reminder.task_id
     and task.user_id = older_reminder.user_id
    where task.id = p_task_id
      and task.user_id = p_user_id
      and task.status = 'active'
      and task.deadline_at = p_deadline_at
      and older_reminder.enabled
      and older_reminder.id <> p_reminder_id
      and task.deadline_at - make_interval(mins => older_reminder.minutes_before)
        < p_scheduled_at
      and task.deadline_at - make_interval(mins => older_reminder.minutes_before)
        <= now()
      and task.deadline_at - make_interval(mins => older_reminder.minutes_before)
        > task.start_at
    on conflict (reminder_id, deadline_at) do nothing;
  end if;

  return claimed_id;
end;
$$;

revoke all on function public.list_due_task_reminders(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.list_due_task_reminders(timestamptz, integer)
  to service_role;

revoke all on function public.claim_task_reminder_event(
  uuid, uuid, uuid, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.claim_task_reminder_event(
  uuid, uuid, uuid, timestamptz, timestamptz
) to service_role;
