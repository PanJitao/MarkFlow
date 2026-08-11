// 防止 release 模式下弹出黑色控制台窗口（仅 Windows 生效，其它平台忽略）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::ipc::Response;
use tauri::Manager;

const PROG_ID: &str = "ExchangeMD.md";
const APP_NAME: &str = "MarkFlow.exe";
const MD_EXTS: &[&str] = &[".md", ".markdown", ".mdown"];
static WINDOW_COUNTER: AtomicU64 = AtomicU64::new(1);
static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(1);
const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// ---------- 跨平台「用系统默认程序打开」 ----------

// Windows：用 ShellExecuteW（无 cmd 黑框、无引号转义问题）
#[cfg(windows)]
mod platform {
    use std::ffi::c_void;
    use std::ffi::OsStr;
    use std::iter;
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(
            hwnd: isize,
            op: *const u16,
            file: *const u16,
            params: *const u16,
            dir: *const u16,
            show: i32,
        ) -> isize;
        fn SHChangeNotify(event_id: u32, flags: u32, item1: *const c_void, item2: *const c_void);
    }

    fn wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(iter::once(0)).collect()
    }

    pub(crate) fn shell_open(target: &str) -> Result<(), String> {
        let op = wide("open");
        let file = wide(target);
        let h = unsafe {
            ShellExecuteW(0, op.as_ptr(), file.as_ptr(), std::ptr::null(), std::ptr::null(), 1)
        };
        if h as usize <= 32 {
            Err(format!("无法打开（错误码 {h}）"))
        } else {
            Ok(())
        }
    }

    pub(crate) fn notify_association_changed() {
        unsafe { SHChangeNotify(0x0800_0000, 0, std::ptr::null(), std::ptr::null()) }
    }
}

// macOS / Linux：用系统命令打开
#[cfg(not(windows))]
mod platform {
    use std::process::Command;

    pub(crate) fn shell_open(target: &str) -> Result<(), String> {
        let cmd = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        match Command::new(cmd).arg(target).status() {
            Ok(s) if s.success() => Ok(()),
            Ok(_) => Err("打开失败".into()),
            Err(e) => Err(format!("无法打开：{e}")),
        }
    }

    pub(crate) fn notify_association_changed() {}
}

use platform::{notify_association_changed, shell_open};

// ---------- 文件读写（跨平台） ----------

/// 读取文本文件（用于 .md / .html）
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("读取文件失败：{e}"))
}

/// 读取二进制文件为原始字节（用于 .docx / .xlsx），零拷贝传给前端
#[tauri::command]
fn read_file_bytes(path: String) -> Result<Response, String> {
    let bytes = fs::read(&path).map_err(|e| format!("读取文件失败：{e}"))?;
    Ok(Response::new(bytes))
}

/// 写入文本文件
#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| format!("写入文件失败：{e}"))
}

/// 写入二进制文件（用于导出 .docx）
#[tauri::command]
fn write_file_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    fs::write(&path, bytes).map_err(|e| format!("写入文件失败：{e}"))
}

#[derive(Serialize)]
struct DirectoryEntry {
    name: String,
    path: String,
    is_dir: bool,
}

/// 读取一个目录的直接子项；文件树按需展开，不递归扫描整个文件夹。
#[tauri::command]
fn read_directory(path: String) -> Result<Vec<DirectoryEntry>, String> {
    let mut entries = fs::read_dir(&path)
        .map_err(|e| format!("读取文件夹失败：{e}"))?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            Some(DirectoryEntry {
                name: entry.file_name().to_string_lossy().to_string(),
                path: entry.path().to_string_lossy().to_string(),
                is_dir: file_type.is_dir(),
            })
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| {
        right.is_dir.cmp(&left.is_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(entries)
}

fn child_path(parent: &str, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\']) {
        return Err("名称不能为空，且不能包含路径分隔符".into());
    }
    Ok(Path::new(parent).join(name))
}

#[tauri::command]
fn create_workspace_file(
    parent: String,
    name: String,
    root: Option<String>,
) -> Result<String, String> {
    if let Some(root) = root {
        checked_workspace_entry(&root, &parent, true)?;
    }
    let path = child_path(&parent, &name)?;
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| format!("新建文件失败：{e}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn create_workspace_folder(
    parent: String,
    name: String,
    root: Option<String>,
) -> Result<String, String> {
    if let Some(root) = root {
        checked_workspace_entry(&root, &parent, true)?;
    }
    let path = child_path(&parent, &name)?;
    fs::create_dir(&path).map_err(|e| format!("新建文件夹失败：{e}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[derive(Serialize)]
struct ImageAssetResult {
    path: String,
    status: String,
}

fn validate_image_name(name: &str) -> Result<(), String> {
    let extension = Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !IMAGE_EXTS.contains(&extension.as_str()) {
        return Err("仅支持 PNG、JPG、JPEG、GIF、WebP、BMP 或 SVG 图片".into());
    }
    child_path(".", name).map(|_| ())
}

fn store_image_bytes(
    directory: &Path,
    file_name: &str,
    bytes: &[u8],
    overwrite: bool,
) -> Result<ImageAssetResult, String> {
    validate_image_name(file_name)?;
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err("图片不能为空且不能超过 20 MiB".into());
    }
    fs::create_dir_all(directory).map_err(|e| format!("创建图片目录失败：{e}"))?;
    let target = child_path(&directory.to_string_lossy(), file_name)?;
    if target.exists() {
        let existing = fs::read(&target).map_err(|e| format!("读取同名图片失败：{e}"))?;
        if existing == bytes {
            return Ok(ImageAssetResult {
                path: target.to_string_lossy().to_string(),
                status: "reused".into(),
            });
        }
        if !overwrite {
            return Ok(ImageAssetResult {
                path: target.to_string_lossy().to_string(),
                status: "conflict".into(),
            });
        }
    }

    let temp_name = format!(
        ".markflow-image-{}-{}.tmp",
        std::process::id(),
        TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let temp = directory.join(temp_name);
    fs::write(&temp, bytes).map_err(|e| format!("写入图片失败：{e}"))?;
    if overwrite && target.exists() {
        fs::remove_file(&target).map_err(|e| {
            let _ = fs::remove_file(&temp);
            format!("覆盖同名图片失败：{e}")
        })?;
    }
    fs::rename(&temp, &target).map_err(|e| {
        let _ = fs::remove_file(&temp);
        format!("保存图片失败：{e}")
    })?;
    Ok(ImageAssetResult {
        path: target.to_string_lossy().to_string(),
        status: "created".into(),
    })
}

#[tauri::command]
fn save_image_asset(
    directory: String,
    file_name: String,
    bytes: Vec<u8>,
    overwrite: bool,
) -> Result<ImageAssetResult, String> {
    store_image_bytes(Path::new(&directory), &file_name, &bytes, overwrite)
}

#[tauri::command]
fn copy_image_asset(
    source: String,
    directory: String,
    overwrite: bool,
) -> Result<ImageAssetResult, String> {
    let source_path = Path::new(&source);
    let file_name = source_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "无法读取图片文件名".to_string())?;
    validate_image_name(file_name)?;
    let bytes = fs::read(source_path).map_err(|e| format!("读取图片失败：{e}"))?;
    store_image_bytes(Path::new(&directory), file_name, &bytes, overwrite)
}

#[tauri::command]
fn ensure_workspace_image_dir(root: String) -> Result<String, String> {
    let directory = Path::new(&root).join("img");
    fs::create_dir_all(&directory).map_err(|e| format!("创建 img 文件夹失败：{e}"))?;
    Ok(directory.to_string_lossy().to_string())
}

fn checked_workspace_entry(
    root: &str,
    target: &str,
    allow_root: bool,
) -> Result<(PathBuf, PathBuf), String> {
    let root = fs::canonicalize(root).map_err(|e| format!("无法访问工作区：{e}"))?;
    let target = fs::canonicalize(target).map_err(|e| format!("无法访问目标：{e}"))?;
    if !target.starts_with(&root) || (!allow_root && target == root) {
        return Err("只能操作工作区内部项目".into());
    }
    Ok((root, target))
}

#[tauri::command]
fn rename_workspace_entry(root: String, path: String, new_name: String) -> Result<String, String> {
    let (_, current) = checked_workspace_entry(&root, &path, false)?;
    let parent = current
        .parent()
        .ok_or_else(|| "无法确定项目所在目录".to_string())?;
    let target = child_path(&parent.to_string_lossy(), &new_name)?;
    if target.exists() {
        return Err("目标名称已经存在".into());
    }
    fs::rename(&current, &target).map_err(|e| format!("重命名失败：{e}"))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn trash_workspace_entry(root: String, path: String) -> Result<(), String> {
    let (_, target) = checked_workspace_entry(&root, &path, false)?;
    trash::delete(&target).map_err(|e| format!("移入系统回收站失败：{e}"))
}

#[tauri::command]
fn workspace_relative_path(root: String, path: String) -> Result<String, String> {
    let (root, target) = checked_workspace_entry(&root, &path, true)?;
    let relative =
        pathdiff::diff_paths(target, root).ok_or_else(|| "无法生成相对路径".to_string())?;
    let value = relative.to_string_lossy().replace('\\', "/");
    Ok(if value.is_empty() { ".".into() } else { value })
}

#[tauri::command]
fn reveal_in_file_manager(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.exists() {
        return Err("目标不存在".into());
    }
    #[cfg(windows)]
    {
        let mut command = Command::new("explorer.exe");
        command.creation_flags(CREATE_NO_WINDOW);
        if target.is_dir() {
            command.arg(target);
        } else {
            command.arg("/select,").arg(target);
        }
        return command
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("打开资源管理器失败：{e}"));
    }
    #[cfg(not(windows))]
    {
        let reveal = if target.is_dir() {
            target
        } else {
            target.parent().unwrap_or(target)
        };
        shell_open(&reveal.to_string_lossy())
    }
}

/// 返回 target 相对于 Markdown 文件所在目录的路径，用于图片引用。
#[tauri::command]
fn relative_path(from_file: String, target: String) -> Result<String, String> {
    let base = Path::new(&from_file)
        .parent()
        .ok_or_else(|| "无法确定当前文档所在文件夹".to_string())?;
    let relative = pathdiff::diff_paths(Path::new(&target), base)
        .ok_or_else(|| "无法生成相对路径".to_string())?;
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
fn resolve_relative_path(from_file: String, relative: String) -> Result<String, String> {
    let base = Path::new(&from_file)
        .parent()
        .ok_or_else(|| "无法确定当前文档所在文件夹".to_string())?;
    Ok(base.join(relative).to_string_lossy().to_string())
}

#[tauri::command]
fn new_window(app: tauri::AppHandle) -> Result<(), String> {
    let label = format!("document-{}", WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed));
    tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::App("index.html".into()))
        .title("MarkFlow 文档转换工作台")
        .inner_size(1280.0, 820.0)
        .min_inner_size(900.0, 600.0)
        .build()
        .map(|_| ())
        .map_err(|e| format!("新建窗口失败：{e}"))
}

/// 启动时传入的文件路径（通过双击 / 右键打开时由系统传入 argv）
#[tauri::command]
fn get_launch_file() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|a| MD_EXTS.iter().any(|ext| a.to_lowercase().ends_with(ext)))
}

/// 用系统默认浏览器打开外部链接（不在应用窗口内跳转）
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    shell_open(&url)
}

/// 打开系统「默认应用」设置页
#[tauri::command]
fn open_default_apps_settings() -> Result<(), String> {
    if cfg!(windows) {
        shell_open("ms-settings:defaultapps")
    } else if cfg!(target_os = "macos") {
        shell_open("x-apple.systempreferences:")
    } else {
        Err("Linux 请在系统设置中手动配置默认应用".into())
    }
}

fn custom_icon_path(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取图标存储目录：{e}"))?;
    fs::create_dir_all(&directory).map_err(|e| format!("无法创建图标存储目录：{e}"))?;
    Ok(directory.join(name))
}

fn validate_icon_source(source: &str, extensions: &[&str]) -> Result<PathBuf, String> {
    let path = PathBuf::from(source);
    if !path.is_file() {
        return Err("找不到所选图标文件".into());
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .ok_or_else(|| "图标文件缺少扩展名".to_string())?;
    if !extensions.iter().any(|allowed| *allowed == extension) {
        return Err(format!("仅支持 {} 图标文件", extensions.join("、")));
    }
    Ok(path)
}

#[tauri::command]
fn install_custom_app_icon(app: tauri::AppHandle, source: String) -> Result<String, String> {
    let source_path = validate_icon_source(&source, &["png", "ico"])?;
    let extension = source_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("png")
        .to_ascii_lowercase();
    let target = custom_icon_path(&app, &format!("custom-app-icon.{extension}"))?;
    let other_extension = if extension == "png" { "ico" } else { "png" };
    let _ = fs::remove_file(custom_icon_path(&app, &format!("custom-app-icon.{other_extension}"))?);
    fs::copy(source_path, &target).map_err(|e| format!("保存应用图标失败：{e}"))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn install_custom_file_icon(app: tauri::AppHandle, source: String) -> Result<String, String> {
    let source_path = validate_icon_source(&source, &["ico"])?;
    let target = custom_icon_path(&app, "custom-file-icon.ico")?;
    fs::copy(source_path, &target).map_err(|e| format!("保存文件图标失败：{e}"))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn clear_custom_icon(app: tauri::AppHandle, kind: String) -> Result<(), String> {
    let names: &[&str] = match kind.as_str() {
        "app" => &["custom-app-icon.png", "custom-app-icon.ico"],
        "file" => &["custom-file-icon.ico"],
        _ => return Err("未知图标类型".into()),
    };
    for name in names {
        let path = custom_icon_path(&app, name)?;
        let _ = fs::remove_file(path);
    }
    Ok(())
}

#[tauri::command]
fn get_icon_path(app: tauri::AppHandle, kind: String) -> Result<String, String> {
    let custom_names: &[&str] = match kind.as_str() {
        "app" => &["custom-app-icon.png", "custom-app-icon.ico"],
        "file" => &["custom-file-icon.ico"],
        _ => return Err("未知图标类型".into()),
    };
    for name in custom_names {
        let path = custom_icon_path(&app, name)?;
        if path.is_file() {
            return Ok(path.to_string_lossy().to_string());
        }
    }
    let bundled_name = if kind == "app" { "icon.png" } else { "markdown-document.ico" };
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|e| format!("无法获取应用资源目录：{e}"))?
        .join("icons")
        .join(bundled_name);
    if bundled.is_file() {
        Ok(bundled.to_string_lossy().to_string())
    } else {
        Err(format!("找不到默认图标：{}", bundled.display()))
    }
}

/// 把 MarkFlow 注册进 .md 的「打开方式」列表（仅 Windows；HKCU，无需管理员）
#[cfg(windows)]
#[tauri::command]
fn register_md_handler(app: tauri::AppHandle) -> Result<String, String> {
    register_md_handler_windows(&app)
}

#[cfg(not(windows))]
#[tauri::command]
fn register_md_handler(_app: tauri::AppHandle) -> Result<String, String> {
    Err("文件关联注册目前仅在 Windows 上支持".into())
}

// ---------- Windows 文件关联实现 ----------

#[cfg(windows)]
fn register_md_handler_windows(app: &tauri::AppHandle) -> Result<String, String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("无法获取程序路径：{e}"))?
        .to_string_lossy()
        .to_string();
    let open_cmd = format!("\"{}\" \"%1\"", exe);
    let custom_file_icon = custom_icon_path(app, "custom-file-icon.ico")?;
    let icon_path = if custom_file_icon.is_file() {
        custom_file_icon
    } else {
        app.path()
            .resource_dir()
            .map_err(|e| format!("无法获取应用资源目录：{e}"))?
            .join("icons")
            .join("markdown-document.ico")
    };
    if !icon_path.is_file() {
        return Err(format!("找不到 Markdown 文件图标：{}", icon_path.display()));
    }
    let icon = format!("\"{}\",0", icon_path.to_string_lossy());

    let base = format!("HKCU\\Software\\Classes\\{}", PROG_ID);

    // 1) ProgID 基本信息
    reg_add(&["add", &base, "/ve", "/d", "MarkFlow Markdown 文档", "/f"])?;
    reg_add(&["add", &format!("{}\\DefaultIcon", base), "/ve", "/d", &icon, "/f"])?;
    reg_add(&[
        "add",
        &format!("{}\\shell\\open\\command", base),
        "/ve",
        "/d",
        &open_cmd,
        "/f",
    ])?;

    // 2) 把 ProgID 加进各 Markdown 扩展名的 OpenWithProgids / OpenWithList
    for ext in MD_EXTS {
        let dot = format!("HKCU\\Software\\Classes\\{}", ext);
        reg_add(&[
            "add",
            &format!("{}\\OpenWithProgids", dot),
            "/v",
            PROG_ID,
            "/t",
            "REG_SZ",
            "/d",
            "",
            "/f",
        ])?;
        reg_add(&[
            "add",
            &format!("{}\\OpenWithList", dot),
            "/v",
            APP_NAME,
            "/t",
            "REG_SZ",
            "/d",
            "",
            "/f",
        ])?;
    }

    // 3) 标准「新建」子菜单：创建空白 Markdown 文件，不覆盖现有关联程序。
    let markdown_extension = "HKCU\\Software\\Classes\\.md";
    reg_add(&[
        "add",
        markdown_extension,
        "/ve",
        "/d",
        PROG_ID,
        "/f",
    ])?;
    let shell_new = "HKCU\\Software\\Classes\\.md\\ShellNew";
    reg_add(&[
        "add",
        shell_new,
        "/v",
        "NullFile",
        "/t",
        "REG_SZ",
        "/d",
        "",
        "/f",
    ])?;
    reg_add(&[
        "add",
        shell_new,
        "/v",
        "ItemName",
        "/t",
        "REG_SZ",
        "/d",
        "Markdown 文档",
        "/f",
    ])?;

    // 清理旧版添加的独立右键命令，避免与「新建」菜单重复。
    for key in [
        "HKCU\\Software\\Classes\\Directory\\Background\\shell\\MarkFlowNewMarkdown",
        "HKCU\\Software\\Classes\\Directory\\shell\\MarkFlowNewMarkdown",
    ] {
        let _ = Command::new("reg")
            .creation_flags(CREATE_NO_WINDOW)
            .args(["delete", key, "/f"])
            .output();
    }
    notify_association_changed();

    Ok(format!("已注册 Markdown 打开方式和「新建」菜单（程序：{}）", exe))
}

#[cfg(windows)]
fn reg_add(args: &[&str]) -> Result<(), String> {
    let status = Command::new("reg")
        .creation_flags(CREATE_NO_WINDOW)
        .args(args)
        .output()
        .map_err(|e| format!("调用 reg.exe 失败：{e}"))?;
    if !status.status.success() {
        let stderr = String::from_utf8_lossy(&status.stderr);
        let stdout = String::from_utf8_lossy(&status.stdout);
        return Err(format!("写注册表失败：{} {}", stdout.trim(), stderr.trim()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_directory(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "markflow-{name}-{}-{}",
            std::process::id(),
            TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn image_assets_keep_names_and_detect_conflicts() {
        let directory = test_directory("images");
        let original = b"original-image";
        let changed = b"changed-image";

        let created = store_image_bytes(&directory, "产品图.png", original, false).unwrap();
        assert_eq!(created.status, "created");
        assert_eq!(Path::new(&created.path).file_name().unwrap(), "产品图.png");

        let reused = store_image_bytes(&directory, "产品图.png", original, false).unwrap();
        assert_eq!(reused.status, "reused");

        let conflict = store_image_bytes(&directory, "产品图.png", changed, false).unwrap();
        assert_eq!(conflict.status, "conflict");
        assert_eq!(fs::read(directory.join("产品图.png")).unwrap(), original);

        let overwritten = store_image_bytes(&directory, "产品图.png", changed, true).unwrap();
        assert_eq!(overwritten.status, "created");
        assert_eq!(fs::read(directory.join("产品图.png")).unwrap(), changed);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn workspace_rename_stays_inside_root() {
        let root = test_directory("rename");
        fs::create_dir_all(&root).unwrap();
        let source = root.join("before.md");
        fs::write(&source, "content").unwrap();

        let renamed = rename_workspace_entry(
            root.to_string_lossy().to_string(),
            source.to_string_lossy().to_string(),
            "after.md".into(),
        )
        .unwrap();
        assert_eq!(Path::new(&renamed).file_name().unwrap(), "after.md");
        assert!(root.join("after.md").exists());
        assert!(rename_workspace_entry(
            root.to_string_lossy().to_string(),
            root.to_string_lossy().to_string(),
            "outside".into(),
        )
        .is_err());
        fs::remove_dir_all(root).unwrap();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            read_file_bytes,
            write_text_file,
            write_file_bytes,
            read_directory,
            create_workspace_file,
            create_workspace_folder,
            save_image_asset,
            copy_image_asset,
            ensure_workspace_image_dir,
            rename_workspace_entry,
            trash_workspace_entry,
            workspace_relative_path,
            reveal_in_file_manager,
            relative_path,
            resolve_relative_path,
            new_window,
            get_launch_file,
            register_md_handler,
            install_custom_app_icon,
            install_custom_file_icon,
            clear_custom_icon,
            get_icon_path,
            open_default_apps_settings,
            open_url,
        ])
        .run(tauri::generate_context!())
        .expect("运行 MarkFlow 时出错");
}
