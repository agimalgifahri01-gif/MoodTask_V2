create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default ''
    check (char_length(display_name) <= 80),
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  start_at timestamptz not null,
  deadline_at timestamptz not null,
  priority text not null check (priority in ('low', 'medium', 'high')),
  status text not null check (status in ('active', 'completed', 'cancelled')),
  progress_percent numeric not null default 0
    check (progress_percent between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint tasks_deadline_after_start check (deadline_at > start_at),
  constraint tasks_completion_timestamp_consistent check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  )
);

create index if not exists tasks_user_created_idx
  on public.tasks (user_id, created_at desc);
create index if not exists tasks_user_status_deadline_idx
  on public.tasks (user_id, status, deadline_at);

alter table public.profiles enable row level security;
alter table public.tasks enable row level security;

revoke all on public.profiles from anon;
revoke all on public.tasks from anon;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists "tasks_select_own" on public.tasks;
create policy "tasks_select_own"
  on public.tasks for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "tasks_insert_own" on public.tasks;
create policy "tasks_insert_own"
  on public.tasks for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "tasks_update_own" on public.tasks;
create policy "tasks_update_own"
  on public.tasks for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "tasks_delete_own" on public.tasks;
create policy "tasks_delete_own"
  on public.tasks for delete to authenticated
  using (user_id = (select auth.uid()));

grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 80)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute procedure public.create_profile_for_new_user();

revoke all on function public.create_profile_for_new_user() from public;
revoke all on function public.create_profile_for_new_user() from anon, authenticated;
