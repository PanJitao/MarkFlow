use serde::{Deserialize, Serialize};
use std::{fs::{self, File, OpenOptions}, io::Write, path::PathBuf, sync::{Mutex, atomic::{AtomicBool, AtomicU64, Ordering}}, time::{Duration, SystemTime, UNIX_EPOCH}};
use tauri::{Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static QUITTING: AtomicBool = AtomicBool::new(false);
fn now_ms() -> i64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as i64 }
fn id(prefix: &str) -> String { format!("{prefix}-{}-{}", now_ms(), NEXT_ID.fetch_add(1, Ordering::Relaxed)) }

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note { pub id: String, pub text: String, pub color: String }

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Todo {
    pub id: String, pub title: String, pub due_at: Option<i64>, pub remind_before: Vec<i64>, pub done: bool,
    #[serde(default)] pub fired: Vec<i64>,
    #[serde(default)] pub snooze_until: Option<i64>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Alert { pub id: String, pub todo_id: String, pub title: String, pub due_at: i64, pub trigger_at: i64 }

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DesktopData {
    pub revision: u64,
    pub enabled: bool, pub notes: Vec<Note>, pub todos: Vec<Todo>, pub alerts: Vec<Alert>,
    pub pet_hidden: bool,
    pub pet_position: Option<(i32, i32)>,
}

pub struct DesktopStore {
    path: PathBuf,
    data: Mutex<Result<DesktopData, String>>,
    // OS lock is released on exit/crash; a second process must not send duplicate reminders.
    _lock: Option<File>,
}

impl DesktopStore {
    pub fn open(directory: PathBuf) -> Self {
        let path = directory.join("desktop-notes.json");
        let mut lock = None;
        let data = (|| -> Result<DesktopData, String> {
            fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
            let file = OpenOptions::new().create(true).truncate(false).read(true).write(true).open(directory.join("desktop-notes.lock")).map_err(|e| e.to_string())?;
            file.try_lock().map_err(|_| "桌面便签已在另一个 MarkFlow 进程中运行，请从原宠物或托盘打开".to_string())?;
            lock = Some(file);
            if !path.exists() { return Ok(DesktopData::default()); }
            let bytes = fs::read(&path).map_err(|e| e.to_string())?;
            serde_json::from_slice(&bytes).map_err(|_| "便签数据无法读取，原文件已保留，请先备份 desktop-notes.json".to_string())
        })();
        Self { path, data: Mutex::new(data), _lock: lock }
    }

    fn get(&self) -> Result<DesktopData, String> { self.data.lock().map_err(|_| "便签存储不可用")?.clone() }

    fn update(&self, edit: impl FnOnce(&mut DesktopData) -> Result<(), String>) -> Result<DesktopData, String> {
        let mut guard = self.data.lock().map_err(|_| "便签存储不可用")?;
        let mut next = guard.as_ref().map_err(Clone::clone)?.clone();
        edit(&mut next)?;
        next.revision = next.revision.saturating_add(1);
        let bytes = serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?;
        let temporary = self.path.with_extension("tmp");
        let mut file = File::create(&temporary).map_err(|e| format!("便签保存失败：{e}"))?;
        file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&temporary, &self.path).map_err(|e| e.to_string())?;
        *guard = Ok(next.clone());
        Ok(next)
    }
}

fn publish(app: &tauri::AppHandle, data: &DesktopData) {
    let _ = app.emit("desktop-data", data);
}

#[tauri::command]
pub fn desktop_get(app: tauri::AppHandle) -> Result<DesktopData, String> { app.state::<DesktopStore>().get() }

#[tauri::command]
pub fn desktop_save_note(app: tauri::AppHandle, note_id: Option<String>, text: String, color: String) -> Result<DesktopData, String> {
    if text.chars().count() > 20000 || !["cream", "mint", "rose", "lavender"].contains(&color.as_str()) { return Err("便签内容过长或颜色无效".into()); }
    let data = app.state::<DesktopStore>().update(|data| {
        if let Some(id) = note_id {
            let note = data.notes.iter_mut().find(|n| n.id == id).ok_or("便签已被删除")?;
            note.text = text; note.color = color;
        } else {
            if data.notes.len() >= 500 { return Err("便签已达到 500 条，请先整理".into()); }
            data.notes.push(Note { id: id("note"), text, color });
        }
        Ok(())
    })?;
    publish(&app, &data); Ok(data)
}

#[tauri::command]
pub fn desktop_delete_note(app: tauri::AppHandle, id: String) -> Result<DesktopData, String> {
    let data = app.state::<DesktopStore>().update(|data| { data.notes.retain(|n| n.id != id); Ok(()) })?;
    publish(&app, &data); Ok(data)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoInput { id: Option<String>, title: String, due_at: Option<i64>, remind_before: Vec<i64> }

fn save_todo(data: &mut DesktopData, mut input: TodoInput) -> Result<(), String> {
    input.title = input.title.trim().to_string();
    if input.title.is_empty() || input.title.chars().count() > 300 { return Err("待办标题需为 1–300 字".into()); }
    if input.remind_before.len() > 8 || input.remind_before.iter().any(|m| !(0..=10080).contains(m)) { return Err("提前提醒需为 0–10080 分钟，最多 8 个时间点".into()); }
    if input.due_at.is_none() && !input.remind_before.is_empty() { return Err("请先设置待办时间，再添加提醒".into()); }
    if input.due_at.is_some_and(|time| !(1..=253402300799000).contains(&time)) { return Err("待办时间无效".into()); }
    input.remind_before.sort_unstable(); input.remind_before.dedup();
    if let Some(id) = input.id {
        let todo = data.todos.iter_mut().find(|t| t.id == id).ok_or("待办已被删除")?;
        if todo.due_at != input.due_at || todo.remind_before != input.remind_before {
            todo.fired.clear(); todo.snooze_until = None; data.alerts.retain(|a| a.todo_id != id);
        }
        todo.title = input.title; todo.due_at = input.due_at; todo.remind_before = input.remind_before;
        for alert in data.alerts.iter_mut().filter(|a| a.todo_id == id) { alert.title.clone_from(&todo.title); }
    } else {
        if data.todos.len() >= 2000 { return Err("待办已达到 2000 条，请先整理".into()); }
        data.todos.push(Todo { id: id("todo"), title: input.title, due_at: input.due_at, remind_before: input.remind_before, done: false, fired: vec![], snooze_until: None });
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_save_todo(app: tauri::AppHandle, input: TodoInput) -> Result<DesktopData, String> {
    let data = app.state::<DesktopStore>().update(|data| save_todo(data, input))?;
    publish(&app, &data); Ok(data)
}

#[tauri::command]
pub fn desktop_delete_todo(app: tauri::AppHandle, id: String) -> Result<DesktopData, String> {
    let data = app.state::<DesktopStore>().update(|data| { data.todos.retain(|t| t.id != id); data.alerts.retain(|a| a.todo_id != id); Ok(()) })?;
    publish(&app, &data); Ok(data)
}

fn set_done(data: &mut DesktopData, id: &str, done: bool) -> Result<(), String> {
    let todo = data.todos.iter_mut().find(|t| t.id == id).ok_or("待办已被删除")?;
    if todo.done && !done { todo.fired.clear(); }
    todo.done = done; todo.snooze_until = None;
    data.alerts.retain(|a| a.todo_id != id); Ok(())
}

#[tauri::command]
pub fn desktop_set_done(app: tauri::AppHandle, id: String, done: bool) -> Result<DesktopData, String> {
    let data = app.state::<DesktopStore>().update(|data| set_done(data, &id, done))?;
    publish(&app, &data); Ok(data)
}

fn resolve_alert(data: &mut DesktopData, id: &str, action: &str, now: i64) -> Result<(), String> {
    let Some(alert) = data.alerts.iter().find(|a| a.id == id).cloned() else { return Ok(()); };
    match action {
        "done" => { set_done(data, &alert.todo_id, true)?; }
        "snooze" => {
            if let Some(todo) = data.todos.iter_mut().find(|t| t.id == alert.todo_id) { todo.snooze_until = Some(now + 10 * 60000); }
            data.alerts.retain(|a| a.todo_id != alert.todo_id);
        }
        "dismiss" => data.alerts.retain(|a| a.id != id),
        _ => return Err("无效的提醒操作".into()),
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_resolve_alert(app: tauri::AppHandle, id: String, action: String) -> Result<DesktopData, String> {
    let data = app.state::<DesktopStore>().update(|data| resolve_alert(data, &id, &action, now_ms()))?;
    publish(&app, &data); Ok(data)
}

// Absolute timestamps catch up after sleep/restart. Multiple missed thresholds
// become one current bubble, and acknowledged thresholds never fire twice.
fn collect_due(data: &mut DesktopData, now: i64) -> bool {
    if !data.enabled { return false; }
    let mut changed = false;
    for todo in data.todos.iter_mut().filter(|t| !t.done) {
        let Some(due) = todo.due_at else { continue; };
        if todo.snooze_until.is_some_and(|time| time > now) { continue; }
        let mut missed: Vec<_> = todo.remind_before.iter().copied().filter(|m| due - m * 60000 <= now && !todo.fired.contains(m)).collect();
        missed.sort_unstable();
        if missed.is_empty() && todo.snooze_until.is_none() { continue; }
        let trigger = todo.snooze_until.unwrap_or_else(|| due - missed[0] * 60000);
        todo.fired.extend(missed); todo.snooze_until = None;
        data.alerts.retain(|a| a.todo_id != todo.id);
        data.alerts.push(Alert { id: format!("{}:{trigger}", todo.id), todo_id: todo.id.clone(), title: todo.title.clone(), due_at: due, trigger_at: trigger });
        changed = true;
    }
    data.alerts.sort_by_key(|a| a.trigger_at);
    changed
}

pub(crate) fn position_pet(window: &tauri::WebviewWindow, saved: Option<(i32, i32)>) -> Result<(), String> {
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    let monitor = saved.and_then(|(x, y)| monitors.iter().find(|m| {
        let r = m.work_area(); x >= r.position.x && y >= r.position.y && x < r.position.x + r.size.width as i32 && y < r.position.y + r.size.height as i32
    })).or(monitors.first()).ok_or("未发现显示器")?;
    let r = monitor.work_area(); let size = window.outer_size().map_err(|e| e.to_string())?;
    let max_x = (r.position.x + r.size.width as i32 - size.width as i32).max(r.position.x);
    let max_y = (r.position.y + r.size.height as i32 - size.height as i32).max(r.position.y);
    let (x, y) = saved.unwrap_or((max_x - 20, max_y - 16));
    window.set_position(PhysicalPosition::new(x.clamp(r.position.x, max_x), y.clamp(r.position.y, max_y))).map_err(|e| e.to_string())
}

pub fn show_editor(app: &tauri::AppHandle) -> Result<(), String> {
    let editor = app.get_webview_window("main").or_else(|| app.webview_windows().into_iter().find(|(label, _)| label.starts_with("document-")).map(|(_, w)| w));
    if let Some(window) = editor { let _ = window.unminimize(); window.show().and_then(|_| window.set_focus()).map_err(|e| e.to_string()) }
    else { super::create_document_window(app, None) }
}

fn quit(app: &tauri::AppHandle) {
    QUITTING.store(true, Ordering::Relaxed);
    app.remove_tray_by_id("desktop-notes-tray");
    if app.webview_windows().is_empty() { app.exit(0); return; }
    // Editors and notes receive CloseRequested and finish their saves first.
    for (label, window) in app.webview_windows() {
        if label == "desktop-pet" { let _ = window.destroy(); } else { let _ = window.close(); }
    }
}

fn ensure_tray(app: &tauri::AppHandle) -> Result<(), String> {
    if app.tray_by_id("desktop-notes-tray").is_some() { return Ok(()); }
    use tauri::{menu::{Menu, MenuItem}, tray::TrayIconBuilder};
    let pet = MenuItem::with_id(app, "pet", "显示宠物", true, None::<&str>).map_err(|e| e.to_string())?;
    let hide = MenuItem::with_id(app, "hide-pet", "关闭宠物", true, None::<&str>).map_err(|e| e.to_string())?;
    let notes = MenuItem::with_id(app, "notes", "便签与待办", true, None::<&str>).map_err(|e| e.to_string())?;
    let editor = MenuItem::with_id(app, "editor", "返回编辑器", true, None::<&str>).map_err(|e| e.to_string())?;
    let exit = MenuItem::with_id(app, "exit", "退出软件", true, None::<&str>).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(app, &[&pet, &hide, &notes, &editor, &exit]).map_err(|e| e.to_string())?;
    let mut builder = TrayIconBuilder::with_id("desktop-notes-tray").tooltip("MarkFlow 桌面便签").menu(&menu).on_menu_event(|app, event| {
        let app = app.clone();
        // WebView2 window creation must run outside the synchronous UI event handler.
        std::thread::spawn(move || {
            let result = match event.id.as_ref() { "pet" => enable_pet(&app), "hide-pet" => hide_pet(&app), "notes" => show_notes(&app), "editor" => show_editor(&app), "exit" => { quit(&app); Ok(()) }, _ => Ok(()) };
            if let Err(error) = result { eprintln!("{error}"); }
        });
    });
    if let Some(icon) = app.default_window_icon() { builder = builder.icon(icon.clone()); }
    builder.build(app).map_err(|e| e.to_string())?; Ok(())
}

fn show_pet(app: &tauri::AppHandle) -> Result<(), String> {
    if app.state::<DesktopStore>().get()?.pet_hidden { return Ok(()); }
    ensure_tray(app)?;
    if let Some(window) = app.get_webview_window("desktop-pet") { let _ = window.unminimize(); return window.show().map_err(|e| e.to_string()); }
    let window = WebviewWindowBuilder::new(app, "desktop-pet", WebviewUrl::App("pet.html".into()))
        .title("MarkFlow 桌面宠物").inner_size(420.0, 450.0).resizable(false).decorations(false)
        .transparent(true).shadow(false).always_on_top(true).skip_taskbar(true).focused(false).visible(false)
        .build().map_err(|e| e.to_string())?;
    position_pet(&window, app.state::<DesktopStore>().get()?.pet_position)?;
    if app.state::<DesktopStore>().get()?.pet_hidden { let _ = window.destroy(); return Ok(()); }
    let pet_app = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let app = pet_app.clone();
            std::thread::spawn(move || { if let Err(error) = hide_pet(&app) { eprintln!("{error}"); } });
        }
    });
    window.show().map_err(|e| e.to_string())
}

fn show_notes(app: &tauri::AppHandle) -> Result<(), String> {
    ensure_tray(app)?;
    if !app.state::<DesktopStore>().get()?.enabled {
        let data = app.state::<DesktopStore>().update(|data| { data.enabled = true; data.pet_hidden = true; Ok(()) })?;
        publish(app, &data);
    }
    if let Some(window) = app.get_webview_window("desktop-notes") { let _ = window.unminimize(); return window.show().and_then(|_| window.set_focus()).map_err(|e| e.to_string()); }
    WebviewWindowBuilder::new(app, "desktop-notes", WebviewUrl::App("notes.html".into()))
        .title("MarkFlow 便签与待办").inner_size(420.0, 620.0).min_inner_size(360.0, 440.0)
        .decorations(false).always_on_top(true).center().build().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn desktop_action(app: tauri::AppHandle, window: tauri::WebviewWindow, action: String) -> Result<(), String> {
    match action.as_str() {
        "pet-settings" => crate::pets::open_settings(&app),
        "pet" => enable_pet(&app),
        "hide-pet" => hide_pet(&app),
        "enter" => {
            QUITTING.store(false, Ordering::Relaxed);
            show_notes(&app)?;
            if window.label() == "main" || window.label().starts_with("document-") { window.hide().map_err(|e| e.to_string())?; }
            Ok(())
        }
        "notes" => show_notes(&app),
        "editor" => show_editor(&app),
        "disable" => {
            let data = app.state::<DesktopStore>().update(|data| { data.enabled = false; Ok(()) })?;
            publish(&app, &data); show_editor(&app)?;
            if let Some(pet) = app.get_webview_window("desktop-pet") { let _ = pet.destroy(); }
            if let Some(notes) = app.get_webview_window("desktop-notes") { let _ = notes.close(); }
            app.remove_tray_by_id("desktop-notes-tray"); Ok(())
        }
        "quit" => { quit(&app); Ok(()) }
        _ => Err("无效的便签操作".into()),
    }
}

pub fn enable_pet(app: &tauri::AppHandle) -> Result<(), String> {
    QUITTING.store(false, Ordering::Relaxed);
    let data = app.state::<DesktopStore>().update(|data| { data.enabled = true; data.pet_hidden = false; Ok(()) })?;
    show_pet(app)?; publish(app, &data); Ok(())
}

fn hide_pet(app: &tauri::AppHandle) -> Result<(), String> {
    let data = app.state::<DesktopStore>().update(|data| { data.pet_hidden = true; Ok(()) })?;
    publish(app, &data);
    if let Some(window) = app.get_webview_window("desktop-pet") { window.destroy().map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
pub fn desktop_save_position(app: tauri::AppHandle, x: i32, y: i32) -> Result<(), String> {
    app.state::<DesktopStore>().update(|data| { data.pet_position = Some((x, y)); Ok(()) }).map(|_| ())
}

pub fn start(app: &tauri::AppHandle) {
    if app.state::<DesktopStore>().get().is_ok_and(|d| d.enabled) {
        if let Err(error) = ensure_tray(app).and_then(|_| show_pet(app)) { eprintln!("{error}"); }
    }
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        if QUITTING.load(Ordering::Relaxed) { continue; }
        let store = app.state::<DesktopStore>();
        let Ok(mut check) = store.get() else { continue; };
        if !collect_due(&mut check, now_ms()) { continue; }
        if store.update(|data| { collect_due(data, now_ms()); Ok(()) }).is_ok() {
            if QUITTING.load(Ordering::Relaxed) { continue; }
            if let Ok(data) = store.get() {
                if data.enabled && !data.alerts.is_empty() { let _ = show_pet(&app); }
                publish(&app, &data);
            }
        }
    });
}

pub fn keep_running(app: &tauri::AppHandle) -> bool {
    !QUITTING.load(Ordering::Relaxed) && app.state::<DesktopStore>().get().is_ok_and(|data| data.enabled)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn scheduled() -> DesktopData {
        let mut data = DesktopData { enabled: true, ..Default::default() };
        save_todo(&mut data, TodoInput { id: None, title: "开会".into(), due_at: Some(3600000), remind_before: vec![0, 15, 30] }).unwrap(); data
    }
    #[test]
    fn reminder_thresholds_do_not_repeat() {
        let mut data = scheduled();
        assert!(!collect_due(&mut data, 1799999));
        assert!(collect_due(&mut data, 1800000)); assert_eq!(data.alerts.len(), 1);
        assert!(!collect_due(&mut data, 1800001));
        let alert = data.alerts[0].id.clone(); resolve_alert(&mut data, &alert, "dismiss", 1800001).unwrap();
        assert!(!collect_due(&mut data, 2400000)); assert!(data.alerts.is_empty());
        assert!(collect_due(&mut data, 2700000));
        assert!(collect_due(&mut data, 3600000)); assert_eq!(data.alerts.len(), 1);
    }
    #[test]
    fn restart_and_sleep_collapse_missed_thresholds() {
        let mut data = scheduled(); assert!(collect_due(&mut data, 4000000));
        assert_eq!(data.alerts.len(), 1); assert_eq!(data.alerts[0].trigger_at, 3600000);
        let mut restored: DesktopData = serde_json::from_slice(&serde_json::to_vec(&data).unwrap()).unwrap();
        assert!(!collect_due(&mut restored, 5000000)); assert_eq!(restored.alerts.len(), 1);
    }
    #[test]
    fn completion_and_snooze_cancel_pending_reminders() {
        let mut data = scheduled(); collect_due(&mut data, 2700000);
        let alert = data.alerts[0].id.clone(); resolve_alert(&mut data, &alert, "snooze", 2700000).unwrap();
        assert!(!collect_due(&mut data, 3299999)); assert!(collect_due(&mut data, 3300000));
        let alert = data.alerts[0].id.clone(); resolve_alert(&mut data, &alert, "done", 3300000).unwrap();
        assert!(!collect_due(&mut data, 4000000)); assert!(data.alerts.is_empty()); assert!(data.todos[0].done);
    }
    #[test]
    fn editing_title_preserves_fired_but_rescheduling_rearms() {
        let mut data = scheduled(); collect_due(&mut data, 1800000); let id = data.todos[0].id.clone();
        save_todo(&mut data, TodoInput { id: Some(id.clone()), title: "改名".into(), due_at: Some(3600000), remind_before: vec![30, 15, 0] }).unwrap();
        assert!(!collect_due(&mut data, 1800001)); assert_eq!(data.alerts[0].title, "改名");
        save_todo(&mut data, TodoInput { id: Some(id), title: "改时间".into(), due_at: Some(7200000), remind_before: vec![15] }).unwrap();
        assert!(data.alerts.is_empty()); assert!(!collect_due(&mut data, 4000000)); assert!(collect_due(&mut data, 6300000));
    }
    #[test]
    fn validate_and_persist_without_losing_old_data() {
        let root = std::env::temp_dir().join(id("markflow-notes-test")); let store = DesktopStore::open(root.clone());
        assert!(store.update(|d| save_todo(d, TodoInput { id: None, title: "".into(), due_at: None, remind_before: vec![] })).is_err());
        let data = store.update(|d| save_todo(d, TodoInput { id: None, title: "测试".into(), due_at: None, remind_before: vec![] })).unwrap();
        assert_eq!(data.todos.len(), 1);
        assert!(DesktopStore::open(root.clone()).get().is_err());
        drop(store); let restored = DesktopStore::open(root.clone()); assert_eq!(restored.get().unwrap().todos.len(), 1);
        drop(restored); fs::write(root.join("desktop-notes.json"), "broken").unwrap();
        let broken = DesktopStore::open(root.clone()); assert!(broken.update(|d| { d.enabled = true; Ok(()) }).is_err());
        assert_eq!(fs::read_to_string(root.join("desktop-notes.json")).unwrap(), "broken");
        drop(broken); fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn legacy_pet_visibility_and_closed_pet_reminders() {
        let old: DesktopData = serde_json::from_str(r#"{"enabled":true,"notes":[],"todos":[],"alerts":[]}"#).unwrap();
        assert!(!old.pet_hidden);
        let mut data = scheduled();
        data.pet_hidden = true;
        let saved = serde_json::to_vec(&data).unwrap();
        let mut restored: DesktopData = serde_json::from_slice(&saved).unwrap();
        assert!(restored.pet_hidden);
        assert!(collect_due(&mut restored, 1800000));
        assert_eq!(restored.alerts.len(), 1);
        assert!(restored.enabled);
    }
}
