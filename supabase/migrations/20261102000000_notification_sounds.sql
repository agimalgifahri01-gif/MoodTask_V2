-- Per-user notification sound preferences and private uploaded sound objects.
-- Additive migration. This file is not applied automatically by MoodTask.

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  sound_id text not null default 'momo-chime'
    check (sound_id in ('momo-chime', 'soft-bell', 'bright-pop', 'custom')),
  muted boolean not null default false,
  sound_object_path text,
  sound_file_name text,
  updated_at timestamptz not null default now(),
  constraint notification_preferences_sound_path_consistent check (
    (sound_id = 'custom'
      and sound_object_path is not null
      and sound_file_name is not null
      and char_length(sound_file_name) between 1 and 255
      and split_part(sound_object_path, '/', 1) = user_id::text
      and cardinality(string_to_array(sound_object_path, '/')) = 2)
    or (
      sound_id <> 'custom'
      and sound_object_path is null
      and sound_file_name is null
    )
  )
);

alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from anon;
grant select, insert, update on public.notification_preferences to authenticated;

drop policy if exists "notification_preferences_select_own"
  on public.notification_preferences;
create policy "notification_preferences_select_own"
  on public.notification_preferences for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "notification_preferences_insert_own"
  on public.notification_preferences;
create policy "notification_preferences_insert_own"
  on public.notification_preferences for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "notification_preferences_update_own"
  on public.notification_preferences;
create policy "notification_preferences_update_own"
  on public.notification_preferences for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
values (
  'moodtask-notification-sounds',
  'moodtask-notification-sounds',
  false,
  5242880,
  array[
    'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg',
    'audio/mp4', 'audio/aac', 'audio/webm'
  ]::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "notification_sounds_select_own_folder"
  on storage.objects;
create policy "notification_sounds_select_own_folder"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'moodtask-notification-sounds'
    and storage.foldername(name) = array[(select auth.uid())::text]
  );

drop policy if exists "notification_sounds_insert_own_folder"
  on storage.objects;
create policy "notification_sounds_insert_own_folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'moodtask-notification-sounds'
    and storage.foldername(name) = array[(select auth.uid())::text]
  );

drop policy if exists "notification_sounds_update_own_folder"
  on storage.objects;
create policy "notification_sounds_update_own_folder"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'moodtask-notification-sounds'
    and storage.foldername(name) = array[(select auth.uid())::text]
  )
  with check (
    bucket_id = 'moodtask-notification-sounds'
    and storage.foldername(name) = array[(select auth.uid())::text]
  );

drop policy if exists "notification_sounds_delete_own_folder"
  on storage.objects;
create policy "notification_sounds_delete_own_folder"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'moodtask-notification-sounds'
    and storage.foldername(name) = array[(select auth.uid())::text]
  );
