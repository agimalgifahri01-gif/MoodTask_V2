mod native_reminders;
use native_reminders::{
    acknowledge_native_reminder_event, clear_native_reminder_snapshot,
    prepare_native_reminder_session, start_scheduler, sync_native_reminder_snapshot,
    ReminderEngine,
};
use std::sync::Arc;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const OPEN_MENU_ID: &str = "open-moodtask";
const EXIT_MENU_ID: &str = "exit-moodtask";

#[derive(Debug, PartialEq, Eq)]
enum TrayAction {
    Open,
    Exit,
    Ignore,
}

fn tray_action_for_menu_id(id: &str) -> TrayAction {
    match id {
        OPEN_MENU_ID => TrayAction::Open,
        EXIT_MENU_ID => TrayAction::Exit,
        _ => TrayAction::Ignore,
    }
}

fn show_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        eprintln!("MoodTask main window is unavailable.");
        return;
    };

    if let Err(error) = window.show() {
        eprintln!("Could not show MoodTask main window: {error}");
        return;
    }

    if let Err(error) = window.set_focus() {
        eprintln!("Could not focus MoodTask main window: {error}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_main_window(app)
        }))
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let engine = Arc::new(ReminderEngine::load(
                data_dir.join("native-reminders-v1.json"),
            ));
            app.manage(engine.clone());
            start_scheduler(app.handle().clone(), engine);
            let open_item =
                MenuItem::with_id(app, OPEN_MENU_ID, "Buka MoodTask", true, None::<&str>)?;
            let exit_item = MenuItem::with_id(
                app,
                EXIT_MENU_ID,
                "Keluar dari MoodTask",
                true,
                None::<&str>,
            )?;
            let menu = Menu::with_items(app, &[&open_item, &exit_item])?;
            let icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))?;

            TrayIconBuilder::with_id("moodtask-tray")
                .icon(icon)
                .tooltip("MoodTask")
                .menu(&menu)
                .on_menu_event(
                    |app, event| match tray_action_for_menu_id(event.id().as_ref()) {
                        TrayAction::Open => show_main_window(app),
                        TrayAction::Exit => app.exit(0),
                        TrayAction::Ignore => {}
                    },
                )
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            acknowledge_native_reminder_event,
            prepare_native_reminder_session,
            sync_native_reminder_snapshot,
            clear_native_reminder_snapshot,
        ])
        .on_window_event(|window, event| {
            if window.label() != MAIN_WINDOW_LABEL {
                return;
            }

            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(error) = window.hide() {
                    eprintln!("Could not hide MoodTask main window: {error}");
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run MoodTask Desktop");
}

#[cfg(test)]
mod tests {
    use super::{tray_action_for_menu_id, TrayAction, EXIT_MENU_ID, OPEN_MENU_ID};

    #[test]
    fn tray_menu_open_action_is_recognized() {
        assert_eq!(tray_action_for_menu_id(OPEN_MENU_ID), TrayAction::Open);
    }

    #[test]
    fn tray_menu_exit_action_is_recognized() {
        assert_eq!(tray_action_for_menu_id(EXIT_MENU_ID), TrayAction::Exit);
    }

    #[test]
    fn unknown_tray_menu_action_is_ignored() {
        assert_eq!(tray_action_for_menu_id("unexpected"), TrayAction::Ignore);
    }
}
