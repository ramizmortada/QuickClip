use std::fs;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use arboard::{Clipboard, ImageData};
use base64::Engine;
use chrono::Local;
use image::codecs::png::PngEncoder;
use image::{ColorType, ImageEncoder};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardItem {
    pub id: String,
    pub content_type: String, // "text" | "code" | "link" | "image"
    pub text_content: Option<String>,
    pub image_data_url: Option<String>,
    pub image_width: Option<u32>,
    pub image_height: Option<u32>,
    pub image_size_bytes: Option<usize>,
    pub hash: String,
    pub copied_at: String,
    pub is_pinned: bool,
    pub char_count: Option<usize>,
    pub language: Option<String>,
}

pub struct ClipboardManager {
    pub items: Arc<Mutex<Vec<ClipboardItem>>>,
    pub last_hash: Arc<Mutex<Option<String>>>,
}

fn get_storage_path(app_handle: &AppHandle) -> Option<PathBuf> {
    if let Ok(app_dir) = app_handle.path().app_data_dir() {
        let _ = fs::create_dir_all(&app_dir);
        return Some(app_dir.join("clipboard_history.json"));
    }
    None
}

fn load_persisted_items(app_handle: &AppHandle) -> Vec<ClipboardItem> {
    if let Some(path) = get_storage_path(app_handle) {
        if path.exists() {
            if let Ok(content) = fs::read_to_string(path) {
                if let Ok(items) = serde_json::from_str::<Vec<ClipboardItem>>(&content) {
                    return items;
                }
            }
        }
    }
    Vec::new()
}

fn save_persisted_items(app_handle: &AppHandle, items: &[ClipboardItem]) {
    if let Some(path) = get_storage_path(app_handle) {
        if let Ok(json) = serde_json::to_string(items) {
            let _ = fs::write(path, json);
        }
    }
}

impl ClipboardManager {
    pub fn new() -> Self {
        Self {
            items: Arc::new(Mutex::new(Vec::new())),
            last_hash: Arc::new(Mutex::new(None)),
        }
    }

    pub fn init_from_disk(&self, app_handle: &AppHandle) {
        let loaded = load_persisted_items(app_handle);
        if !loaded.is_empty() {
            *self.items.lock() = loaded;
        }
    }

    pub fn get_items(&self) -> Vec<ClipboardItem> {
        self.items.lock().clone()
    }

    pub fn toggle_pin(&self, id: &str, app_handle: &AppHandle) -> Vec<ClipboardItem> {
        let mut items = self.items.lock();
        if let Some(item) = items.iter_mut().find(|i| i.id == id) {
            item.is_pinned = !item.is_pinned;
        }
        let list = items.clone();
        save_persisted_items(app_handle, &list);
        let _ = app_handle.emit("clipboard-updated", list.clone());
        list
    }

    pub fn delete_item(&self, id: &str, app_handle: &AppHandle) -> Vec<ClipboardItem> {
        let mut items = self.items.lock();
        items.retain(|i| i.id != id);
        let list = items.clone();
        save_persisted_items(app_handle, &list);
        let _ = app_handle.emit("clipboard-updated", list.clone());
        list
    }

    pub fn clear_unpinned(&self, app_handle: &AppHandle) -> Vec<ClipboardItem> {
        let mut items = self.items.lock();
        items.retain(|i| i.is_pinned);
        let list = items.clone();
        save_persisted_items(app_handle, &list);
        let _ = app_handle.emit("clipboard-updated", list.clone());
        list
    }

    pub fn copy_and_bump_to_top(&self, id: &str, app_handle: &AppHandle) -> Result<(), String> {
        let item_to_write = {
            let mut items = self.items.lock();
            if let Some(pos) = items.iter().position(|i| i.id == id) {
                let mut item = items.remove(pos);
                item.copied_at = Local::now().format("%l:%M %p").to_string().trim().to_string();
                items.insert(0, item.clone());
                save_persisted_items(app_handle, &items);
                let _ = app_handle.emit("clipboard-updated", items.clone());
                Some(item)
            } else {
                None
            }
        };

        if let Some(item) = item_to_write {
            let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;

            if item.content_type == "image" {
                if let Some(data_url) = &item.image_data_url {
                    let base64_str = data_url.trim_start_matches("data:image/png;base64,");
                    let png_bytes = base64::engine::general_purpose::STANDARD
                        .decode(base64_str)
                        .map_err(|e| e.to_string())?;

                    let img = image::load_from_memory(&png_bytes).map_err(|e| e.to_string())?;
                    let rgba = img.to_rgba8();
                    let (width, height) = (rgba.width() as usize, rgba.height() as usize);

                    let img_data = ImageData {
                        width,
                        height,
                        bytes: std::borrow::Cow::Owned(rgba.into_raw()),
                    };

                    *self.last_hash.lock() = Some(item.hash.clone());
                    clipboard.set_image(img_data).map_err(|e| e.to_string())?;
                }
            } else if let Some(text) = &item.text_content {
                *self.last_hash.lock() = Some(item.hash.clone());
                clipboard.set_text(text.clone()).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    pub fn add_text_item(&self, text: &str, app_handle: &AppHandle) {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return;
        }

        let mut hasher = Sha256::new();
        hasher.update(text.as_bytes());
        let hash = format!("{:x}", hasher.finalize());

        *self.last_hash.lock() = Some(hash.clone());

        let now = Local::now().format("%l:%M %p").to_string().trim().to_string();
        let char_count = text.chars().count();
        let content_type = detect_content_type(text);
        let language = detect_code_language(text);

        let mut items = self.items.lock();

        if let Some(pos) = items.iter().position(|i| i.hash == hash) {
            let mut existing = items.remove(pos);
            existing.copied_at = now;
            items.insert(0, existing);
        } else {
            let new_item = ClipboardItem {
                id: format!("txt_{}_{}", chrono::Utc::now().timestamp_millis(), &hash[..8]),
                content_type,
                text_content: Some(text.to_string()),
                image_data_url: None,
                image_width: None,
                image_height: None,
                image_size_bytes: None,
                hash: hash.clone(),
                copied_at: now,
                is_pinned: false,
                char_count: Some(char_count),
                language,
            };
            items.insert(0, new_item);

            if items.len() > 150 {
                if let Some(last_unpinned) = items.iter().rposition(|i| !i.is_pinned) {
                    items.remove(last_unpinned);
                }
            }
        }

        save_persisted_items(app_handle, &items);
        let _ = app_handle.emit("clipboard-updated", items.clone());
    }

    pub fn start_monitoring(&self, app_handle: AppHandle) {
        let items_arc = Arc::clone(&self.items);
        let last_hash_arc = Arc::clone(&self.last_hash);
        let app_handle_for_save = app_handle.clone();

        std::thread::spawn(move || {
            let mut clipboard = match Clipboard::new() {
                Ok(cb) => cb,
                Err(e) => {
                    log::error!("Failed to initialize clipboard listener: {}", e);
                    return;
                }
            };

            loop {
                std::thread::sleep(Duration::from_millis(300));

                // 1. Try reading Image first (for screenshots & copied graphics)
                if let Ok(img_data) = clipboard.get_image() {
                    let mut hasher = Sha256::new();
                    hasher.update(&img_data.bytes);
                    let hash = format!("{:x}", hasher.finalize());

                    let is_new = {
                        let current = last_hash_arc.lock();
                        current.as_deref() != Some(&hash)
                    };

                    if is_new {
                        *last_hash_arc.lock() = Some(hash.clone());

                        let width = img_data.width as u32;
                        let height = img_data.height as u32;
                        let mut png_bytes = Vec::new();
                        let encoder = PngEncoder::new(Cursor::new(&mut png_bytes));
                        if encoder
                            .write_image(&img_data.bytes, width, height, ColorType::Rgba8.into())
                            .is_ok()
                        {
                            let base64_str =
                                base64::engine::general_purpose::STANDARD.encode(&png_bytes);
                            let data_url = format!("data:image/png;base64,{}", base64_str);
                            let now = Local::now().format("%l:%M %p").to_string().trim().to_string();

                            let mut items = items_arc.lock();

                            // Deduplication: Check if image with same hash exists -> bump to top
                            if let Some(pos) = items.iter().position(|i| i.hash == hash) {
                                let mut existing = items.remove(pos);
                                existing.copied_at = now;
                                items.insert(0, existing);
                            } else {
                                let new_item = ClipboardItem {
                                    id: format!("img_{}_{}", chrono::Utc::now().timestamp_millis(), &hash[..8]),
                                    content_type: "image".to_string(),
                                    text_content: None,
                                    image_data_url: Some(data_url),
                                    image_width: Some(width),
                                    image_height: Some(height),
                                    image_size_bytes: Some(png_bytes.len()),
                                    hash: hash.clone(),
                                    copied_at: now,
                                    is_pinned: false,
                                    char_count: None,
                                    language: None,
                                };
                                items.insert(0, new_item);

                                if items.len() > 150 {
                                    if let Some(last_unpinned) =
                                        items.iter().rposition(|i| !i.is_pinned)
                                    {
                                        items.remove(last_unpinned);
                                    }
                                }
                            }

                            save_persisted_items(&app_handle_for_save, &items);
                            let _ = app_handle.emit("clipboard-updated", items.clone());
                        }
                    }
                    continue;
                }

                // 2. Try reading Text
                if let Ok(text) = clipboard.get_text() {
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
                        let mut hasher = Sha256::new();
                        hasher.update(text.as_bytes());
                        let hash = format!("{:x}", hasher.finalize());

                        let is_new = {
                            let current = last_hash_arc.lock();
                            current.as_deref() != Some(&hash)
                        };

                        if is_new {
                            *last_hash_arc.lock() = Some(hash.clone());

                            let now = Local::now().format("%l:%M %p").to_string().trim().to_string();
                            let char_count = text.chars().count();
                            let content_type = detect_content_type(&text);
                            let language = detect_code_language(&text);

                            let mut items = items_arc.lock();

                            // Deduplication: Check if text with same hash exists -> bump to top
                            if let Some(pos) = items.iter().position(|i| i.hash == hash) {
                                let mut existing = items.remove(pos);
                                existing.copied_at = now;
                                items.insert(0, existing);
                            } else {
                                let new_item = ClipboardItem {
                                    id: format!("txt_{}_{}", chrono::Utc::now().timestamp_millis(), &hash[..8]),
                                    content_type,
                                    text_content: Some(text),
                                    image_data_url: None,
                                    image_width: None,
                                    image_height: None,
                                    image_size_bytes: None,
                                    hash: hash.clone(),
                                    copied_at: now,
                                    is_pinned: false,
                                    char_count: Some(char_count),
                                    language,
                                };
                                items.insert(0, new_item);

                                if items.len() > 150 {
                                    if let Some(last_unpinned) =
                                        items.iter().rposition(|i| !i.is_pinned)
                                    {
                                        items.remove(last_unpinned);
                                    }
                                }
                            }

                            save_persisted_items(&app_handle_for_save, &items);
                            let _ = app_handle.emit("clipboard-updated", items.clone());
                        }
                    }
                }
            }
        });
    }
}

fn detect_content_type(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return "link".to_string();
    }
    if trimmed.contains('{') && trimmed.contains('}')
        || trimmed.contains("const ")
        || trimmed.contains("function ")
        || trimmed.contains("import ")
        || trimmed.contains("fn ")
        || trimmed.contains("let ")
        || trimmed.contains("public class")
        || trimmed.contains("def ")
        || trimmed.contains("SELECT ")
        || trimmed.lines().count() > 3
    {
        return "code".to_string();
    }
    "text".to_string()
}

fn detect_code_language(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return None;
    }
    if trimmed.contains("fn ") || trimmed.contains("impl ") || trimmed.contains("pub struct") {
        return Some("rust".to_string());
    }
    if trimmed.contains("const ") || trimmed.contains("=>") || trimmed.contains("export default") {
        return Some("typescript".to_string());
    }
    if trimmed.contains("def ") || trimmed.contains("import numpy") || trimmed.contains("__main__") {
        return Some("python".to_string());
    }
    if trimmed.starts_with('{') && trimmed.ends_with('}') && trimmed.contains(':') {
        return Some("json".to_string());
    }
    if trimmed.contains("SELECT ") || trimmed.contains("FROM ") || trimmed.contains("WHERE ") {
        return Some("sql".to_string());
    }
    if trimmed.contains("npm ") || trimmed.contains("cargo ") || trimmed.contains("git ") {
        return Some("bash".to_string());
    }
    None
}
