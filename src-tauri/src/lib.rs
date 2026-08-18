mod clipboard;

use std::sync::Arc;
use clipboard::{ClipboardItem, ClipboardManager};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

struct AppState {
    manager: Arc<ClipboardManager>,
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let manager = Arc::new(ClipboardManager::new());
    let manager_for_thread = Arc::clone(&manager);
    let manager_for_setup = Arc::clone(&manager);

    tauri::Builder::default()
        .manage(AppState { manager })
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let shortcut_str = shortcut.to_string();
                        if shortcut_str.contains("v") || shortcut_str.contains("V") {
                            toggle_window(app.clone());
                        }
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

            // Enable autostart with Windows on boot
            let _ = app.autolaunch().enable();

            // Start clipboard listener background thread
            manager_for_thread.start_monitoring(app_handle.clone());

            // Register global hotkey: Alt+V
            if let Ok(alt_shortcut) = "Alt+V".parse::<Shortcut>() {
                let _ = app.global_shortcut().register(alt_shortcut);
            }

            // Create System Tray Menu
            let quit_i = MenuItem::with_id(app, "quit", "Quit QuickClip", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Open QuickClip (Alt+V)", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        toggle_window(app.clone());
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running quickclip application");
}
