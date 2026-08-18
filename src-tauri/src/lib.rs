mod clipboard;

use std::sync::{Arc, Mutex};
use clipboard::{ClipboardItem, ClipboardManager};
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[derive(Serialize, Deserialize, Clone)]
struct AppConfig {
    #[serde(default)]
    shortcut: Option<String>,
    #[serde(default)]
    shortcuts: Vec<String>,
}

fn get_config_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|p| p.join("config.json"))
}

fn load_saved_shortcuts(app: &AppHandle) -> Vec<String> {
    if let Some(path) = get_config_path(app) {
        if let Ok(content) = std::fs::read_to_string(path) {
            if let Ok(config) = serde_json::from_str::<AppConfig>(&content) {
                let mut list = config.shortcuts;
                if let Some(single) = config.shortcut {
                    let s_trimmed = single.trim().to_string();
                    if !s_trimmed.is_empty() && !list.iter().any(|item| item.eq_ignore_ascii_case(&s_trimmed)) {
                        list.push(s_trimmed);
                    }
                }
                if !list.is_empty() {
                    return list;
                }
            }
        }
    }
    vec!["Alt+V".to_string()]
}

fn save_saved_shortcuts(app: &AppHandle, shortcuts: &[String]) {
    if let Some(path) = get_config_path(app) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let config = AppConfig {
            shortcut: shortcuts.first().cloned(),
            shortcuts: shortcuts.to_vec(),
        };
        if let Ok(json) = serde_json::to_string_pretty(&config) {
            let _ = std::fs::write(path, json);
        }
    }
}

struct AppState {
    manager: Arc<ClipboardManager>,
    current_shortcuts: Arc<Mutex<Vec<String>>>,
}

#[cfg(windows)]
fn simulate_ctrl_v() {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL,
    };
    use std::mem::size_of;

    unsafe {
        let mut inputs: [INPUT; 4] = std::mem::zeroed();

        // 1. Ctrl Key Down
        inputs[0].r#type = INPUT_KEYBOARD;
        inputs[0].Anonymous.ki = KEYBDINPUT {
            wVk: VK_CONTROL,
            wScan: 0,
            dwFlags: 0,
            time: 0,
            dwExtraInfo: 0,
        };

        // 2. 'V' Key Down (0x56)
        inputs[1].r#type = INPUT_KEYBOARD;
        inputs[1].Anonymous.ki = KEYBDINPUT {
            wVk: 0x56,
            wScan: 0,
            dwFlags: 0,
            time: 0,
            dwExtraInfo: 0,
        };

        // 3. 'V' Key Up
        inputs[2].r#type = INPUT_KEYBOARD;
        inputs[2].Anonymous.ki = KEYBDINPUT {
            wVk: 0x56,
            wScan: 0,
            dwFlags: KEYEVENTF_KEYUP,
            time: 0,
            dwExtraInfo: 0,
        };

        // 4. Ctrl Key Up
        inputs[3].r#type = INPUT_KEYBOARD;
        inputs[3].Anonymous.ki = KEYBDINPUT {
            wVk: VK_CONTROL,
            wScan: 0,
            dwFlags: KEYEVENTF_KEYUP,
            time: 0,
            dwExtraInfo: 0,
        };

        SendInput(4, inputs.as_mut_ptr(), size_of::<INPUT>() as i32);
    }
}

#[cfg(windows)]
fn get_caret_or_cursor_position() -> (i32, i32) {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::Graphics::Gdi::ClientToScreen;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetCursorPos, GetForegroundWindow, GetGUIThreadInfo,
        GetWindowThreadProcessId, GUITHREADINFO,
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if !hwnd.is_null() {
            let thread_id = GetWindowThreadProcessId(hwnd, std::ptr::null_mut());
            let mut gui_info: GUITHREADINFO = std::mem::zeroed();
            gui_info.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;

            if GetGUIThreadInfo(thread_id, &mut gui_info) != 0 && !gui_info.hwndCaret.is_null() {
                let mut pt = POINT {
                    x: gui_info.rcCaret.left,
                    y: gui_info.rcCaret.bottom,
                };
                if ClientToScreen(gui_info.hwndCaret, &mut pt) != 0 {
                    if pt.x > 0 || pt.y > 0 {
                        return (pt.x, pt.y);
                    }
                }
            }
        }

        // Fallback: mouse cursor position
        let mut pt = POINT { x: 0, y: 0 };
        if GetCursorPos(&mut pt) != 0 {
            return (pt.x, pt.y);
        }

        (500, 500)
    }
}

#[cfg(windows)]
fn calculate_smart_position(window_width: i32, window_height: i32) -> (i32, i32) {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };

    let (target_x, target_y) = get_caret_or_cursor_position();

    unsafe {
        let pt = POINT {
            x: target_x,
            y: target_y,
        };
        let h_monitor = MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST);
        let mut mi: MONITORINFO = std::mem::zeroed();
        mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;

        let (work_left, work_top, work_right, work_bottom) =
            if GetMonitorInfoW(h_monitor, &mut mi) != 0 {
                (
                    mi.rcWork.left,
                    mi.rcWork.top,
                    mi.rcWork.right,
                    mi.rcWork.bottom,
                )
            } else {
                (0, 0, 1920, 1080)
            };

        // Align horizontally near the input field, clamping to screen edges
        let mut x = target_x - 30;
        if x + window_width > work_right - 12 {
            x = work_right - window_width - 12;
        }
        if x < work_left + 12 {
            x = work_left + 12;
        }

        // Check if there is enough space BELOW the input field
        let space_below = work_bottom - (target_y + 8);
        let y = if space_below >= window_height {
            // Position BELOW the input field
            target_y + 8
        } else {
            // Not enough room below -> position ABOVE the input field
            let y_above = target_y - window_height - 8;
            if y_above < work_top + 12 {
                work_bottom - window_height - 12
            } else {
                y_above
            }
        };

        (x, y)
    }
}

#[tauri::command]
fn get_history(state: State<'_, AppState>) -> Vec<ClipboardItem> {
    state.manager.get_items()
}

#[tauri::command]
fn copy_to_system(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.manager.copy_and_bump_to_top(&id, &app)
}

#[tauri::command]
fn paste_item(window: tauri::Window, app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.manager.copy_and_bump_to_top(&id, &app)?;
    let _ = window.hide();

    #[cfg(windows)]
    {
        std::thread::spawn(|| {
            // Give 50ms for Windows to return focus back to the target text box/window
            std::thread::sleep(std::time::Duration::from_millis(50));
            simulate_ctrl_v();
        });
    }

    Ok(())
}

#[tauri::command]
fn toggle_pin(app: AppHandle, state: State<'_, AppState>, id: String) -> Vec<ClipboardItem> {
    state.manager.toggle_pin(&id, &app)
}

#[tauri::command]
fn delete_item(app: AppHandle, state: State<'_, AppState>, id: String) -> Vec<ClipboardItem> {
    state.manager.delete_item(&id, &app)
}

#[tauri::command]
fn clear_unpinned(app: AppHandle, state: State<'_, AppState>) -> Vec<ClipboardItem> {
    state.manager.clear_unpinned(&app)
}

#[tauri::command]
fn hide_window(window: tauri::Window) {
    let _ = window.hide();
}

#[tauri::command]
fn toggle_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            #[cfg(windows)]
            {
                let (x, y) = calculate_smart_position(370, 440);
                let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
            }
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

#[tauri::command]
fn get_shortcuts(state: State<'_, AppState>) -> Vec<String> {
    state.current_shortcuts.lock().unwrap().clone()
}

#[tauri::command]
fn add_shortcut(app: AppHandle, state: State<'_, AppState>, new_shortcut: String) -> Result<Vec<String>, String> {
    let clean = new_shortcut.trim().to_string();
    let parsed: Shortcut = clean
        .parse()
        .map_err(|e| format!("Invalid shortcut combination '{}': {:?}", clean, e))?;

    let mut current = state.current_shortcuts.lock().unwrap();

    if current.iter().any(|s| s.eq_ignore_ascii_case(&clean)) {
        return Err("This shortcut is already added.".to_string());
    }

    if current.len() >= 5 {
        return Err("Maximum of 5 shortcuts reached.".to_string());
    }

    // Register new shortcut with OS
    app.global_shortcut()
        .register(parsed)
        .map_err(|e| format!("Failed to register '{}' (it may be reserved by Windows or another app): {}", clean, e))?;

    current.push(clean);
    save_saved_shortcuts(&app, &current);

    Ok(current.clone())
}

#[tauri::command]
fn remove_shortcut(app: AppHandle, state: State<'_, AppState>, shortcut_to_remove: String) -> Result<Vec<String>, String> {
    let clean = shortcut_to_remove.trim();
    let mut current = state.current_shortcuts.lock().unwrap();

    if current.len() <= 1 {
        return Err("You must keep at least one active shortcut.".to_string());
    }

    if let Some(pos) = current.iter().position(|s| s.eq_ignore_ascii_case(clean)) {
        let removed = current.remove(pos);
        if let Ok(parsed) = removed.parse::<Shortcut>() {
            let _ = app.global_shortcut().unregister(parsed);
        }
        save_saved_shortcuts(&app, &current);
    }

    Ok(current.clone())
}

#[tauri::command]
fn reset_shortcuts(app: AppHandle, state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let mut current = state.current_shortcuts.lock().unwrap();

    // Unregister all
    for sc in current.iter() {
        if let Ok(parsed) = sc.parse::<Shortcut>() {
            let _ = app.global_shortcut().unregister(parsed);
        }
    }

    let default_list = vec!["Alt+V".to_string()];
    if let Ok(parsed) = "Alt+V".parse::<Shortcut>() {
        let _ = app.global_shortcut().register(parsed);
    }

    *current = default_list.clone();
    save_saved_shortcuts(&app, &default_list);

    Ok(default_list)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let manager = Arc::new(ClipboardManager::new());
    let current_shortcuts = Arc::new(Mutex::new(vec!["Alt+V".to_string()]));

    let manager_for_thread = Arc::clone(&manager);
    let manager_for_setup = Arc::clone(&manager);
    let current_shortcuts_for_setup = Arc::clone(&current_shortcuts);

    tauri::Builder::default()
        .manage(AppState {
            manager,
            current_shortcuts,
        })
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_window(app.clone());
                    }
                })
                .build(),
        )
        .on_window_event(|window, event| {
            // Auto-close / hide window when clicking outside (window loses focus)
            if let WindowEvent::Focused(focused) = event {
                if !focused {
                    let _ = window.hide();
                }
            }
        })
        .setup(move |app| {
            let app_handle = app.handle().clone();

            // Load saved clipboard history from disk
            manager_for_setup.init_from_disk(&app_handle);

            // Load saved shortcuts from disk and register all
            let saved_shortcuts = load_saved_shortcuts(&app_handle);
            *current_shortcuts_for_setup.lock().unwrap() = saved_shortcuts.clone();

            for sc in &saved_shortcuts {
                if let Ok(parsed) = sc.parse::<Shortcut>() {
                    let _ = app.global_shortcut().register(parsed);
                }
            }

            // Enable autostart with Windows on boot
            let _ = app.autolaunch().enable();

            // Start clipboard listener background thread
            manager_for_thread.start_monitoring(app_handle.clone());

            // Create System Tray Menu
            let show_i = MenuItem::with_id(app, "show", "Open QuickClip", true, None::<&str>)?;
            let update_i = MenuItem::with_id(app, "check_update", "Check for Updates...", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit QuickClip", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &update_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        toggle_window(app.clone());
                    }
                    "check_update" => {
                        toggle_window(app.clone());
                        let _ = app.emit("check-for-updates", ());
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        toggle_window(app.clone());
                    }
                })
                .build(app)?;

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_history,
            copy_to_system,
            paste_item,
            toggle_pin,
            delete_item,
            clear_unpinned,
            hide_window,
            toggle_window,
            get_shortcuts,
            add_shortcut,
            remove_shortcut,
            reset_shortcuts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running quickclip application");
}
