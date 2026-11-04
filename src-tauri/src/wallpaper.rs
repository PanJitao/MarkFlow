use serde::Serialize;
use serde_json::Value;
use std::{collections::HashSet, fs, path::{Path, PathBuf}};
use tauri::Manager;

const MAX_ITEMS: usize = 2000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Wallpaper {
    name: String,
    path: String,
    kind: String,
    preview: Option<String>,
    project_path: Option<String>,
    available: bool,
    reason: Option<String>,
}

#[derive(Default, Serialize)]
pub struct Library {
    items: Vec<Wallpaper>,
    roots: Vec<String>,
    unsupported: usize,
    invalid: usize,
    truncated: bool,
}

fn media_kind(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "avif" => Some("image"),
        "mp4" | "webm" | "m4v" => Some("video"),
        _ => None,
    }
}

fn read_small(path: &Path) -> Result<String, String> {
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > 1024 * 1024 {
        return Err("项目配置超过 1 MB".into());
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}

// Project paths are untrusted. Canonical containment also rejects symlinks out
// of the project; only explicitly selected media are exposed to the webview.
pub(super) fn project_path(root: &Path, relative: &str) -> Option<PathBuf> {
    let path = root.join(relative.replace('\\', "/")).canonicalize().ok()?;
    path.starts_with(root).then_some(path)
}

fn add_media(library: &mut Library, path: PathBuf, name: String, preview: Option<PathBuf>) {
    if library.items.len() >= MAX_ITEMS { library.truncated = true; return; }
    let Some(kind) = media_kind(&path) else { library.unsupported += 1; return; };
    if !path.is_file() { library.invalid += 1; return; }
    let key = path.to_string_lossy().to_string();
    if library.items.iter().any(|item| item.path == key) { return; }
    let preview = preview.filter(|p| p.is_file() && media_kind(p) == Some("image"))
        .or_else(|| (kind == "image").then(|| path.clone()));
    library.items.push(Wallpaper { name, path: key, kind: kind.into(),
        preview: preview.map(|p| p.to_string_lossy().to_string()), project_path: None, available: true, reason: None });
}

fn picture_files(root: &Path, directory: &Path, depth: usize, title: &str, library: &mut Library) {
    let Ok(entries) = fs::read_dir(directory) else { library.invalid += 1; return; };
    for entry in entries.flatten() {
        if library.items.len() >= MAX_ITEMS { library.truncated = true; break; }
        let Ok(path) = entry.path().canonicalize() else { continue; };
        if !path.starts_with(root) || entry.file_name().to_string_lossy().starts_with('.') { continue; }
        if path.is_dir() && depth < 3 { picture_files(root, &path, depth + 1, title, library); }
        else if path.is_file() && media_kind(&path) == Some("image") {
            add_media(library, path, format!("{title} / {}", entry.file_name().to_string_lossy()), None);
        }
    }
}

fn read_project(root: &Path, library: &mut Library) {
    let result = read_small(&root.join("project.json")).and_then(|text|
        serde_json::from_str::<Value>(text.trim_start_matches('\u{feff}')).map_err(|e| e.to_string()));
    let Ok(project) = result else { library.invalid += 1; return; };
    let name = project["title"].as_str().filter(|s| !s.trim().is_empty())
        .map(str::to_owned).unwrap_or_else(|| root.file_name().unwrap_or_default().to_string_lossy().to_string());
    let declared = project_kind(&project);
    if matches!(declared.as_str(), "scene" | "web" | "application" | "app" | "exe") {
        let entry = project["file"].as_str().unwrap_or(if declared == "web" { "index.html" } else { "scene.json" });
        let available = match declared.as_str() {
            "scene" => [entry, "scene.pkg", "scenes/scene.pkg", "gifscene.pkg"].iter().any(|p| project_path(root, p).is_some_and(|p| p.is_file())),
            "web" => project_path(root, entry).is_some_and(|p| p.is_file()),
            _ => false,
        };
        let reason = if available { None } else if declared == "scene" || declared == "web" {
            library.invalid += 1; Some("项目资源缺失，可能尚未下载完成".into())
        } else { library.unsupported += 1; Some("应用程序壁纸不能在编辑器中运行".into()) };
        let path = root.join("project.json").to_string_lossy().to_string();
        if library.items.iter().any(|item| item.path == path) { return; }
        let preview = project["preview"].as_str().and_then(|p| project_path(root, p))
            .filter(|p| p.is_file() && media_kind(p) == Some("image"));
        library.items.push(Wallpaper { name, path: path.clone(), kind: declared,
            preview: preview.map(|p| p.to_string_lossy().to_string()), project_path: Some(path), available, reason });
        return;
    }
    let start = library.items.len();
    if let Some(file) = project["file"].as_str().filter(|s| !s.is_empty()) {
        let Some(path) = project_path(root, file) else { library.invalid += 1; return; };
        let preview = project["preview"].as_str().and_then(|p| project_path(root, p));
        add_media(library, path, name, preview);
    } else if let Some(directory) = project["preset"]["customdirectory"].as_str().filter(|s| !s.is_empty()) {
        let Some(directory) = project_path(root, directory).filter(|p| p.is_dir()) else { library.invalid += 1; return; };
        picture_files(root, &directory, 0, &name, library);
    } else if let Some(file) = project["preset"]["image"].as_str() {
        if let Some(path) = project_path(root, file) { add_media(library, path, name, None); }
        else { library.invalid += 1; }
    } else { library.unsupported += 1; }
    for item in &mut library.items[start..] { item.project_path = Some(root.join("project.json").to_string_lossy().to_string()); }
}

#[tauri::command]
pub fn get_wallpaper_project(path: String) -> Result<Value, String> {
    let path = PathBuf::from(path).canonicalize().map_err(|_| "壁纸项目已移动或删除")?;
    if path.file_name().and_then(|s| s.to_str()) != Some("project.json") { return Err("请选择壁纸项目配置".into()); }
    let mut project: Value = serde_json::from_str(read_small(&path)?.trim_start_matches('\u{feff}')).map_err(|e| e.to_string())?;
    if !project.is_object() { return Err("壁纸项目配置必须是 JSON 对象".into()); }
    project["type"] = Value::String(project_kind(&project));
    Ok(project)
}

fn project_kind(project: &Value) -> String {
    if let Some(kind) = project["type"].as_str().filter(|s| !s.is_empty()) { return kind.to_ascii_lowercase(); }
    let file = project["file"].as_str().unwrap_or("").to_ascii_lowercase();
    if file.ends_with(".json") || file.ends_with(".pkg") { "scene".into() }
    else if file.ends_with(".html") || file.ends_with(".htm") { "web".into() }
    else if file.ends_with(".exe") { "application".into() }
    else { media_kind(Path::new(&file)).unwrap_or("").into() }
}

fn scan_directory(root: &Path, directory: &Path, depth: usize, visited: &mut HashSet<PathBuf>, library: &mut Library) {
    if !visited.insert(directory.to_path_buf()) { return; }
    if visited.len() > 10000 || library.items.len() >= MAX_ITEMS { library.truncated = true; return; }
    if directory.join("project.json").is_file() { read_project(directory, library); return; }
    let Ok(entries) = fs::read_dir(directory) else { library.invalid += 1; return; };
    for (index, entry) in entries.flatten().enumerate() {
        if index >= 10000 || library.items.len() >= MAX_ITEMS { library.truncated = true; break; }
        let Ok(path) = entry.path().canonicalize() else { continue; };
        if !path.starts_with(root) || entry.file_name().to_string_lossy().starts_with('.') { continue; }
        if path.is_dir() {
            if depth < 8 { scan_directory(root, &path, depth + 1, visited, library); }
            else { library.truncated = true; }
        } else if media_kind(&path).is_some() {
            add_media(library, path, entry.file_name().to_string_lossy().to_string(), None);
        }
    }
}

// Steam VDF strings use escaped backslashes and quotes. Parse quoted tokens,
// accepting both current "path" entries and older numeric library entries.
fn vdf_libraries(text: &str) -> Vec<PathBuf> {
    let mut tokens = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '"' { continue; }
        let mut token = String::new();
        while let Some(ch) = chars.next() {
            if ch == '"' { break; }
            if ch == '\\' && matches!(chars.peek(), Some('\\' | '"')) {
                token.push(chars.next().unwrap());
            } else { token.push(ch); }
        }
        tokens.push(token);
    }
    tokens.windows(2).filter(|pair| pair[0] == "path" || pair[0].parse::<u32>().is_ok())
        .map(|pair| PathBuf::from(&pair[1])).filter(|p| p.is_absolute()).collect()
}

fn default_steam_paths() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        if let Ok(output) = std::process::Command::new("reg")
            .args(["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"])
            .creation_flags(0x08000000).output() {
            let text = String::from_utf8_lossy(&output.stdout);
            if let Some(value) = text.lines().find_map(|line| line.split_once("REG_SZ").map(|(_, value)| value.trim())) {
                roots.push(PathBuf::from(value));
            }
        }
        for key in ["ProgramFiles(x86)", "ProgramFiles"] {
            if let Some(base) = std::env::var_os(key) { roots.push(PathBuf::from(base).join("Steam")); }
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        roots.push(home.join("Library/Application Support/Steam"));
        roots.push(home.join(".local/share/Steam"));
        roots.push(home.join(".steam/steam"));
    }
    roots
}

fn library_roots(selected: Option<&Path>) -> Vec<PathBuf> {
    let candidates = selected.map(|p| vec![p.to_path_buf()]).unwrap_or_else(default_steam_paths);
    let mut roots = Vec::new();
    for base in candidates {
        let before = roots.len();
        let mut libraries = vec![base.clone()];
        if let Ok(text) = read_small(&base.join("steamapps/libraryfolders.vdf")) { libraries.extend(vdf_libraries(&text)); }
        for library in libraries {
            for suffix in ["steamapps/workshop/content/431960", "steamapps/common/wallpaper_engine/projects/defaultprojects",
                "steamapps/common/wallpaper_engine/projects/myprojects", "projects/defaultprojects", "projects/myprojects"] {
                let path = library.join(suffix);
                if path.is_dir() { roots.push(path); }
            }
        }
        if selected.is_some() && before == roots.len() { roots.push(base); }
    }
    let mut seen = HashSet::new();
    roots.into_iter().filter_map(|p| p.canonicalize().ok()).filter(|p| seen.insert(p.clone())).collect()
}

fn scan(selected: Option<String>) -> Result<Library, String> {
    if selected.as_ref().is_some_and(|p| !Path::new(p).is_dir()) { return Err("所选壁纸目录不存在或不可读取".into()); }
    let mut library = Library::default();
    let mut visited = HashSet::new();
    for root in library_roots(selected.as_deref().map(Path::new)) {
        library.roots.push(root.to_string_lossy().to_string());
        scan_directory(&root, &root, 0, &mut visited, &mut library);
    }
    library.items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(library)
}

#[tauri::command]
pub async fn scan_wallpapers(app: tauri::AppHandle, root: Option<String>) -> Result<Library, String> {
    let library = tauri::async_runtime::spawn_blocking(move || scan(root)).await.map_err(|e| e.to_string())??;
    for item in &library.items {
        if let Some(preview) = &item.preview { app.asset_protocol_scope().allow_file(preview).map_err(|e| e.to_string())?; }
    }
    Ok(library)
}

#[tauri::command]
pub fn authorize_wallpaper_media(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let path = PathBuf::from(path).canonicalize().map_err(|_| "壁纸文件已移动或删除，请重新选择")?;
    if !path.is_file() || media_kind(&path).is_none() { return Err("仅支持图片和 MP4 / WebM / M4V 视频".into()); }
    app.asset_protocol_scope().allow_file(&path).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn fixture() -> PathBuf {
        let root = std::env::temp_dir().join(format!("markflow-wallpaper-{}-{}", std::process::id(), COUNTER.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(&root).unwrap();
        root.canonicalize().unwrap()
    }

    fn project(root: &Path, name: &str, json: Value) -> PathBuf {
        let directory = root.join(name);
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("project.json"), json.to_string()).unwrap();
        directory
    }

    #[test]
    fn videos_images_and_unsupported_projects_are_distinct() {
        let root = fixture();
        let video = project(&root, "video", serde_json::json!({"type":"video","title":"海浪","file":"movie.mp4","preview":"preview.jpg"}));
        fs::write(video.join("movie.mp4"), b"fixture").unwrap();
        fs::write(video.join("preview.jpg"), b"fixture").unwrap();
        let image = project(&root, "image", serde_json::json!({"type":"image","file":"image.png"}));
        fs::write(image.join("image.png"), b"fixture").unwrap();
        let scene = project(&root, "scene", serde_json::json!({"type":"scene","file":"scene.json","preview":"preview.jpg"}));
        fs::write(scene.join("scene.pkg"), b"fixture").unwrap();
        let web = project(&root, "web", serde_json::json!({"type":"web","file":"index.html"}));
        fs::write(web.join("index.html"), b"fixture").unwrap();
        project(&root, "app", serde_json::json!({"type":"application","file":"wallpaper.exe"}));
        let result = scan(Some(root.to_string_lossy().to_string())).unwrap();
        assert_eq!(result.items.len(), 5);
        assert_eq!(result.unsupported, 1);
        assert_eq!(result.items.iter().filter(|p| p.available).count(), 4);
        assert!(result.items.iter().find(|p| p.kind == "application").unwrap().reason.is_some());
        let item = result.items.iter().find(|i| i.name == "海浪").unwrap();
        assert_eq!(item.kind, "video");
        assert!(item.preview.as_ref().unwrap().ends_with("preview.jpg"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn project_traversal_and_missing_files_are_rejected() {
        let root = fixture();
        fs::write(root.join("outside.png"), b"fixture").unwrap();
        let escape = project(&root, "escape", serde_json::json!({"file":"../outside.png"}));
        let result = scan(Some(escape.to_string_lossy().to_string())).unwrap();
        assert!(result.items.is_empty());
        assert_eq!(result.invalid, 1);
        project(&root, "missing", serde_json::json!({"file":"gone.mp4"}));
        let broken = project(&root, "broken", serde_json::json!({}));
        fs::write(broken.join("project.json"), "invalid json").unwrap();
        let result = scan(Some(root.to_string_lossy().to_string())).unwrap();
        assert_eq!(result.invalid, 3);
        assert_eq!(result.items.len(), 1); // Only the explicitly selected loose image.
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn picture_presets_and_external_previews_are_handled() {
        let root = fixture();
        let directory = project(&root, "pictures", serde_json::json!({"title":"相册","preset":{"wallpapermode":2,"customdirectory":"photos"}}));
        fs::create_dir_all(directory.join("photos")).unwrap();
        fs::write(directory.join("photos/一.jpg"), b"fixture").unwrap();
        fs::write(directory.join("photos/二.png"), b"fixture").unwrap();
        let single = project(&root, "single", serde_json::json!({"preset":{"image":"photo.jpg"}}));
        fs::write(single.join("photo.jpg"), b"fixture").unwrap();
        let result = scan(Some(root.to_string_lossy().to_string())).unwrap();
        assert_eq!(result.items.len(), 3);
        assert!(result.items.iter().all(|i| i.kind == "image" && i.preview.is_some()));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn steam_secondary_library_and_duplicate_roots_are_supported() {
        let root = fixture();
        let steam = root.join("Steam");
        let secondary = root.join("第二个库");
        fs::create_dir_all(steam.join("steamapps")).unwrap();
        fs::create_dir_all(secondary.join("steamapps/workshop/content/431960")).unwrap();
        let escaped = secondary.to_string_lossy().replace('\\', "\\\\");
        fs::write(steam.join("steamapps/libraryfolders.vdf"), format!(r#""libraryfolders" {{ "0" {{ "path" "{escaped}" }} "1" {{ "path" "{escaped}" }} }}"#)).unwrap();
        let roots = library_roots(Some(&steam));
        assert_eq!(roots.len(), 1);
        assert!(roots[0].ends_with("431960"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn nested_projects_are_found_without_listing_their_assets_as_wallpapers() {
        let root = fixture();
        let nested = project(&root, "collection/subfolder/clock", serde_json::json!({"type":"web","file":"index.html"}));
        fs::write(nested.join("index.html"), b"fixture").unwrap();
        fs::write(nested.join("cover.jpg"), b"fixture").unwrap();
        let result = scan(Some(root.to_string_lossy().to_string())).unwrap();
        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].kind, "web");
        assert!(result.items[0].available);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn project_metadata_infers_builtin_type_and_rejects_invalid_shape() {
        let root = fixture();
        let directory = project(&root, "builtin", serde_json::json!({"file":"audiophile.json"}));
        let path = directory.join("project.json");
        let metadata = get_wallpaper_project(path.to_string_lossy().to_string()).unwrap();
        assert_eq!(metadata["type"], "scene");
        fs::write(&path, "null").unwrap();
        assert!(get_wallpaper_project(path.to_string_lossy().to_string()).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
