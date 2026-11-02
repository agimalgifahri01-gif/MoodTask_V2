# MoodTask

MoodTask is a task and daily activity companion. Its character reflects the time remaining before a task deadline. The app includes task management, deadline mood logic, the reusable Momo character system, local persistence, Supabase Auth, and account-backed task storage.

## Run locally

Requirements: Node.js 20.19+ or 22.12+ and npm.

```sh
npm ci
npm run dev
```

Vite prints the local URL after starting. Create a production bundle with `npm run build`; inspect it using `npm run preview`.

## Quality checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run format:check
```

## Structure

```text
src/
  app/                 App shell and route table
  components/          Shared layout, page intro, companion renderer
  features/
    character/          Mood adapter, character catalog, expression renderer, mood messages
    auth/               Supabase client, AuthService, auth state provider
    tasks/              Task domain, async repository boundary, local and Supabase adapters
  pages/               Screen-level route components
  styles/              Design tokens, global styles, task styles
supabase/
  migrations/          Database schema, constraints, indexes, and RLS policies
```

The app uses React, TypeScript, Vite, and `@supabase/supabase-js`. `AuthService` owns Supabase Auth calls and `AuthProvider` exposes verified session state; without valid project settings it reports that account features are unconfigured and keeps the app in local mode. `TaskProvider` coordinates asynchronous UI state through `TaskRepository`, implemented by both `LocalStorageTaskRepository` and `SupabaseTaskRepository`. Task screens and deadline logic do not import Supabase. RLS in the database is the security boundary; the repository's owner filter is an additional query restriction. In `features/character/`, the mood adapter maps domain mood to expression and the renderer stays independent of deadline calculation.

Tasks support create, read, update, delete, completion, cancellation and reactivation, search, status filters, priority/deadline/recent sorting, and detail views. The app tracks remaining time to deadline; it does not track work-completion percentage. Older local records are read while ignoring their legacy work-progress field, and that field is omitted the next time the task list is saved. The existing database column remains untouched for compatibility and is no longer read or written by the app. Signed-out tasks use the versioned `moodtask.tasks` browser record. After login, MoodTask counts local tasks and asks for explicit approval before sending them to the signed-in account. Declining leaves the local copy on the device and opens the cloud workspace without importing it. Approved data is merged by ID, read back for verification, and only then removed locally; conflicts or failures preserve the local copy. Signed-in changes are written to Supabase; another device fetches the account's tasks when it opens or reloads. Realtime subscriptions and offline write queues are not implemented.

The companion is an original, code-drawn SVG component with distinct expressions for all six moods and catalog-provided colors. Large character views use a restrained float animation; the existing reduced-motion media rule disables it. The catalog supports adding a visual character without changing task domain logic. Outfit inventory and saved loadouts are deferred to Milestone 7.

## Supabase setup

1. Create a Supabase project and enable the email provider in **Authentication → Sign In / Providers**.
2. In **Authentication → URL Configuration**, use `http://localhost:5173` as the local Site URL and allow `http://localhost:5173/**` as a redirect URL. Add the production site's exact origin and callback path when deploying.
3. For a separate new project, install/use the Supabase CLI, authenticate it, link that project, and apply the repository migration file once:

   ```sh
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

   The current project's owner reports that the initial migration has been applied. Do not repeat this step against that project; apply the migration once only when setting up a separate new project.

4. Copy `.env.example` to `.env.local`. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the project's API settings, then restart Vite.
5. Open `/auth`, create an account, confirm the email if required, and sign in. Test login, logout, password recovery, and both local-task consent choices. Refresh on another signed-in browser to test account persistence.

The app processes the account email through Supabase Auth and stores task fields in the account database when signed in. Signed-out task records remain in this browser's local storage. Only the publishable key belongs in the browser. Never add a service-role key or database password to `.env.local` or a `VITE_` variable. `.env` and `.env.*` are ignored by Git; `.env.example` contains placeholders only.

## RLS integration test (explicit opt-in)

`npm run test:rls` runs a separate integration script against an already configured Supabase project. It is not part of the normal test, lint, or build commands. The script exits before loading credentials or making requests unless `RUN_RLS_TESTS=true` is set in the shell.

Use a project suitable for testing, with the repository migration already applied and two ordinary, confirmed test accounts. Never use a service-role key. Copy `.env.rls.local.example` to `.env.rls.local` and fill in the project URL, publishable/legacy anon key, the expected project reference, and credentials for accounts A and B. This file is ignored by Git. The script accepts only a Supabase publishable key or a legacy anon JWT; it rejects service/secret keys. It also requires the URL's standard `<project-ref>.supabase.co` host to match the expected reference exactly; custom domains are rejected because their project reference cannot be verified from the URL.

Before creating a client or sending any request, the script displays only the expected project reference and requires you to type it in an interactive terminal. A URL/reference mismatch, non-interactive run, or incorrect confirmation stops execution without contacting Supabase. This explicit confirmation reduces accidental targeting but cannot establish that the selected project is non-production; choose a project where test writes are acceptable.

In PowerShell, from the `MoodTask-v2` directory:

```powershell
$env:RUN_RLS_TESTS = 'true'
npm run test:rls
Remove-Item Env:RUN_RLS_TESTS
```

In macOS/Linux shells:

```sh
RUN_RLS_TESTS=true npm run test:rls
```

The script uses two independent, non-persistent authenticated clients. Every write targets one of the script's generated UUIDs; it never takes a task ID from a query result or an existing task. It creates marked fixtures, checks ownership and cross-account access against the database, then removes only those fixture IDs with the matching marker and owner ID through ordinary user sessions. Cleanup runs even if only one initial insert succeeds or a later scenario fails. SIGINT/SIGTERM asks the script to finish the active request and proceed to cleanup. A forced process kill or machine shutdown cannot run cleanup, so the marker is printed before the first request. It does not create accounts, run migrations, or target existing task IDs. A failed run prints fixed test names and sanitized outcomes, not account details or backend error text. If cleanup fails, the script prints a warning and the non-secret run marker. Sign in separately as A and B, search the task list for that marker, and remove only matching test fixtures through the account that owns each one.

Passing results demonstrate the tested policies for those two sessions and that project configuration. They do not establish safety for other schemas, roles, policies, or future migrations. Do not point this script at production; the test deliberately attempts blocked writes against rows it created.

## Architecture decisions

- Keep the frontend as a Vite SPA; no separate server is justified before backend requirements are implemented.
- Put route composition in `app/`, screen composition in `pages/`, reusable pieces in `components/`, and design tokens in `styles/`.
- Keep the character renderer presentational so domain mood rules can change without rewriting the visual asset.
- Keep deadline math in pure domain functions; the UI supplies the current timestamp and renders the result.
- Keep persistence behind the asynchronous `TaskRepository` CRUD boundary so local and account-backed storage share the same task UI.
- Use localStorage for signed-out tasks. Require consent before account migration, bind approval to the exact task snapshot, and preserve the local copy until every approved record is verified remotely.
- Use Supabase Auth sessions and Postgres RLS for account identity and task authorization. There is no custom application server and no service-role key in the frontend.
- Profile rows are created by a database trigger. Users can select only their own profile; task policies independently check `auth.uid()` for every operation.

## Local task data

Signed-out tasks are stored only in the current browser profile. To verify local persistence, create a task and refresh. After sign-in, the consent screen shows the number and source of local tasks. Choose **Pindahkan** to merge them into that account; choose **Lanjut tanpa memindahkan** to keep them local while using the account's separate cloud tasks. On migration failure, local data stays in the browser and retry avoids duplicate IDs. A changed local snapshot is shown for approval again. Signed-in data is fetched on app load; this is not realtime synchronization. Clearing browser site data removes any remaining local-only tasks.

## Push notifications & Momo reminder schedule

MoodTask supports customizable push reminders with Momo's mood reflecting the remaining deadline urgency when the reminder is dispatched.

### How to use the feature

1. **Sign in to a MoodTask account**: Reminder rules and push device subscriptions are tied to authenticated Supabase accounts.
2. **Open Reminders or Task Details**:
   - Go to `/reminders` to manage browser push registration and view all active task reminder rules.
   - Or click any task in `/tasks` to open its detail dialog and view its "Jadwal Momo" section.
3. **Opt into notifications**:
   - Click **Aktifkan notifikasi** on the browser push panel. Notification permission is never requested on page load; only upon this explicit user click.
4. **Set reminder schedules**:
   - Choose time offsets before deadline (e.g. 15 minutes, 2 hours, 1 day).
   - Add multiple reminders per task.
   - Toggle individual reminders on/off or delete them at any time.
   - Deadlines edited on tasks automatically update the computed scheduled reminder instants.

### Momo mood rules during reminder delivery

Mood is computed dynamically from the latest task deadline at the moment the notification is dispatched, never cached:

- **76%–100% time remaining**: Santai (`calm`)
- **51%–75%**: Waspada (`alert`)
- **26%–50%**: Cemas (`anxious`)
- **1%–25%**: Panik (`panic`)
- **Deadline passed & task incomplete**: Terlambat (`late`)
- **Task completed**: Bahagia (`happy`)

Notifications include the title `Momo · [Mood]`, the task title, remaining/overdue time description, a tailored Momo character message, the mood SVG icon (`/momo/[mood].svg`), and a deduplication tag tied to the specific reminder and deadline timestamp.

### Notification sound preferences

Open **Settings → Suara notifikasi** to preview and choose one of the built-in Momo tones, mute notification audio, or upload a personal sound. Custom uploads require a signed-in account and are stored in a private, owner-scoped Supabase Storage bucket; only a short-lived signed URL is used for preview and in-app delivery. The upload limit is 5 MiB and 30 seconds. MP3, WAV, OGG, M4A/AAC, and WebM are accepted only when the current browser can decode them. MP4 is accepted only when the browser can decode its audio track; video-only or unsupported-codec files are rejected. Built-in preferences while signed out are saved on that browser, while signed-in preferences are stored per account.

The migration `supabase/migrations/20261102000000_notification_sounds.sql` creates the preference table, private bucket, and owner-only RLS policies. Apply it through the project's normal reviewed Supabase migration process before using account-backed sound preferences or uploads. MoodTask does not apply it automatically. In-app sound is attempted once when a push arrives and an app window is open; browser autoplay policies may block playback until the user has interacted with **Dengarkan**. Audio is not promised when Chrome is closed, and the service worker itself does not play sound.

### Architecture components

- **Frontend Client**:
  - `src/features/reminders/model.ts`: Pure domain logic for offset validation, dynamic due time calculation, and notification formatting.
  - `src/features/reminders/browserPush.ts`: Web Push API capability detection, VAPID key decoding, and permission requests.
  - `src/features/reminders/ReminderSettingsContext.ts` & `ReminderSettingsProvider.tsx`: Context and state for device subscriptions and reminders.
  - `src/features/reminders/ReminderScheduleEditor.tsx`: Responsive per-task reminder editor with unit picker, toggles, and deletion.
- **Service Worker (`public/sw.js`)**:
  - Listens to incoming `push` events in the background even when browser tabs are closed.
  - Displays system notifications with matching Momo icons and tags.
  - Listens to `notificationclick` events, navigating the active window or opening a new tab directly to `/tasks?open=[taskId]`.
- **Database (`supabase/migrations/20261101000000_task_reminders_and_push.sql`)**:
  - `task_reminders`: Stores per-task offsets and enabled flags with RLS policies ensuring users access only their own tasks.
  - `push_subscriptions`: Stores user push endpoints and keys.
  - `notification_events`: Atomic claim and deduplication tracking for sent and pending reminder events.
  - Stored procedures: `list_due_task_reminders(p_now, p_limit)` and `claim_task_reminder_event(...)` running under `security definer`.
- **Server Scheduler (`supabase/functions/send-due-reminders`)**:
  - Supabase Edge Function using `web-push` to dispatch Web Push payloads to subscribed user devices.

### Required environment variable names (values omitted)

#### Frontend (`.env.local`)

- `VITE_SUPABASE_URL`: Supabase project URL.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: Supabase anon/publishable key.
- `VITE_VAPID_PUBLIC_KEY`: Uncompressed P-256 VAPID public key for browser push subscription.

#### Supabase Edge Function Secrets

- `SUPABASE_URL`: Supabase project API URL.
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key (used strictly in backend/function, never in frontend).
- `VAPID_PUBLIC_KEY`: VAPID public key.
- `VAPID_PRIVATE_KEY`: VAPID private key (secret server key).
- `VAPID_SUBJECT`: Contact URI (e.g. `mailto:admin@example.com`).
- `MOODTASK_CRON_SECRET`: Minimum 32-character secret token required in the `x-moodtask-cron-secret` request header.

### Manual Supabase & hosting setup steps

1. **Apply the reminders migration**:
   ```sh
   npx supabase db push
   ```
   _(Ensure `20261101000000_task_reminders_and_push.sql` is applied)._
2. **Generate VAPID keys** (if not already created):
   ```sh
   npx web-push generate-vapid-keys
   ```
3. **Configure Edge Function secrets**:
   ```sh
   npx supabase secrets set VAPID_PUBLIC_KEY="YOUR_KEY" VAPID_PRIVATE_KEY="YOUR_KEY" VAPID_SUBJECT="mailto:your@email.com" MOODTASK_CRON_SECRET="YOUR_RANDOM_SECRET"
   ```
4. **Deploy the Edge Function**:
   ```sh
   npx supabase functions deploy send-due-reminders --no-verify-jwt
   ```
5. **Configure Cron Scheduler**:
   - Use `pg_cron` in Supabase SQL editor or an external scheduler (GitHub Actions, Cloudflare Worker, cron-job.org) to send a `POST` request every minute to:
     `https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-due-reminders`
   - Include the header:
     `x-moodtask-cron-secret: YOUR_RANDOM_SECRET`

### How to test real push notifications when browser tab or browser is closed

1. Start the app locally (`npm run dev`) or access your HTTPS deployment.
2. Sign in to your account, navigate to `/reminders`, and click **Aktifkan notifikasi**. Allow notification permissions in the browser prompt.
3. In `/tasks`, create a task due 5 minutes from now.
4. Open the task details and add a reminder for "3 menit sebelum deadline".
5. **Close the MoodTask tab and completely close the browser window.**
6. Wait until the scheduled time, or trigger the Edge Function manually:
   ```sh
   curl -X POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-due-reminders \
     -H "x-moodtask-cron-secret: YOUR_RANDOM_SECRET"
   ```
7. Your operating system's notification center will show the incoming push notification with Momo's corresponding mood and icon.
8. Click the notification: the browser will reopen directly to `/tasks` and open that task's detail dialog.
