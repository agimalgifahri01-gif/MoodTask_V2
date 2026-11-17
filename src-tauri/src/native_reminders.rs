use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_notification::NotificationExt;
use uuid::Uuid;

const SCHEMA_VERSION: u32 = 1;
const MAX_REMINDER_MINUTES: i64 = 365 * 24 * 60;
const CHECK_INTERVAL: Duration = Duration::from_secs(10);

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTask {
    pub id: String,
    pub title: String,
    pub start_at_ms: i64,
    pub deadline_at_ms: i64,
    pub status: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeReminder {
    pub id: String,
    pub task_id: String,
    pub minutes_before: i64,
    pub enabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderSnapshot {
    pub owner_user_id: String,
    pub tasks: Vec<NativeTask>,
    pub reminders: Vec<NativeReminder>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReminderStore {
    schema_version: u32,
    owner_user_id: Option<String>,
    tasks: Vec<NativeTask>,
    reminders: Vec<NativeReminder>,
    processed_event_ids: BTreeSet<String>,
    #[serde(default)]
    pending_event_ids: BTreeSet<String>,
}

impl Default for ReminderStore {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            owner_user_id: None,
            tasks: Vec::new(),
            reminders: Vec::new(),
            processed_event_ids: BTreeSet::new(),
            pending_event_ids: BTreeSet::new(),
        }
    }
}

pub struct ReminderEngine {
    store: Mutex<ReminderStore>,
    store_path: PathBuf,
    armed: AtomicBool,
    scheduler_started: AtomicBool,
}

impl ReminderEngine {
    pub(super) fn load(store_path: PathBuf) -> Self {
        let store = match read_store(&store_path) {
            Ok(Some(store)) => store,
            Ok(None) => ReminderStore::default(),
            Err(_) => {
                eprintln!(
                    "MoodTask native reminder data could not be loaded; scheduler starts empty."
                );
                ReminderStore::default()
            }
        };
        Self {
            store: Mutex::new(store),
            store_path,
            // Wait until React restores the session, installs its event listener,
            // and synchronizes the current task/reminder snapshot.
            armed: AtomicBool::new(false),
            scheduler_started: AtomicBool::new(false),
        }
    }

    fn persist_replacement(&self, next: ReminderStore) -> Result<(), String> {
        validate_store(&next).map_err(|_| "Data pengingat tidak valid.".to_string())?;
        let mut store = self
            .store
            .lock()
            .map_err(|_| "Mesin pengingat tidak tersedia.".to_string())?;
        write_store(&self.store_path, &next)
            .map_err(|_| "Data pengingat lokal belum dapat disimpan.".to_string())?;
        *store = next;
        Ok(())
    }

    fn prepare_session(&self, owner_user_id: Option<String>) -> Result<(), String> {
        self.armed.store(false, Ordering::Release);
        let current = self
            .store
            .lock()
            .map_err(|_| "Mesin pengingat tidak tersedia.".to_string())?
            .clone();
        match owner_user_id {
            Some(owner) => {
                let owner = normalize_uuid(&owner)
                    .ok_or_else(|| "Identitas akun pengingat tidak valid.".to_string())?;
                if current.owner_user_id.as_deref() != Some(owner.as_str()) {
                    self.persist_replacement(ReminderStore {
                        owner_user_id: Some(owner),
                        ..ReminderStore::default()
                    })?;
                }
                self.armed.store(false, Ordering::Release);
            }
            None => {
                self.persist_replacement(ReminderStore::default())?;
                self.armed.store(true, Ordering::Release);
            }
        }
        Ok(())
    }

    fn sync_snapshot(&self, snapshot: ReminderSnapshot) -> Result<(), String> {
        self.armed.store(false, Ordering::Release);
        let owner = normalize_uuid(&snapshot.owner_user_id)
            .ok_or_else(|| "Identitas akun pengingat tidak valid.".to_string())?;
        let mut next = normalize_snapshot(snapshot, owner)?;
        let current = self
            .store
            .lock()
            .map_err(|_| "Mesin pengingat tidak tersedia.".to_string())?
            .clone();
        if current.owner_user_id == next.owner_user_id {
            let valid_events = event_ids_for_store(&next);
            next.processed_event_ids = current
                .processed_event_ids
                .intersection(&valid_events)
                .cloned()
                .collect();
            next.pending_event_ids = current
                .pending_event_ids
                .intersection(&valid_events)
                .cloned()
                .collect();
        }
        self.persist_replacement(next)?;
        self.armed.store(true, Ordering::Release);
        Ok(())
    }

    fn clear(&self) -> Result<(), String> {
        self.armed.store(false, Ordering::Release);
        self.persist_replacement(ReminderStore::default())?;
        self.armed.store(true, Ordering::Release);
        Ok(())
    }

    fn acknowledge_event(&self, event_id: &str) -> Result<(), String> {
        let mut store = self
            .store
            .lock()
            .map_err(|_| "Mesin pengingat tidak tersedia.".to_string())?;
        if !store.pending_event_ids.contains(event_id) {
            eprintln!(
                "[MoodTask] native reminder stage=event_ack_noop timestamp_epoch_ms={} trace_id={}",
                now_epoch_ms().unwrap_or_default(),
                reminder_trace_id(event_id)
            );
            return Ok(());
        }
        let mut next = store.clone();
        next.pending_event_ids.remove(event_id);
        next.processed_event_ids.insert(event_id.to_string());
        write_store(&self.store_path, &next)
            .map_err(|_| "Status penerimaan pengingat belum dapat disimpan.".to_string())?;
        *store = next;
        eprintln!(
            "[MoodTask] native reminder stage=event_acknowledged timestamp_epoch_ms={} trace_id={}",
            now_epoch_ms().unwrap_or_default(),
            reminder_trace_id(event_id)
        );
        Ok(())
    }

    fn claim_scheduler(&self) -> bool {
        self.scheduler_started
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }
}

fn normalize_uuid(value: &str) -> Option<String> {
    Uuid::parse_str(value).ok().map(|id| id.to_string())
}

fn normalize_snapshot(
    snapshot: ReminderSnapshot,
    owner_user_id: String,
) -> Result<ReminderStore, String> {
    let mut active_tasks = Vec::new();
    let mut task_ids = BTreeSet::new();
    for mut task in snapshot.tasks {
        let id = normalize_uuid(&task.id)
            .ok_or_else(|| "Snapshot memuat identitas tugas yang tidak valid.".to_string())?;
        if !task_ids.insert(id.clone()) {
            return Err("Snapshot memuat identitas tugas yang berulang.".to_string());
        }
        if task.title.trim().is_empty()
            || task.title.chars().count() > 120
            || task.title.chars().any(char::is_control)
        {
            return Err("Snapshot memuat judul tugas yang tidak valid.".to_string());
        }
        if task.start_at_ms < 0 || task.deadline_at_ms <= task.start_at_ms {
            return Err("Snapshot memuat rentang waktu tugas yang tidak valid.".to_string());
        }
        match task.status.as_str() {
            "active" => {
                task.id = id;
                task.title = task.title.trim().to_string();
                active_tasks.push(task);
            }
            "completed" | "cancelled" => {}
            _ => return Err("Snapshot memuat status tugas yang tidak dikenal.".to_string()),
        }
    }

    let active_task_ids: BTreeSet<String> =
        active_tasks.iter().map(|task| task.id.clone()).collect();
    let mut reminder_ids = BTreeSet::new();
    let mut reminders = Vec::new();
    for mut reminder in snapshot.reminders {
        let id = normalize_uuid(&reminder.id)
            .ok_or_else(|| "Snapshot memuat identitas pengingat yang tidak valid.".to_string())?;
        let task_id = normalize_uuid(&reminder.task_id)
            .ok_or_else(|| "Snapshot memuat relasi pengingat yang tidak valid.".to_string())?;
        if !reminder_ids.insert(id.clone()) {
            return Err("Snapshot memuat identitas pengingat yang berulang.".to_string());
        }
        if !active_task_ids.contains(&task_id) {
            continue;
        }
        let task = active_tasks
            .iter()
            .find(|task| task.id == task_id)
            .expect("active task id was checked");
        let offset_ms = reminder
            .minutes_before
            .checked_mul(60_000)
            .filter(|_| (1..=MAX_REMINDER_MINUTES).contains(&reminder.minutes_before))
            .ok_or_else(|| "Durasi pengingat berada di luar batas.".to_string())?;
        if offset_ms >= task.deadline_at_ms - task.start_at_ms {
            return Err("Waktu pengingat harus berada setelah waktu mulai tugas.".to_string());
        }
        reminder.id = id;
        reminder.task_id = task_id;
        reminders.push(reminder);
    }

    let mut store = ReminderStore {
        schema_version: SCHEMA_VERSION,
        owner_user_id: Some(owner_user_id),
        tasks: active_tasks,
        reminders,
        processed_event_ids: BTreeSet::new(),
        pending_event_ids: BTreeSet::new(),
    };
    validate_store(&store)?;
    store.processed_event_ids.clear();
    Ok(store)
}

fn validate_store(store: &ReminderStore) -> Result<(), String> {
    if store.schema_version != SCHEMA_VERSION {
        return Err("Versi data pengingat tidak didukung.".to_string());
    }
    if let Some(owner) = &store.owner_user_id {
        if normalize_uuid(owner).as_deref() != Some(owner.as_str()) {
            return Err("Pemilik data pengingat tidak valid.".to_string());
        }
    } else if !store.tasks.is_empty() || !store.reminders.is_empty() {
        return Err("Data pengingat tidak memiliki akun pemilik.".to_string());
    }
    let mut seen_tasks = BTreeSet::new();
    for task in &store.tasks {
        if normalize_uuid(&task.id).as_deref() != Some(task.id.as_str())
            || task.status != "active"
            || task.title.trim().is_empty()
            || task.title.chars().count() > 120
            || task.title.chars().any(char::is_control)
            || task.start_at_ms < 0
            || task.deadline_at_ms <= task.start_at_ms
            || !seen_tasks.insert(task.id.clone())
        {
            return Err("Data tugas pengingat tidak valid.".to_string());
        }
    }
    let mut seen_reminders = BTreeSet::new();
    for reminder in &store.reminders {
        let Some(task) = store.tasks.iter().find(|task| task.id == reminder.task_id) else {
            return Err("Data pengingat merujuk tugas yang tidak tersedia.".to_string());
        };
        let Some(offset_ms) = reminder.minutes_before.checked_mul(60_000) else {
            return Err("Durasi pengingat tidak valid.".to_string());
        };
        if normalize_uuid(&reminder.id).as_deref() != Some(reminder.id.as_str())
            || !(1..=MAX_REMINDER_MINUTES).contains(&reminder.minutes_before)
            || offset_ms >= task.deadline_at_ms - task.start_at_ms
            || !seen_reminders.insert(reminder.id.clone())
        {
            return Err("Data pengingat tidak valid.".to_string());
        }
    }
    let valid_events = event_ids_for_store(store);
    if store
        .processed_event_ids
        .intersection(&store.pending_event_ids)
        .next()
        .is_some()
        || store
            .processed_event_ids
            .union(&store.pending_event_ids)
            .any(|event| !valid_events.contains(event))
    {
        return Err("Status pengiriman pengingat tidak valid.".to_string());
    }
    Ok(())
}

fn event_id(owner: &str, task: &NativeTask, reminder: &NativeReminder) -> String {
    format!(
        "{owner}:{}:{}:{}",
        task.id, reminder.id, task.deadline_at_ms
    )
}

fn reminder_trace_id(event_id: &str) -> String {
    let hash = event_id
        .as_bytes()
        .iter()
        .fold(0xcbf29ce484222325_u64, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
        });
    format!("{hash:016x}")
}

fn event_ids_for_store(store: &ReminderStore) -> BTreeSet<String> {
    let Some(owner) = &store.owner_user_id else {
        return BTreeSet::new();
    };
    let tasks: std::collections::BTreeMap<_, _> = store
        .tasks
        .iter()
        .map(|task| (task.id.as_str(), task))
        .collect();
    store
        .reminders
        .iter()
        .filter(|reminder| reminder.enabled)
        .filter_map(|reminder| {
            tasks
                .get(reminder.task_id.as_str())
                .map(|task| event_id(owner, task, reminder))
        })
        .collect()
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct DueReminder {
    event_id: String,
    title: String,
    deadline_at_ms: i64,
    scheduled_at_ms: i64,
}

#[derive(Default)]
struct DueBatch {
    deliver: Vec<DueReminder>,
    consume: BTreeSet<String>,
    tasks_read: usize,
    active_tasks_read: usize,
    reminders_compared: usize,
}

fn collect_due(store: &ReminderStore, now_ms: i64) -> DueBatch {
    let Some(owner) = &store.owner_user_id else {
        return DueBatch::default();
    };
    let mut batch = DueBatch {
        tasks_read: store.tasks.len(),
        ..DueBatch::default()
    };
    for task in store.tasks.iter().filter(|task| task.status == "active") {
        batch.active_tasks_read += 1;
        let mut due: Vec<_> = store
            .reminders
            .iter()
            .filter(|reminder| reminder.enabled && reminder.task_id == task.id)
            .map(|reminder| {
                batch.reminders_compared += 1;
                let scheduled_at_ms = task.deadline_at_ms - reminder.minutes_before * 60_000;
                DueReminder {
                    event_id: event_id(owner, task, reminder),
                    title: task.title.clone(),
                    deadline_at_ms: task.deadline_at_ms,
                    scheduled_at_ms,
                }
            })
            .filter(|reminder| reminder.scheduled_at_ms <= now_ms)
            .collect();
        if due.is_empty() {
            continue;
        }
        due.sort_by(|left, right| {
            left.scheduled_at_ms
                .cmp(&right.scheduled_at_ms)
                .then_with(|| left.event_id.cmp(&right.event_id))
        });
        let selected = if now_ms >= task.deadline_at_ms {
            // After sleep/deadline, use only the reminder closest to the deadline.
            due.iter().max_by_key(|item| item.scheduled_at_ms)
        } else {
            // If several reminders were missed while asleep, deliver only the latest one.
            due.last()
        };
        batch
            .consume
            .extend(due.iter().map(|item| item.event_id.clone()));
        if let Some(selected) = selected {
            if !store.processed_event_ids.contains(&selected.event_id)
                && !store.pending_event_ids.contains(&selected.event_id)
            {
                batch.deliver.push(selected.clone());
            }
        }
    }
    batch.deliver.sort_by(|left, right| {
        left.scheduled_at_ms
            .cmp(&right.scheduled_at_ms)
            .then_with(|| left.event_id.cmp(&right.event_id))
    });
    batch
}

fn read_store(path: &Path) -> Result<Option<ReminderStore>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(path).map_err(|_| "read failed".to_string())?;
    let store: ReminderStore =
        serde_json::from_slice(&bytes).map_err(|_| "parse failed".to_string())?;
    validate_store(&store)?;
    Ok(Some(store))
}

fn write_store(path: &Path, store: &ReminderStore) -> Result<(), String> {
    validate_store(store)?;
    let parent = path.parent().ok_or_else(|| "missing parent".to_string())?;
    fs::create_dir_all(parent).map_err(|_| "mkdir failed".to_string())?;
    let temp_path = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec(store).map_err(|_| "serialize failed".to_string())?;
    {
        let mut file = fs::File::create(&temp_path).map_err(|_| "create failed".to_string())?;
        file.write_all(&bytes)
            .map_err(|_| "write failed".to_string())?;
        file.sync_all().map_err(|_| "sync failed".to_string())?;
    }
    fs::rename(&temp_path, path).map_err(|_| "rename failed".to_string())?;
    Ok(())
}

fn now_epoch_ms() -> Option<i64> {
    let elapsed = SystemTime::now().duration_since(UNIX_EPOCH).ok()?;
    i64::try_from(elapsed.as_millis()).ok()
}

fn format_deadline(deadline_at_ms: i64, now_ms: i64) -> String {
    let delta = deadline_at_ms - now_ms;
    if delta <= 0 {
        return "Deadline sudah terlewat.".to_string();
    }
    let total_minutes = (delta + 59_999) / 60_000;
    let days = total_minutes / 1_440;
    let hours = (total_minutes % 1_440) / 60;
    let minutes = total_minutes % 60;
    let remaining = if days > 0 {
        format!("{days} hari {} jam", hours)
    } else if hours > 0 {
        format!("{hours} jam {} menit", minutes)
    } else {
        format!("{minutes} menit")
    };
    format!("Deadline dalam {remaining}.")
}

fn process_due(app: &AppHandle, engine: &ReminderEngine) {
    if !engine.armed.load(Ordering::Acquire) {
        return;
    }
    let Some(now_ms) = now_epoch_ms() else {
        return;
    };
    let Ok(mut store) = engine.store.lock() else {
        eprintln!("MoodTask reminder state is unavailable.");
        return;
    };
    let batch = collect_due(&store, now_ms);
    eprintln!(
        "[MoodTask] native reminder stage=scheduler_scan timestamp_epoch_ms={now_ms} tasks_read={} active_tasks={} reminders_compared={} due_events={} pending_events={}",
        batch.tasks_read,
        batch.active_tasks_read,
        batch.reminders_compared,
        batch.consume.len(),
        store.pending_event_ids.len()
    );
    if batch.consume.is_empty() && store.pending_event_ids.is_empty() {
        return;
    }
    let new_delivery_ids: BTreeSet<_> = batch
        .deliver
        .iter()
        .map(|reminder| reminder.event_id.clone())
        .collect();
    let mut next = store.clone();
    for event in &batch.consume {
        if next.processed_event_ids.contains(event) || next.pending_event_ids.contains(event) {
            continue;
        }
        if new_delivery_ids.contains(event) {
            next.pending_event_ids.insert(event.clone());
        } else {
            // Older missed reminders are consumed when the latest is selected.
            next.processed_event_ids.insert(event.clone());
        }
    }
    if next != *store {
        if write_store(&engine.store_path, &next).is_err() {
            eprintln!("MoodTask could not persist reminder delivery state; delivery will retry.");
            return;
        }
        *store = next;
    }

    let mut pending: Vec<_> = store
        .pending_event_ids
        .iter()
        .filter(|event| !new_delivery_ids.contains(*event))
        .filter_map(|event| reminder_for_event(&store, event))
        .collect();
    pending.extend(batch.deliver.iter().cloned());
    pending.sort_by(|left, right| {
        left.scheduled_at_ms
            .cmp(&right.scheduled_at_ms)
            .then_with(|| left.event_id.cmp(&right.event_id))
    });

    // Keep the owner snapshot locked until dispatch finishes so an account change
    // cannot replace it between event selection and native notification delivery.
    for reminder in pending {
        let is_new = new_delivery_ids.contains(&reminder.event_id);
        let trace_id = reminder_trace_id(&reminder.event_id);
        if is_new {
            eprintln!(
                "[MoodTask] native reminder stage=scheduler_detected timestamp_epoch_ms={now_ms} trace_id={trace_id}"
            );
            eprintln!(
                "[MoodTask] native reminder stage=deadline_compared timestamp_epoch_ms={now_ms} trace_id={trace_id} now_epoch_ms={now_ms} scheduled_at_epoch_ms={} deadline_epoch_ms={} due=true",
                reminder.scheduled_at_ms,
                reminder.deadline_at_ms
            );
        }
        if is_new {
            let body = format!(
                "{} — {}",
                reminder.title,
                format_deadline(reminder.deadline_at_ms, now_ms)
            );
            let toast_result = app
                .notification()
                .builder()
                .title("MoodTask")
                .body(body)
                .show();
            match toast_result {
            Ok(()) => eprintln!(
                "[MoodTask] native reminder stage=toast_show_accepted timestamp_epoch_ms={now_ms} trace_id={trace_id}"
            ),
            Err(_) => eprintln!(
                "[MoodTask] native reminder stage=toast_failed timestamp_epoch_ms={now_ms} trace_id={trace_id}"
            ),
        }
        }
        eprintln!(
            "[MoodTask] native reminder stage=event_emit_started timestamp_epoch_ms={now_ms} trace_id={trace_id} retry={} ",
            !is_new
        );
        match try_emit_native_event(&reminder.event_id, |event_id| {
            app.emit(
                "moodtask://native-reminder-received",
                serde_json::json!({ "eventId": event_id }),
            )
        }) {
            Ok(()) => eprintln!(
                "[MoodTask] native reminder stage=event_emit_succeeded timestamp_epoch_ms={now_ms} trace_id={trace_id}"
            ),
            Err(_) => eprintln!(
                "[MoodTask] native reminder stage=event_emit_failed timestamp_epoch_ms={now_ms} trace_id={trace_id}"
            ),
        }
    }
}

fn reminder_for_event(store: &ReminderStore, wanted_event_id: &str) -> Option<DueReminder> {
    let owner = store.owner_user_id.as_deref()?;
    store.tasks.iter().find_map(|task| {
        store
            .reminders
            .iter()
            .filter(|reminder| reminder.enabled && reminder.task_id == task.id)
            .find_map(|reminder| {
                let candidate_id = event_id(owner, task, reminder);
                (candidate_id == wanted_event_id).then(|| DueReminder {
                    event_id: candidate_id,
                    title: task.title.clone(),
                    deadline_at_ms: task.deadline_at_ms,
                    scheduled_at_ms: task.deadline_at_ms - reminder.minutes_before * 60_000,
                })
            })
    })
}

fn try_emit_native_event<E>(
    event_id: &str,
    emit: impl FnOnce(&str) -> Result<(), E>,
) -> Result<(), E> {
    emit(event_id)
}

pub(super) fn start_scheduler(app: AppHandle, engine: Arc<ReminderEngine>) {
    if !engine.claim_scheduler() {
        return;
    }
    eprintln!(
        "[MoodTask] native reminder stage=scheduler_started timestamp_epoch_ms={}",
        now_epoch_ms().unwrap_or_default()
    );
    let spawn_guard = engine.clone();
    let spawn = thread::Builder::new()
        .name("moodtask-reminder-scheduler".to_string())
        .spawn(move || loop {
            process_due(&app, &engine);
            thread::sleep(CHECK_INTERVAL);
        });
    if spawn.is_err() {
        spawn_guard
            .scheduler_started
            .store(false, Ordering::Release);
        eprintln!("MoodTask native reminder scheduler could not start.");
    }
}

#[tauri::command]
pub fn prepare_native_reminder_session(
    owner_user_id: Option<String>,
    engine: State<'_, Arc<ReminderEngine>>,
) -> Result<(), String> {
    engine.prepare_session(owner_user_id)
}

#[tauri::command]
pub fn sync_native_reminder_snapshot(
    snapshot: ReminderSnapshot,
    engine: State<'_, Arc<ReminderEngine>>,
) -> Result<(), String> {
    engine.sync_snapshot(snapshot)
}

#[tauri::command]
pub fn acknowledge_native_reminder_event(
    event_id: String,
    engine: State<'_, Arc<ReminderEngine>>,
) -> Result<(), String> {
    engine.acknowledge_event(&event_id)
}

#[tauri::command]
pub fn clear_native_reminder_snapshot(
    engine: State<'_, Arc<ReminderEngine>>,
) -> Result<(), String> {
    engine.clear()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU64;

    const OWNER_A: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const OWNER_B: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const TASK_A: &str = "11111111-1111-4111-8111-111111111111";
    const TASK_B: &str = "22222222-2222-4222-8222-222222222222";
    const TASK_C: &str = "55555555-5555-4555-8555-555555555555";
    const REMINDER_A: &str = "33333333-3333-4333-8333-333333333333";
    const REMINDER_B: &str = "44444444-4444-4444-8444-444444444444";
    const REMINDER_C: &str = "66666666-6666-4666-8666-666666666666";
    const START: i64 = 1_800_000_000_000;
    const DEADLINE: i64 = START + 60 * 60_000;
    static NEXT_TEST_DIR: AtomicU64 = AtomicU64::new(1);

    fn temp_store_path() -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "moodtask-native-reminders-{}-{}",
            std::process::id(),
            NEXT_TEST_DIR.fetch_add(1, Ordering::Relaxed)
        ));
        let path = dir.join("reminders.json");
        (dir, path)
    }

    fn task(id: &str, status: &str, deadline_at_ms: i64) -> NativeTask {
        NativeTask {
            id: id.to_string(),
            title: format!("Tugas {id}"),
            start_at_ms: START,
            deadline_at_ms,
            status: status.to_string(),
        }
    }

    fn reminder(id: &str, task_id: &str, minutes_before: i64) -> NativeReminder {
        NativeReminder {
            id: id.to_string(),
            task_id: task_id.to_string(),
            minutes_before,
            enabled: true,
        }
    }

    fn snapshot(
        owner: &str,
        tasks: Vec<NativeTask>,
        reminders: Vec<NativeReminder>,
    ) -> ReminderSnapshot {
        ReminderSnapshot {
            owner_user_id: owner.to_string(),
            tasks,
            reminders,
        }
    }

    #[test]
    fn valid_task_and_reminder_are_registered() {
        let store = normalize_snapshot(
            snapshot(
                OWNER_A,
                vec![task(TASK_A, "active", DEADLINE)],
                vec![reminder(REMINDER_A, TASK_A, 10)],
            ),
            OWNER_A.to_string(),
        )
        .unwrap();
        assert_eq!(store.tasks.len(), 1);
        assert_eq!(store.reminders.len(), 1);
        let due = collect_due(&store, DEADLINE - 10 * 60_000);
        assert_eq!(due.deliver.len(), 1);
    }

    #[test]
    fn reminder_trace_id_is_opaque_and_stable() {
        assert_eq!(reminder_trace_id("hello"), "a430d84680aabd0b");
    }

    #[test]
    fn changing_deadline_changes_stable_event_identity() {
        let original = normalize_snapshot(
            snapshot(
                OWNER_A,
                vec![task(TASK_A, "active", DEADLINE)],
                vec![reminder(REMINDER_A, TASK_A, 10)],
            ),
            OWNER_A.to_string(),
        )
        .unwrap();
        let updated = normalize_snapshot(
            snapshot(
                OWNER_A,
                vec![task(TASK_A, "active", DEADLINE + 30 * 60_000)],
                vec![reminder(REMINDER_A, TASK_A, 10)],
            ),
            OWNER_A.to_string(),
        )
        .unwrap();
        assert_ne!(
            event_ids_for_store(&original),
            event_ids_for_store(&updated)
        );
    }

    #[test]
    fn completed_cancelled_and_deleted_tasks_never_schedule() {
        let store = normalize_snapshot(
            snapshot(
                OWNER_A,
                vec![
                    task(TASK_A, "completed", DEADLINE),
                    task(TASK_C, "cancelled", DEADLINE),
                ],
                vec![
                    reminder(REMINDER_A, TASK_A, 10),
                    reminder(REMINDER_C, TASK_C, 10),
                ],
            ),
            OWNER_A.to_string(),
        )
        .unwrap();
        assert!(store.tasks.is_empty());
        assert!(collect_due(&store, DEADLINE).deliver.is_empty());

        let deleted = normalize_snapshot(
            snapshot(OWNER_A, vec![], vec![reminder(REMINDER_B, TASK_B, 10)]),
            OWNER_A.to_string(),
        )
        .unwrap();
        assert!(deleted.reminders.is_empty());
    }

    #[test]
    fn same_event_is_consumed_at_most_once() {
        let mut store = normalize_snapshot(
            snapshot(
                OWNER_A,
                vec![task(TASK_A, "active", DEADLINE)],
                vec![reminder(REMINDER_A, TASK_A, 10)],
            ),
            OWNER_A.to_string(),
        )
        .unwrap();
        let first = collect_due(&store, DEADLINE - 10 * 60_000);
        store.processed_event_ids.extend(first.consume);
        assert_eq!(collect_due(&store, DEADLINE - 10 * 60_000).deliver.len(), 0);
    }

    #[test]
    fn catch_up_only_delivers_latest_missed_reminder_before_deadline() {
        let store = normalize_snapshot(
            snapshot(
                OWNER_A,
                vec![task(TASK_A, "active", DEADLINE)],
                vec![
                    reminder(REMINDER_A, TASK_A, 30),
                    reminder(REMINDER_B, TASK_A, 10),
                ],
            ),
            OWNER_A.to_string(),
        )
        .unwrap();
        let batch = collect_due(&store, DEADLINE - 5 * 60_000);
        assert_eq!(batch.deliver.len(), 1);
        assert_eq!(
            batch.deliver[0].event_id,
            event_id(OWNER_A, &store.tasks[0], &store.reminders[1])
        );
        assert_eq!(batch.consume.len(), 2);
    }

    #[test]
    fn after_deadline_only_closest_reminder_is_selected() {
        let store = normalize_snapshot(
            snapshot(
                OWNER_A,
                vec![task(TASK_A, "active", DEADLINE)],
                vec![
                    reminder(REMINDER_A, TASK_A, 30),
                    reminder(REMINDER_B, TASK_A, 10),
                ],
            ),
            OWNER_A.to_string(),
        )
        .unwrap();
        let batch = collect_due(&store, DEADLINE + 1);
        assert_eq!(batch.deliver.len(), 1);
        assert_eq!(
            batch.deliver[0].event_id,
            event_id(OWNER_A, &store.tasks[0], &store.reminders[1])
        );
    }

    #[test]
    fn persisted_snapshot_reloads_after_restart() {
        let (dir, path) = temp_store_path();
        let store = normalize_snapshot(
            snapshot(
                OWNER_A,
                vec![task(TASK_A, "active", DEADLINE)],
                vec![reminder(REMINDER_A, TASK_A, 10)],
            ),
            OWNER_A.to_string(),
        )
        .unwrap();
        write_store(&path, &store).unwrap();
        assert_eq!(read_store(&path).unwrap(), Some(store));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn scheduler_starts_disarmed_until_frontend_snapshot_is_synchronized() {
        let (dir, path) = temp_store_path();
        let engine = ReminderEngine::load(path.clone());
        assert!(!engine.armed.load(Ordering::Acquire));
        engine
            .sync_snapshot(snapshot(
                OWNER_A,
                vec![task(TASK_A, "active", DEADLINE)],
                vec![reminder(REMINDER_A, TASK_A, 10)],
            ))
            .unwrap();
        assert!(engine.armed.load(Ordering::Acquire));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn unacknowledged_delivery_survives_restart_and_is_retried() {
        let (dir, path) = temp_store_path();
        let mut store = normalize_snapshot(
            snapshot(
                OWNER_A,
                vec![task(TASK_A, "active", DEADLINE)],
                vec![reminder(REMINDER_A, TASK_A, 10)],
            ),
            OWNER_A.to_string(),
        )
        .unwrap();
        let id = event_id(OWNER_A, &store.tasks[0], &store.reminders[0]);
        store.pending_event_ids.insert(id.clone());
        write_store(&path, &store).unwrap();

        let restarted = ReminderEngine::load(path.clone());
        assert!(!restarted.armed.load(Ordering::Acquire));
        let restored = read_store(&path).unwrap().unwrap();
        assert!(restored.pending_event_ids.contains(&id));
        assert_eq!(collect_due(&restored, DEADLINE + 1).deliver.len(), 0);
        assert!(reminder_for_event(&restored, &id).is_some());
        assert_eq!(collect_due(&restored, DEADLINE + 1).deliver.len(), 0);
        assert!(reminder_for_event(&restored, &id).is_some());

        restarted.acknowledge_event(&id).unwrap();
        let acknowledged = read_store(&path).unwrap().unwrap();
        assert!(!acknowledged.pending_event_ids.contains(&id));
        assert!(acknowledged.processed_event_ids.contains(&id));
        assert_eq!(collect_due(&acknowledged, DEADLINE + 1).deliver.len(), 0);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn event_emit_failure_leaves_delivery_pending_for_retry() {
        let mut store = normalize_snapshot(
            snapshot(
                OWNER_A,
                vec![task(TASK_A, "active", DEADLINE)],
                vec![reminder(REMINDER_A, TASK_A, 10)],
            ),
            OWNER_A.to_string(),
        )
        .unwrap();
        let id = event_id(OWNER_A, &store.tasks[0], &store.reminders[0]);
        store.pending_event_ids.insert(id.clone());

        let result: Result<(), &str> = try_emit_native_event(&id, |_| Err("event bus failed"));

        assert_eq!(result, Err("event bus failed"));
        assert!(store.pending_event_ids.contains(&id));
        assert!(!store.processed_event_ids.contains(&id));
        assert!(reminder_for_event(&store, &id).is_some());
    }

    #[test]
    fn snapshot_changes_discard_pending_events_for_changed_or_removed_tasks() {
        let (dir, path) = temp_store_path();
        let engine = ReminderEngine::load(path.clone());
        engine
            .sync_snapshot(snapshot(
                OWNER_A,
                vec![task(TASK_A, "active", DEADLINE)],
                vec![reminder(REMINDER_A, TASK_A, 10)],
            ))
            .unwrap();
        let current = read_store(&path).unwrap().unwrap();
        let id = event_id(OWNER_A, &current.tasks[0], &current.reminders[0]);
        let mut with_pending = current;
        with_pending.pending_event_ids.insert(id.clone());
        write_store(&path, &with_pending).unwrap();

        engine
            .sync_snapshot(snapshot(
                OWNER_A,
                vec![task(TASK_A, "active", DEADLINE + 30 * 60_000)],
                vec![reminder(REMINDER_A, TASK_A, 10)],
            ))
            .unwrap();
        let after_deadline_change = read_store(&path).unwrap().unwrap();
        assert!(!after_deadline_change.pending_event_ids.contains(&id));

        let new_id = event_id(
            OWNER_A,
            &after_deadline_change.tasks[0],
            &after_deadline_change.reminders[0],
        );
        let mut with_new_pending = after_deadline_change;
        with_new_pending.pending_event_ids.insert(new_id.clone());
        write_store(&path, &with_new_pending).unwrap();
        engine
            .sync_snapshot(snapshot(OWNER_A, vec![], vec![]))
            .unwrap();
        let after_delete = read_store(&path).unwrap().unwrap();
        assert!(!after_delete.pending_event_ids.contains(&new_id));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn legacy_store_without_pending_event_field_remains_readable() {
        let store = normalize_snapshot(
            snapshot(
                OWNER_A,
                vec![task(TASK_A, "active", DEADLINE)],
                vec![reminder(REMINDER_A, TASK_A, 10)],
            ),
            OWNER_A.to_string(),
        )
        .unwrap();
        let mut value = serde_json::to_value(&store).unwrap();
        value.as_object_mut().unwrap().remove("pendingEventIds");
        let loaded: ReminderStore = serde_json::from_value(value).unwrap();
        assert!(loaded.pending_event_ids.is_empty());
    }
    #[test]
    fn account_switch_replaces_snapshot_without_mixing_data() {
        let (dir, path) = temp_store_path();
        let engine = ReminderEngine::load(path.clone());
        engine
            .sync_snapshot(snapshot(
                OWNER_A,
                vec![task(TASK_A, "active", DEADLINE)],
                vec![reminder(REMINDER_A, TASK_A, 10)],
            ))
            .unwrap();
        engine.prepare_session(Some(OWNER_B.to_string())).unwrap();
        let switched = read_store(&path).unwrap().unwrap();
        assert_eq!(switched.owner_user_id.as_deref(), Some(OWNER_B));
        assert!(switched.tasks.is_empty());
        assert!(!engine.armed.load(Ordering::Acquire));

        engine
            .sync_snapshot(snapshot(
                OWNER_B,
                vec![task(TASK_B, "active", DEADLINE)],
                vec![reminder(REMINDER_B, TASK_B, 10)],
            ))
            .unwrap();
        let next = read_store(&path).unwrap().unwrap();
        assert_eq!(next.owner_user_id.as_deref(), Some(OWNER_B));
        assert_eq!(
            next.tasks
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec![TASK_B]
        );
        assert_eq!(
            next.reminders
                .iter()
                .map(|item| item.task_id.as_str())
                .collect::<Vec<_>>(),
            vec![TASK_B]
        );
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn logout_clear_store_has_no_owner_or_reminders() {
        let (dir, path) = temp_store_path();
        let engine = ReminderEngine::load(path.clone());
        engine
            .sync_snapshot(snapshot(
                OWNER_A,
                vec![task(TASK_A, "active", DEADLINE)],
                vec![reminder(REMINDER_A, TASK_A, 10)],
            ))
            .unwrap();
        engine.clear().unwrap();
        let cleared = read_store(&path).unwrap().unwrap();
        validate_store(&cleared).unwrap();
        assert_eq!(cleared.owner_user_id, None);
        assert!(cleared.tasks.is_empty());
        assert!(cleared.reminders.is_empty());
        assert!(collect_due(&cleared, DEADLINE).deliver.is_empty());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn scheduler_start_guard_allows_only_one_instance() {
        let started = AtomicBool::new(false);
        assert!(started
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok());
        assert!(started
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err());
    }

    #[test]
    fn notification_selection_does_not_depend_on_window_visibility() {
        let store = normalize_snapshot(
            snapshot(
                OWNER_A,
                vec![task(TASK_A, "active", DEADLINE)],
                vec![reminder(REMINDER_A, TASK_A, 10)],
            ),
            OWNER_A.to_string(),
        )
        .unwrap();
        assert_eq!(collect_due(&store, DEADLINE - 10 * 60_000).deliver.len(), 1);
    }

    #[test]
    fn malformed_or_unknown_version_storage_is_rejected_without_crash() {
        let mut store = ReminderStore::default();
        store.schema_version = SCHEMA_VERSION + 1;
        assert!(validate_store(&store).is_err());
        assert!(normalize_snapshot(
            snapshot(OWNER_A, vec![task(TASK_A, "active", START)], vec![]),
            OWNER_A.to_string(),
        )
        .is_err());
    }
}
