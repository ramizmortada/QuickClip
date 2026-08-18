use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PixelSample {
    pub hex: String,
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub cursor_x: i32,
    pub cursor_y: i32,
    pub grid: Vec<Vec<String>>,
}

struct DesktopSnapshot {
    offset_x: i32,
    offset_y: i32,
    width: i32,
    height: i32,
    bgra: Vec<u8>,
}

static CURRENT_SNAPSHOT: Mutex<Option<DesktopSnapshot>> = Mutex::new(None);

#[cfg(windows)]
fn capture_screen_raw() -> Option<DesktopSnapshot> {
    use windows_sys::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits,
        GetDC, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
        SRCCOPY,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
        SM_YVIRTUALSCREEN,
    };

    unsafe {
        let mut offset_x = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let mut offset_y = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let mut width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let mut height = GetSystemMetrics(SM_CYVIRTUALSCREEN);

        if width <= 0 || height <= 0 {
            offset_x = 0;
            offset_y = 0;
            width = GetSystemMetrics(0);
            height = GetSystemMetrics(1);
        }

        if width <= 0 || height <= 0 {
            width = 1920;
            height = 1080;
        }

        let hdc_screen = GetDC(std::ptr::null_mut());
        if hdc_screen.is_null() {
            return None;
        }

        let hdc_mem = CreateCompatibleDC(hdc_screen);
        if hdc_mem.is_null() {
            ReleaseDC(std::ptr::null_mut(), hdc_screen);
            return None;
        }

        let hbitmap = CreateCompatibleBitmap(hdc_screen, width, height);
        if hbitmap.is_null() {
            DeleteDC(hdc_mem);
            ReleaseDC(std::ptr::null_mut(), hdc_screen);
            return None;
        }

        let old_obj = SelectObject(hdc_mem, hbitmap);

        BitBlt(
            hdc_mem,
            0,
            0,
            width,
            height,
            hdc_screen,
            offset_x,
            offset_y,
            SRCCOPY,
        );

        let mut bmi: BITMAPINFO = std::mem::zeroed();
        bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = width;
        bmi.bmiHeader.biHeight = -height; // Top-down DIB
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB as u32;

        let buf_size = (width * height * 4) as usize;
        let mut bgra = vec![0u8; buf_size];

        GetDIBits(
            hdc_mem,
            hbitmap,
            0,
            height as u32,
            bgra.as_mut_ptr() as *mut _,
            &mut bmi,
            DIB_RGB_COLORS,
        );

        SelectObject(hdc_mem, old_obj);
        DeleteObject(hbitmap);
        DeleteDC(hdc_mem);
        ReleaseDC(std::ptr::null_mut(), hdc_screen);

        Some(DesktopSnapshot {
            offset_x,
            offset_y,
            width,
            height,
            bgra,
        })
    }
}

#[cfg(windows)]
#[tauri::command]
pub fn sample_pixel_at_cursor() -> Result<PixelSample, String> {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

    unsafe {
        let mut cursor_pt = POINT { x: 0, y: 0 };
        GetCursorPos(&mut cursor_pt);

        let snap_guard = CURRENT_SNAPSHOT.lock();
        let snap = snap_guard
            .as_ref()
            .ok_or_else(|| "No active desktop snapshot".to_string())?;

        let grid_size = 11;
        let half = grid_size / 2;

        let rel_x = cursor_pt.x - snap.offset_x;
        let rel_y = cursor_pt.y - snap.offset_y;

        let mut grid = Vec::with_capacity(grid_size as usize);
        let mut center_hex = String::from("#000000");
        let mut cr = 0u8;
        let mut cg = 0u8;
        let mut cb = 0u8;

        for dy in -half..=half {
            let mut row = Vec::with_capacity(grid_size as usize);
            for dx in -half..=half {
                let px = (rel_x + dx).clamp(0, snap.width - 1);
                let py = (rel_y + dy).clamp(0, snap.height - 1);

                let idx = ((py * snap.width + px) * 4) as usize;
                if idx + 2 < snap.bgra.len() {
                    let b = snap.bgra[idx];
                    let g = snap.bgra[idx + 1];
                    let r = snap.bgra[idx + 2];
                    let hex = format!("#{:02X}{:02X}{:02X}", r, g, b);

                    if dy == 0 && dx == 0 {
                        center_hex = hex.clone();
                        cr = r;
                        cg = g;
                        cb = b;
                    }
                    row.push(hex);
                } else {
                    row.push("#000000".to_string());
                }
            }
            grid.push(row);
        }

        Ok(PixelSample {
            hex: center_hex,
            r: cr,
            g: cg,
            b: cb,
            cursor_x: cursor_pt.x,
            cursor_y: cursor_pt.y,
            grid,
        })
    }
}

#[cfg(not(windows))]
#[tauri::command]
pub fn sample_pixel_at_cursor() -> Result<PixelSample, String> {
    Err("Not supported on non-Windows platforms".to_string())
}

#[tauri::command]
pub fn start_color_picker(app: AppHandle) -> Result<(), String> {
    // 1. Capture clean desktop snapshot BEFORE showing the overlay window
    #[cfg(windows)]
    let (cur_x, cur_y) = {
        use windows_sys::Win32::Foundation::POINT;
        use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
        unsafe {
            let mut pt = POINT { x: 0, y: 0 };
            GetCursorPos(&mut pt);
            (pt.x, pt.y)
        }
    };
    #[cfg(not(windows))]
    let (cur_x, cur_y) = (0, 0);

    #[cfg(windows)]
    {
        if let Some(snapshot) = capture_screen_raw() {
            let mut guard = CURRENT_SNAPSHOT.lock();
            *guard = Some(snapshot);
        }
    }

    // 2. Reposition, emit cursor position, and show overlay window
    if let Some(window) = app.get_webview_window("picker") {
        #[cfg(windows)]
        {
            let guard = CURRENT_SNAPSHOT.lock();
            if let Some(snap) = guard.as_ref() {
                let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                    x: snap.offset_x,
                    y: snap.offset_y,
                }));
                let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                    width: snap.width as u32,
                    height: snap.height as u32,
                }));
            }
        }

        let _ = window.emit(
            "color-picker-opened",
            serde_json::json!({
                "cursor_x": cur_x,
                "cursor_y": cur_y,
            }),
        );
        let _ = window.show();
        let _ = window.set_focus();
    }

    Ok(())
}

#[tauri::command]
pub fn toggle_color_picker(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("picker") {
        if window.is_visible().unwrap_or(false) {
            return cancel_color_picker(app);
        }
    }
    start_color_picker(app)
}

#[tauri::command]
pub fn finish_color_picker(app: AppHandle, state: tauri::State<'_, crate::AppState>, hex: Option<String>) -> Result<(), String> {
    let chosen_hex = if let Some(h) = hex.filter(|s| !s.trim().is_empty()) {
        h.trim().to_uppercase()
    } else if let Ok(sample) = sample_pixel_at_cursor() {
        sample.hex
    } else {
        "#000000".to_string()
    };

    // 1. Copy hex to system clipboard
    if let Ok(mut clipboard) = arboard::Clipboard::new() {
        let _ = clipboard.set_text(chosen_hex.clone());
    }

    // 2. Insert into ClipboardManager history and emit live update
    state.manager.add_text_item(&chosen_hex, &app);

    // 3. Clear snapshot memory
    *CURRENT_SNAPSHOT.lock() = None;

    // 4. Hide picker window
    if let Some(window) = app.get_webview_window("picker") {
        let _ = window.hide();
    }

    Ok(())
}

#[tauri::command]
pub fn cancel_color_picker(app: AppHandle) -> Result<(), String> {
    // Clear snapshot memory
    *CURRENT_SNAPSHOT.lock() = None;

    if let Some(window) = app.get_webview_window("picker") {
        let _ = window.hide();
    }
    Ok(())
}
