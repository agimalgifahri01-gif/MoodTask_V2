import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import type { Task } from '../../../src/features/tasks/domain.ts'
import {
  createReminderNotification,
  getDueTaskReminders,
  type TaskReminder,
} from '../../../src/features/reminders/model.ts'

type DueReminderRow = {
  reminder_id: string
  task_id: string
  user_id: string
  minutes_before: number
  scheduled_at: string
  task_title: string
  task_description: string
  task_start_at: string
  task_deadline_at: string
  task_priority: Task['priority']
  task_status: Task['status']
  task_created_at: string
  task_updated_at: string
  task_completed_at: string | null
}

type SubscriptionRow = {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
}

const responseHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  })
}

function secureEquals(left: string, right: string) {
  const a = new TextEncoder().encode(left)
  const b = new TextEncoder().encode(right)
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index += 1) {
    difference |= a[index] ^ b[index]
  }
  return difference === 0
}

function allowedPushEndpoint(value: string) {
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()
    const knownProvider =
      hostname === 'fcm.googleapis.com' ||
      hostname === 'updates.push.services.mozilla.com' ||
      hostname.endsWith('.push.services.mozilla.com') ||
      hostname.endsWith('.push.apple.com') ||
      hostname.endsWith('.notify.windows.com')
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443') &&
      knownProvider
    )
  } catch {
    return false
  }
}

function taskFromRow(row: DueReminderRow): Task {
  return {
    id: row.task_id,
    title: row.task_title,
    description: row.task_description,
    startAt: row.task_start_at,
    deadlineAt: row.task_deadline_at,
    priority: row.task_priority,
    status: row.task_status,
    createdAt: row.task_created_at,
    updatedAt: row.task_updated_at,
    completedAt: row.task_completed_at,
  }
}

function reminderFromRow(row: DueReminderRow): TaskReminder {
  return {
    id: row.reminder_id,
    taskId: row.task_id,
    minutesBefore: row.minutes_before,
    enabled: true,
    createdAt: row.task_created_at,
  }
}

function eventErrorCode(error: unknown) {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const status = Number((error as { statusCode?: unknown }).statusCode)
    if (Number.isInteger(status) && status >= 400 && status <= 599) {
      return `PUSH_${status}`
    }
  }
  return 'PUSH_DELIVERY_FAILED'
}

const handler = async (request: Request): Promise<Response> => {
  if (request.method !== 'POST')
    return reply(405, { error: 'method_not_allowed' })

  const expectedSecret = Deno.env.get('MOODTASK_CRON_SECRET') ?? ''
  const suppliedSecret = request.headers.get('x-moodtask-cron-secret') ?? ''
  if (
    expectedSecret.length < 32 ||
    !secureEquals(suppliedSecret, expectedSecret)
  ) {
    return reply(401, { error: 'unauthorized' })
  }

  const projectUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const secretKeysRaw = Deno.env.get('SUPABASE_SECRET_KEYS')
  let serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (secretKeysRaw) {
    try {
      const secretKeys = JSON.parse(secretKeysRaw) as Record<string, string>
      serviceKey = secretKeys.default ?? serviceKey
    } catch {
      return reply(500, { error: 'server_configuration_error' })
    }
  }
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? ''
  if (
    !projectUrl ||
    !serviceKey ||
    !vapidPublicKey ||
    !vapidPrivateKey ||
    !/^(mailto:|https:\/\/)/.test(vapidSubject)
  ) {
    return reply(503, { error: 'server_configuration_error' })
  }

  const admin = createClient(projectUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })

  try {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
  } catch {
    return reply(503, { error: 'push_configuration_error' })
  }

  const now = new Date()
  const { data, error } = await admin.rpc('list_due_task_reminders', {
    p_now: now.toISOString(),
    p_limit: 200,
  })
  if (error) {
    console.error('Reminder candidate query failed.')
    return reply(503, { error: 'reminders_unavailable' })
  }

  const counts = { considered: 0, sent: 0, skipped: 0, failed: 0 }
  for (const row of (data ?? []) as DueReminderRow[]) {
    counts.considered += 1
    const task = taskFromRow(row)
    const reminder = reminderFromRow(row)
    const dueReminder = getDueTaskReminders(
      [task],
      [reminder],
      now.getTime(),
    )[0]
    if (!dueReminder) {
      counts.skipped += 1
      continue
    }

    const { data: eventId, error: claimError } = await admin.rpc(
      'claim_task_reminder_event',
      {
        p_reminder_id: reminder.id,
        p_task_id: task.id,
        p_user_id: row.user_id,
        p_deadline_at: task.deadlineAt,
        p_scheduled_at: new Date(dueReminder.scheduledAt).toISOString(),
      },
    )
    if (claimError) {
      counts.failed += 1
      console.error('Reminder event could not be claimed.')
      continue
    }
    if (typeof eventId !== 'string') {
      counts.skipped += 1
      continue
    }

    const notification = createReminderNotification(
      task,
      reminder,
      now.getTime(),
    )
    if (!notification) {
      await admin
        .from('notification_events')
        .update({ status: 'skipped', updated_at: new Date().toISOString() })
        .eq('id', eventId)
      counts.skipped += 1
      continue
    }

    const { data: subscriptions, error: subscriptionError } = await admin
      .from('push_subscriptions')
      .select('id,user_id,endpoint,p256dh,auth')
      .eq('user_id', row.user_id)

    if (subscriptionError) {
      await admin
        .from('notification_events')
        .update({
          status: 'failed',
          last_error_code: 'SUBSCRIPTIONS_UNAVAILABLE',
          updated_at: new Date().toISOString(),
        })
        .eq('id', eventId)
      counts.failed += 1
      continue
    }
    if (!subscriptions?.length) {
      await admin
        .from('notification_events')
        .update({ status: 'skipped', updated_at: new Date().toISOString() })
        .eq('id', eventId)
      counts.skipped += 1
      continue
    }

    let delivered = 0
    let retryableFailure = false
    for (const subscription of subscriptions as SubscriptionRow[]) {
      if (!allowedPushEndpoint(subscription.endpoint)) {
        await admin
          .from('push_subscriptions')
          .delete()
          .eq('id', subscription.id)
          .eq('user_id', row.user_id)
        continue
      }
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(notification),
          { TTL: 60 * 60 },
        )
        delivered += 1
      } catch (caught) {
        const code = eventErrorCode(caught)
        if (code === 'PUSH_404' || code === 'PUSH_410') {
          await admin
            .from('push_subscriptions')
            .delete()
            .eq('id', subscription.id)
            .eq('user_id', row.user_id)
        } else {
          retryableFailure = true
        }
      }
    }

    const sent = delivered > 0
    await admin
      .from('notification_events')
      .update({
        status: sent ? 'sent' : retryableFailure ? 'failed' : 'skipped',
        last_error_code: sent
          ? null
          : retryableFailure
            ? 'PUSH_DELIVERY_FAILED'
            : null,
        sent_at: sent ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', eventId)
    if (sent) counts.sent += 1
    else if (retryableFailure) counts.failed += 1
    else counts.skipped += 1
  }

  return reply(200, { ok: true, ...counts })
}

Deno.serve(handler)
