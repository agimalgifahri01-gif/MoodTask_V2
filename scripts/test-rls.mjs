import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = resolve(projectRoot, '.env.rls.local')

if (process.env.RUN_RLS_TESTS !== 'true') {
  console.error(
    'RLS integration test dinonaktifkan. Set RUN_RLS_TESTS=true untuk menjalankannya secara eksplisit.',
  )
  process.exit(2)
}

function parseLocalEnv(source) {
  const values = new Map()
  for (const rawLine of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    values.set(match[1], value)
  }
  return values
}

function isAllowedPublicKey(key) {
  if (key.startsWith('sb_publishable_')) {
    return key.length > 'sb_publishable_'.length
  }
  if (key.startsWith('sb_secret_')) return false
  const parts = key.split('.')
  if (parts.length !== 3) return false
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    )
    return payload.role === 'anon'
  } catch {
    return false
  }
}

function getProjectRef(value) {
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return null
    }
    return url.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i)?.[1] ?? null
  } catch {
    return null
  }
}

let localValues
try {
  localValues = parseLocalEnv(await readFile(envPath, 'utf8'))
} catch {
  console.error(
    'File .env.rls.local belum tersedia atau tidak dapat dibaca. Salin file contoh dan isi konfigurasi akun uji.',
  )
  process.exit(2)
}

const requiredNames = [
  'RLS_TEST_SUPABASE_URL',
  'RLS_TEST_SUPABASE_KEY',
  'RLS_TEST_EXPECTED_PROJECT_REF',
  'RLS_TEST_USER_A_EMAIL',
  'RLS_TEST_USER_A_PASSWORD',
  'RLS_TEST_USER_B_EMAIL',
  'RLS_TEST_USER_B_PASSWORD',
]
const config = Object.fromEntries(
  requiredNames.map((name) => [
    name,
    process.env[name] ?? localValues.get(name),
  ]),
)
if (requiredNames.some((name) => !config[name]?.trim())) {
  console.error(
    'Konfigurasi RLS test belum lengkap. Isi semua variabel yang diwajibkan di .env.rls.local.',
  )
  process.exit(2)
}
const actualProjectRef = getProjectRef(config.RLS_TEST_SUPABASE_URL)
const expectedProjectRef =
  config.RLS_TEST_EXPECTED_PROJECT_REF.trim().toLowerCase()
if (
  !/^[a-z0-9-]+$/.test(expectedProjectRef) ||
  !actualProjectRef ||
  actualProjectRef.toLowerCase() !== expectedProjectRef
) {
  console.error(
    'Target ditolak: URL harus memakai host project Supabase standar dan project reference harus cocok persis dengan RLS_TEST_EXPECTED_PROJECT_REF.',
  )
  process.exit(2)
}
if (!isAllowedPublicKey(config.RLS_TEST_SUPABASE_KEY)) {
  console.error(
    'Key ditolak. Gunakan publishable key atau legacy anon key; service/secret key tidak diterima.',
  )
  process.exit(2)
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error(
    'Target belum dikonfirmasi. Jalankan dari terminal interaktif dan ketik project reference yang ditampilkan.',
  )
  process.exit(2)
}

console.log(`Target project reference: ${expectedProjectRef}`)
const prompt = createInterface({ input: process.stdin, output: process.stdout })
let confirmedProjectRef
try {
  confirmedProjectRef = await prompt.question(
    'Ketik project reference tersebut untuk mengizinkan pengujian: ',
  )
} finally {
  prompt.close()
}
if (confirmedProjectRef.trim() !== expectedProjectRef) {
  console.error('Target tidak dikonfirmasi; tidak ada request yang dikirim.')
  process.exit(2)
}

const clientOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
}
let clientA
let clientB
const failures = []
const fixtureIds = [randomUUID(), randomUUID(), randomUUID()]
const fixtureIdSet = new Set(fixtureIds)
const reminderFixtureIds = Array.from({ length: 4 }, () => randomUUID())
const reminderFixtureIdSet = new Set(reminderFixtureIds)
const runMarker = `RLS_RLS_TEST_${randomUUID()}`
console.log(`Fixture marker untuk pemulihan jika proses terhenti: ${runMarker}`)
let stopRequested = false

function requestStop(signal) {
  if (stopRequested) return
  stopRequested = true
  console.error(
    `Sinyal ${signal} diterima. Menunggu request aktif lalu mencoba cleanup fixture.`,
  )
}

function ensureNotInterrupted() {
  if (stopRequested) throw new Error('Pengujian dihentikan oleh pengguna.')
}

process.on('SIGINT', () => requestStop('SIGINT'))
process.on('SIGTERM', () => requestStop('SIGTERM'))

function report(name, passed) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`)
  if (!passed) failures.push(name)
}

async function safely(operation) {
  try {
    return { ok: true, result: await operation() }
  } catch {
    return { ok: false, result: null }
  }
}

function wasDeniedOrMatchedNoRows(outcome) {
  if (!outcome.ok) return false
  const response = outcome.result
  if (response?.error) return response.error.code === '42501'
  return response?.data === null
}

function taskRow(id, ownerId, label) {
  assertFixtureId(id)
  const start = new Date().toISOString()
  const deadline = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  return {
    id,
    user_id: ownerId,
    title: `${runMarker}_${label}`,
    description: runMarker,
    start_at: start,
    deadline_at: deadline,
    priority: 'medium',
    status: 'active',
    progress_percent: 0,
  }
}

function assertFixtureId(id) {
  if (!fixtureIdSet.has(id)) {
    throw new Error('Operasi tulis hanya boleh memakai UUID fixture skrip.')
  }
}

function reminderRow(id, taskId, ownerId) {
  if (!reminderFixtureIdSet.has(id)) {
    throw new Error(
      'Operasi tulis reminder hanya boleh memakai UUID fixture skrip.',
    )
  }
  assertFixtureId(taskId)
  return {
    id,
    task_id: taskId,
    user_id: ownerId,
    minutes_before: 5,
    enabled: true,
  }
}

function fixtureClient(client, id) {
  assertFixtureId(id)
  return client
}

function fixtureReminderClient(client, id) {
  if (!reminderFixtureIdSet.has(id)) {
    throw new Error(
      'Operasi tulis hanya boleh memakai UUID reminder fixture skrip.',
    )
  }
  return client
}

async function readTask(client, id) {
  return client
    .from('tasks')
    .select('id,user_id,title,description')
    .eq('id', id)
    .maybeSingle()
}

async function cleanupOwnedFixtures(userAId, userBId) {
  if (!fixtureIds.every((id) => fixtureIdSet.has(id))) {
    report('cleanup hanya fixture UUID yang dibuat skrip', false)
    return
  }
  let cleanupOk = true
  for (const [client, ownerId] of [
    [clientA, userAId],
    [clientB, userBId],
  ]) {
    if (!client || !ownerId) continue
    const deletion = await safely(() =>
      client
        .from('tasks')
        .delete()
        .in('id', fixtureIds)
        .eq('user_id', ownerId)
        .eq('description', runMarker)
        .select('id'),
    )
    if (!deletion.ok || deletion.result?.error) cleanupOk = false

    const remaining = await safely(() =>
      client
        .from('tasks')
        .select('id')
        .in('id', fixtureIds)
        .eq('user_id', ownerId)
        .eq('description', runMarker),
    )
    if (
      !remaining.ok ||
      remaining.result?.error ||
      (remaining.result?.data?.length ?? 0) > 0
    ) {
      cleanupOk = false
    }
  }
  for (const client of [clientA, clientB].filter(Boolean)) {
    const remainingReminders = await safely(() =>
      client.from('task_reminders').select('id').in('id', reminderFixtureIds),
    )
    if (
      !remainingReminders.ok ||
      remainingReminders.result?.error ||
      (remainingReminders.result?.data?.length ?? 0) > 0
    ) {
      cleanupOk = false
    }
  }
  report(
    'cleanup hanya task dan reminder fixture melalui sesi pemilik',
    cleanupOk,
  )
  if (!cleanupOk) {
    console.error(
      'PERINGATAN: cleanup belum terverifikasi. Tidak ada kredensial yang ditampilkan.',
    )
    console.error(`Marker fixture: ${runMarker}`)
    console.error(
      'Masuk ke aplikasi secara terpisah sebagai akun uji A dan B, cari marker tersebut pada daftar tugas, lalu hapus hanya tugas bertanda itu melalui akun pemiliknya. Jangan hapus tugas lain.',
    )
  }
}

let userAId = null
let userBId = null
let setupReady = false

try {
  ensureNotInterrupted()
  try {
    clientA = createClient(
      config.RLS_TEST_SUPABASE_URL,
      config.RLS_TEST_SUPABASE_KEY,
      clientOptions,
    )
    clientB = createClient(
      config.RLS_TEST_SUPABASE_URL,
      config.RLS_TEST_SUPABASE_KEY,
      clientOptions,
    )
  } catch {
    report('inisialisasi dua client publik terpisah', false)
    process.exitCode = 1
  }

  if (clientA && clientB) {
    const [loginA, loginB] = await Promise.all([
      safely(() =>
        clientA.auth.signInWithPassword({
          email: config.RLS_TEST_USER_A_EMAIL,
          password: config.RLS_TEST_USER_A_PASSWORD,
        }),
      ),
      safely(() =>
        clientB.auth.signInWithPassword({
          email: config.RLS_TEST_USER_B_EMAIL,
          password: config.RLS_TEST_USER_B_PASSWORD,
        }),
      ),
    ])
    ensureNotInterrupted()
    userAId = loginA.result?.data?.user?.id ?? null
    userBId = loginB.result?.data?.user?.id ?? null
    const loginAOk =
      loginA.ok &&
      !loginA.result?.error &&
      Boolean(loginA.result?.data?.session)
    const loginBOk =
      loginB.ok &&
      !loginB.result?.error &&
      Boolean(loginB.result?.data?.session)
    report('login akun uji A dengan sesi pengguna biasa', loginAOk)
    report('login akun uji B dengan sesi pengguna biasa', loginBOk)
    const distinctAccounts =
      loginAOk &&
      loginBOk &&
      userAId !== null &&
      userBId !== null &&
      userAId !== userBId
    report('akun A dan B memiliki identitas berbeda', distinctAccounts)
    setupReady = distinctAccounts
  }

  if (setupReady) {
    ensureNotInterrupted()
    const fixtureA = taskRow(fixtureIds[0], userAId, 'OWNER_A')
    const fixtureB = taskRow(fixtureIds[1], userBId, 'OWNER_B')
    const spoofFixture = taskRow(fixtureIds[2], userBId, 'SPOOF_INSERT')
    const [insertA, insertB] = await Promise.all([
      safely(() =>
        clientA.from('tasks').insert(fixtureA).select('id').single(),
      ),
      safely(() =>
        clientB.from('tasks').insert(fixtureB).select('id').single(),
      ),
    ])
    ensureNotInterrupted()
    const ownAInserted =
      insertA.ok && !insertA.result?.error && Boolean(insertA.result?.data)
    const ownBInserted =
      insertB.ok && !insertB.result?.error && Boolean(insertB.result?.data)
    report('A dapat membuat fixture tugas miliknya', ownAInserted)
    report('B dapat membuat fixture tugas miliknya', ownBInserted)
    if (!ownAInserted || !ownBInserted) {
      console.log(
        'SKIP skenario lintas akun; cleanup tetap memeriksa semua UUID fixture skrip.',
      )
    }

    if (ownAInserted && ownBInserted) {
      const [readAOwn, readBOwn, unfilteredA, readBByIdA] = await Promise.all([
        safely(() => readTask(clientA, fixtureIds[0])),
        safely(() => readTask(clientB, fixtureIds[1])),
        safely(() =>
          clientA
            .from('tasks')
            .select('id,user_id')
            .in('id', [fixtureIds[0], fixtureIds[1]]),
        ),
        safely(() => readTask(clientA, fixtureIds[1])),
      ])
      ensureNotInterrupted()
      report(
        'A dapat membaca tugasnya sendiri',
        readAOwn.ok &&
          !readAOwn.result?.error &&
          readAOwn.result?.data?.user_id === userAId,
      )
      report(
        'B dapat membaca tugasnya sendiri',
        readBOwn.ok &&
          !readBOwn.result?.error &&
          readBOwn.result?.data?.user_id === userBId,
      )
      const visibleToA = unfilteredA.result?.data ?? []
      report(
        'query A tanpa filter user_id tidak mengembalikan tugas B',
        unfilteredA.ok &&
          !unfilteredA.result?.error &&
          visibleToA.some((row) => row.id === fixtureIds[0]) &&
          !visibleToA.some((row) => row.id === fixtureIds[1]),
      )
      report(
        'A tidak dapat membaca tugas B berdasarkan ID',
        readBByIdA.ok &&
          !readBByIdA.result?.error &&
          readBByIdA.result?.data === null,
      )

      ensureNotInterrupted()
      const crossUpdate = await safely(() =>
        fixtureClient(clientA, fixtureIds[1])
          .from('tasks')
          .update({ title: `${runMarker}_CROSS_UPDATE` })
          .eq('id', fixtureIds[1])
          .select('id')
          .maybeSingle(),
      )
      const bAfterCrossUpdate = await safely(() =>
        readTask(clientB, fixtureIds[1]),
      )
      ensureNotInterrupted()
      report(
        'A tidak dapat mengubah tugas B dan isi tugas B tetap utuh',
        wasDeniedOrMatchedNoRows(crossUpdate) &&
          bAfterCrossUpdate.ok &&
          !bAfterCrossUpdate.result?.error &&
          bAfterCrossUpdate.result?.data?.title === fixtureB.title,
      )

      ensureNotInterrupted()
      const crossDelete = await safely(() =>
        fixtureClient(clientA, fixtureIds[1])
          .from('tasks')
          .delete()
          .eq('id', fixtureIds[1])
          .select('id')
          .maybeSingle(),
      )
      const bAfterCrossDelete = await safely(() =>
        readTask(clientB, fixtureIds[1]),
      )
      ensureNotInterrupted()
      report(
        'A tidak dapat menghapus tugas B dan baris B tetap ada',
        wasDeniedOrMatchedNoRows(crossDelete) &&
          bAfterCrossDelete.ok &&
          !bAfterCrossDelete.result?.error &&
          bAfterCrossDelete.result?.data?.id === fixtureIds[1],
      )

      ensureNotInterrupted()
      const spoofInsert = await safely(() =>
        fixtureClient(clientA, spoofFixture.id)
          .from('tasks')
          .insert(spoofFixture)
          .select('id')
          .maybeSingle(),
      )
      const spoofVisibleToB = await safely(() =>
        readTask(clientB, fixtureIds[2]),
      )
      ensureNotInterrupted()
      report(
        'insert A dengan user_id B ditolak atau tidak tersimpan',
        wasDeniedOrMatchedNoRows(spoofInsert) &&
          spoofVisibleToB.ok &&
          !spoofVisibleToB.result?.error &&
          spoofVisibleToB.result?.data === null,
      )

      ensureNotInterrupted()
      const ownerChange = await safely(() =>
        fixtureClient(clientA, fixtureIds[0])
          .from('tasks')
          .update({ user_id: userBId })
          .eq('id', fixtureIds[0])
          .eq('user_id', userAId)
          .select('id,user_id')
          .maybeSingle(),
      )
      const aAfterOwnerChange = await safely(() =>
        readTask(clientA, fixtureIds[0]),
      )
      const bAfterOwnerChange = await safely(() =>
        readTask(clientB, fixtureIds[0]),
      )
      ensureNotInterrupted()
      report(
        'A tidak dapat memindahkan user_id tugasnya ke B',
        wasDeniedOrMatchedNoRows(ownerChange) &&
          aAfterOwnerChange.ok &&
          !aAfterOwnerChange.result?.error &&
          aAfterOwnerChange.result?.data?.user_id === userAId &&
          bAfterOwnerChange.ok &&
          !bAfterOwnerChange.result?.error &&
          bAfterOwnerChange.result?.data === null,
      )

      ensureNotInterrupted()
      const ownReminderA = reminderRow(
        reminderFixtureIds[0],
        fixtureIds[0],
        userAId,
      )
      const ownReminderB = reminderRow(
        reminderFixtureIds[1],
        fixtureIds[1],
        userBId,
      )
      const [insertReminderA, insertReminderB] = await Promise.all([
        safely(() =>
          clientA
            .from('task_reminders')
            .insert(ownReminderA)
            .select('id,user_id,enabled')
            .single(),
        ),
        safely(() =>
          clientB
            .from('task_reminders')
            .insert(ownReminderB)
            .select('id,user_id,enabled')
            .single(),
        ),
      ])
      ensureNotInterrupted()
      const reminderAInserted =
        insertReminderA.ok &&
        !insertReminderA.result?.error &&
        insertReminderA.result?.data?.id === reminderFixtureIds[0]
      const reminderBInserted =
        insertReminderB.ok &&
        !insertReminderB.result?.error &&
        insertReminderB.result?.data?.id === reminderFixtureIds[1]
      report(
        'A dapat mengatur pengingat pada tugas fixture miliknya',
        reminderAInserted,
      )
      report(
        'B dapat mengatur pengingat pada tugas fixture miliknya',
        reminderBInserted,
      )

      const [readOwnReminderA, readOwnReminderB] = await Promise.all([
        safely(() =>
          clientA
            .from('task_reminders')
            .select('id,user_id')
            .eq('id', reminderFixtureIds[0])
            .maybeSingle(),
        ),
        safely(() =>
          clientB
            .from('task_reminders')
            .select('id,user_id')
            .eq('id', reminderFixtureIds[1])
            .maybeSingle(),
        ),
      ])
      const readOtherReminderA = await safely(() =>
        clientA
          .from('task_reminders')
          .select('id,user_id')
          .eq('id', reminderFixtureIds[1])
          .maybeSingle(),
      )
      report(
        'A dan B hanya dapat membaca pengingat fixture miliknya',
        readOwnReminderA.ok &&
          !readOwnReminderA.result?.error &&
          readOwnReminderA.result?.data?.user_id === userAId &&
          readOwnReminderB.ok &&
          !readOwnReminderB.result?.error &&
          readOwnReminderB.result?.data?.user_id === userBId &&
          readOtherReminderA.ok &&
          !readOtherReminderA.result?.error &&
          readOtherReminderA.result?.data === null,
      )

      ensureNotInterrupted()
      const crossReminderInsert = await safely(() =>
        clientA
          .from('task_reminders')
          .insert(reminderRow(reminderFixtureIds[2], fixtureIds[1], userBId))
          .select('id')
          .maybeSingle(),
      )
      const crossReminderVisibleToB = await safely(() =>
        clientB
          .from('task_reminders')
          .select('id')
          .eq('id', reminderFixtureIds[2])
          .maybeSingle(),
      )
      report(
        'A tidak dapat membuat jadwal pada tugas fixture B',
        wasDeniedOrMatchedNoRows(crossReminderInsert) &&
          crossReminderVisibleToB.ok &&
          !crossReminderVisibleToB.result?.error &&
          crossReminderVisibleToB.result?.data === null,
      )

      const spoofOwnerReminder = await safely(() =>
        clientA
          .from('task_reminders')
          .insert(reminderRow(reminderFixtureIds[3], fixtureIds[0], userBId))
          .select('id')
          .maybeSingle(),
      )
      report(
        'A tidak dapat menetapkan user_id reminder sebagai akun B',
        wasDeniedOrMatchedNoRows(spoofOwnerReminder),
      )

      ensureNotInterrupted()
      const crossReminderUpdate = await safely(() =>
        fixtureReminderClient(clientA, reminderFixtureIds[1])
          .from('task_reminders')
          .update({ enabled: false })
          .eq('id', reminderFixtureIds[1])
          .select('id')
          .maybeSingle(),
      )
      const reminderBAfterUpdate = await safely(() =>
        clientB
          .from('task_reminders')
          .select('enabled')
          .eq('id', reminderFixtureIds[1])
          .maybeSingle(),
      )
      report(
        'A tidak dapat mengubah jadwal B dan pilihan B tetap aktif',
        wasDeniedOrMatchedNoRows(crossReminderUpdate) &&
          reminderBAfterUpdate.ok &&
          !reminderBAfterUpdate.result?.error &&
          reminderBAfterUpdate.result?.data?.enabled === true,
      )

      ensureNotInterrupted()
      const crossReminderDelete = await safely(() =>
        fixtureReminderClient(clientA, reminderFixtureIds[1])
          .from('task_reminders')
          .delete()
          .eq('id', reminderFixtureIds[1])
          .select('id')
          .maybeSingle(),
      )
      const reminderBAfterDelete = await safely(() =>
        clientB
          .from('task_reminders')
          .select('id')
          .eq('id', reminderFixtureIds[1])
          .maybeSingle(),
      )
      report(
        'A tidak dapat menghapus jadwal B dan jadwal B tetap ada',
        wasDeniedOrMatchedNoRows(crossReminderDelete) &&
          reminderBAfterDelete.ok &&
          !reminderBAfterDelete.result?.error &&
          reminderBAfterDelete.result?.data?.id === reminderFixtureIds[1],
      )
    }

    if (userAId && userBId) {
      const [aOwnProfile, aOtherProfile] = await Promise.all([
        safely(() =>
          clientA.from('profiles').select('id').eq('id', userAId).maybeSingle(),
        ),
        safely(() =>
          clientA.from('profiles').select('id').eq('id', userBId).maybeSingle(),
        ),
      ])
      report(
        'A dapat membaca profilnya sendiri',
        aOwnProfile.ok &&
          !aOwnProfile.result?.error &&
          aOwnProfile.result?.data?.id === userAId,
      )
      report(
        'A tidak dapat membaca profil B',
        aOtherProfile.ok &&
          !aOtherProfile.result?.error &&
          aOtherProfile.result?.data === null,
      )
    }
  }
} catch {
  if (stopRequested) {
    report('pengujian dihentikan; cleanup fixture tetap dijalankan', false)
    process.exitCode = 130
  } else {
    report('eksekusi skenario integrasi RLS', false)
  }
} finally {
  if (setupReady) await cleanupOwnedFixtures(userAId, userBId)
  await Promise.all(
    [clientA, clientB]
      .filter(Boolean)
      .map((client) => safely(() => client.auth.signOut())),
  )
}

if (stopRequested) process.exitCode = 130
else if (failures.length > 0) process.exitCode = 1
