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

#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).is_file()
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

#[tauri::command]
fn write_existing_text_file(path: String, content: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.is_file() {
        return Err("原文件不存在，已停止自动保存".into());
    }
    fs::write(target, content).map_err(|e| format!("写入文件失败：{e}"))
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

// ---------- 文档转换：anydoc（Word/PowerPoint/Excel/ODF/RTF/EPUB/CSV/PDF → Markdown） ----------

use anydoc::model::{AssetId, Block, CellSlot, Document, ImageSource, Inline, Note, TableKind};
use anydoc::Format as AnyDocFormat;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Serialize)]
struct OfficeConversion {
    markdown: String,
    format: String,
    image_count: usize,
    skipped_images: usize,
}

#[derive(Debug, Serialize)]
struct ConvertFailure {
    code: String,
    message: String,
}

fn convert_failure(code: &str, message: impl Into<String>) -> ConvertFailure {
    ConvertFailure { code: code.to_string(), message: message.into() }
}

fn map_anydoc_error(error: anydoc::ConvertError) -> ConvertFailure {
    ConvertFailure { code: error.code().to_string(), message: error.to_string() }
}

fn anydoc_format_label(format: AnyDocFormat) -> &'static str {
    match format {
        AnyDocFormat::Doc => "Word (.doc)",
        AnyDocFormat::Docx => "Word (.docx)",
        AnyDocFormat::Odt => "OpenDocument 文本 (.odt)",
        AnyDocFormat::Pdf => "PDF",
        AnyDocFormat::Ppt => "PowerPoint (.ppt)",
        AnyDocFormat::Pptx => "PowerPoint (.pptx)",
        AnyDocFormat::Rtf => "RTF 文档",
        AnyDocFormat::Epub => "EPUB",
        AnyDocFormat::Excel => "Excel",
        AnyDocFormat::Ods => "OpenDocument 表格 (.ods)",
        AnyDocFormat::Odp => "OpenDocument 演示文稿 (.odp)",
        AnyDocFormat::Csv => "CSV",
    }
}

// 以下转义逻辑与 anydoc 0.1.9 的 Markdown 渲染器保持一致（MIT），
// 保证内嵌图片渲染出的说明文字可以在输出 Markdown 中精确匹配并替换。
#[derive(Clone, Copy, PartialEq)]
enum InlineContext {
    Block,
    Heading,
    TableCell,
}

#[derive(Clone, Copy, Default)]
struct EscapeOpts {
    at_line_start: bool,
    styled: bool,
    trailing_active: bool,
    in_label: bool,
}

fn escape_text(text: &str, ctx: InlineContext, opts: EscapeOpts) -> String {
    let EscapeOpts { at_line_start, styled, trailing_active, in_label } = opts;
    let chars: Vec<char> = text.chars().collect();
    let mut last: [Option<usize>; 5] = [None; 5]; // * _ ~ ` ]
    for (j, &c) in chars.iter().enumerate() {
        match c {
            '*' => last[0] = Some(j),
            '_' => last[1] = Some(j),
            '~' => last[2] = Some(j),
            '`' => last[3] = Some(j),
            ']' => last[4] = Some(j),
            _ => {}
        }
    }
    let mut out = String::with_capacity(text.len() + 8);
    let mut line_has_content = !(at_line_start && ctx == InlineContext::Block);
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '\n' {
            out.push('\n');
            if ctx == InlineContext::Block {
                line_has_content = false;
            }
            i += 1;
            continue;
        }
        let start_of_line = !line_has_content;
        if !c.is_whitespace() {
            line_has_content = true;
        }
        let next = chars.get(i + 1).copied();
        let next_nonspace = next.map_or(trailing_active, |n| !n.is_whitespace());
        let paired = |slot: usize| trailing_active || last[slot].is_some_and(|j| j > i);
        let escape = match c {
            '\\' => true,
            ']' if in_label => true,
            '`' => styled || paired(3),
            '*' => styled || start_of_line || (next_nonspace && paired(0)),
            '_' => {
                let prev_alnum = i > 0 && chars[i - 1].is_alphanumeric();
                let next_alnum = next.is_some_and(char::is_alphanumeric);
                styled || (next_nonspace && !(prev_alnum && next_alnum) && paired(1))
            }
            '~' => styled || (next_nonspace && paired(2)),
            '[' => in_label || paired(4),
            '<' => next.is_some_and(|n| n.is_ascii_alphabetic() || matches!(n, '/' | '!' | '?')),
            '!' => next.is_none() && trailing_active,
            '|' if ctx == InlineContext::TableCell => true,
            '&' if entity_ahead(&chars[i..]) => {
                out.push_str("&amp;");
                i += 1;
                continue;
            }
            '#' if start_of_line => {
                let j = (i..chars.len()).find(|&j| chars[j] != '#').unwrap_or(chars.len());
                chars.get(j).is_none_or(|n| n.is_whitespace())
            }
            '-' if start_of_line => !next_nonspace || line_is_only(&chars[i..], '-'),
            '+' if start_of_line => !next_nonspace,
            '>' if start_of_line => true,
            '=' if start_of_line => line_is_only(&chars[i..], '='),
            '0'..='9' if start_of_line => {
                let mut j = i;
                while j < chars.len() && chars[j].is_ascii_digit() {
                    j += 1;
                }
                if j < chars.len()
                    && (chars[j] == '.' || chars[j] == ')')
                    && chars.get(j + 1).is_none_or(|n| n.is_whitespace())
                {
                    out.extend(&chars[i..j]);
                    out.push('\\');
                    out.push(chars[j]);
                    i = j + 1;
                    continue;
                }
                false
            }
            _ => false,
        };
        if escape {
            out.push('\\');
        }
        out.push(c);
        i += 1;
    }
    out
}

fn line_is_only(chars: &[char], c: char) -> bool {
    chars.iter().take_while(|&&ch| ch != '\n').all(|&ch| ch == c || ch == ' ' || ch == '\t')
}

fn entity_ahead(chars: &[char]) -> bool {
    let mut i = 1;
    if i < chars.len() && chars[i] == '#' {
        return true;
    }
    let mut seen = 0;
    while i < chars.len() && chars[i].is_ascii_alphanumeric() {
        i += 1;
        seen += 1;
    }
    seen > 0 && i < chars.len() && chars[i] == ';'
}

/// 渲染顺序中的一张内嵌图片（含渲染上下文与前后文定位信息）。
struct LocatedImage {
    alt: String,
    asset_id: usize,
    ctx: InlineContext,
    in_label: bool,
    /// 同一块内、图片之前的文字尾部（用于把图片还原到原文位置）
    prev_inline_tail: String,
    /// 同一块内、图片之后的文字开头
    next_inline_head: String,
    /// 前一个块的文字尾部（图片独占一段时跨块定位用）
    prev_block_tail: String,
    /// 后一个块的文字开头
    next_block_head: String,
}

fn tail_chars(text: &str, max: usize) -> String {
    text.chars().rev().take(max).collect::<Vec<_>>().into_iter().rev().collect()
}

fn head_chars(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

fn block_plain_text(block: &Block) -> String {
    match block {
        Block::Paragraph(inlines) | Block::Heading { content: inlines, .. } => {
            anydoc::model::inlines_to_plain_text(inlines)
        }
        _ => String::new(),
    }
}

fn previous_block_tail(blocks: &[Block], index: usize) -> String {
    for block in blocks[..index].iter().rev() {
        let trimmed = tail_chars(block_plain_text(block).trim_end(), 16);
        if !trimmed.is_empty() {
            return trimmed;
        }
    }
    String::new()
}

fn next_block_head(blocks: &[Block], index: usize) -> String {
    for block in blocks[index + 1..].iter() {
        let trimmed = head_chars(block_plain_text(block).trim_start(), 16);
        if !trimmed.is_empty() {
            return trimmed;
        }
    }
    String::new()
}

fn collect_images_inlines(
    inlines: &[Inline],
    ctx: InlineContext,
    in_label: bool,
    prev_block_tail: &str,
    next_block_head: &str,
    images: &mut Vec<LocatedImage>,
) {
    for (index, inline) in inlines.iter().enumerate() {
        match inline {
            Inline::Image { alt, source } => {
                if let ImageSource::Asset(AssetId(id)) = source {
                    let prev_text = anydoc::model::inlines_to_plain_text(&inlines[..index]);
                    let next_text = anydoc::model::inlines_to_plain_text(&inlines[index + 1..]);
                    images.push(LocatedImage {
                        alt: alt.clone(),
                        asset_id: *id,
                        ctx,
                        in_label,
                        prev_inline_tail: tail_chars(prev_text.trim_end(), 16),
                        next_inline_head: head_chars(next_text.trim_start(), 16),
                        prev_block_tail: prev_block_tail.to_string(),
                        next_block_head: next_block_head.to_string(),
                    });
                }
            }
            Inline::Link { content, .. } => {
                collect_images_inlines(content, ctx, true, prev_block_tail, next_block_head, images);
            }
            _ => {}
        }
    }
}

fn collect_images_blocks(blocks: &[Block], ctx: InlineContext, images: &mut Vec<LocatedImage>) {
    for (index, block) in blocks.iter().enumerate() {
        let prev_block_tail = previous_block_tail(blocks, index);
        let next_block_head = next_block_head(blocks, index);
        match block {
            Block::Heading { content, .. } => {
                collect_images_inlines(
                    content,
                    InlineContext::Heading,
                    false,
                    &prev_block_tail,
                    &next_block_head,
                    images,
                );
            }
            Block::Paragraph(inlines) => collect_images_inlines(
                inlines,
                ctx,
                false,
                &prev_block_tail,
                &next_block_head,
                images,
            ),
            Block::List(list) => {
                for item in &list.items {
                    collect_images_blocks(&item.blocks, InlineContext::Block, images);
                }
            }
            Block::Table(table) => {
                // 单格布局表格会被渲染器展开成普通内容，沿用 Block 上下文
                if table.kind == TableKind::Layout && table.is_single_cell() {
                    if let Some(CellSlot::Origin(cell)) = table.grid.first().and_then(|row| row.first())
                    {
                        collect_images_blocks(&cell.blocks, InlineContext::Block, images);
                    }
                    continue;
                }
                for row in &table.grid {
                    for slot in row {
                        if let CellSlot::Origin(cell) = slot {
                            collect_images_blocks(&cell.blocks, InlineContext::TableCell, images);
                        }
                    }
                }
            }
            Block::BlockQuote(blocks) => collect_images_blocks(blocks, InlineContext::Block, images),
            Block::CodeBlock { .. } | Block::Rule => {}
        }
    }
}

fn block_is_blank(block: &Block) -> bool {
    match block {
        Block::Paragraph(inlines) => anydoc::model::inlines_are_empty(inlines),
        _ => false,
    }
}

/// 按渲染顺序收集脚注/尾注 id（与 anydoc 渲染器的编号顺序一致）。
fn collect_note_refs(
    blocks: &[Block],
    valid: &HashMap<&str, &Note>,
    order: &mut Vec<String>,
    seen: &mut HashSet<String>,
) {
    fn walk_inlines(
        inlines: &[Inline],
        valid: &HashMap<&str, &Note>,
        order: &mut Vec<String>,
        seen: &mut HashSet<String>,
    ) {
        for inline in inlines {
            match inline {
                Inline::NoteRef(id) => {
                    if let Some(note) = valid.get(id.as_str()) {
                        if seen.insert(id.clone()) {
                            order.push(id.clone());
                            collect_note_refs(&note.blocks, valid, order, seen);
                        }
                    }
                }
                Inline::Link { content, .. } => walk_inlines(content, valid, order, seen),
                _ => {}
            }
        }
    }
    for block in blocks {
        match block {
            Block::Paragraph(inlines) | Block::Heading { content: inlines, .. } => {
                walk_inlines(inlines, valid, order, seen);
            }
            Block::List(list) => {
                for item in &list.items {
                    collect_note_refs(&item.blocks, valid, order, seen);
                }
            }
            Block::Table(table) => {
                for row in &table.grid {
                    for slot in row {
                        if let CellSlot::Origin(cell) = slot {
                            collect_note_refs(&cell.blocks, valid, order, seen);
                        }
                    }
                }
            }
            Block::BlockQuote(blocks) => collect_note_refs(blocks, valid, order, seen),
            Block::CodeBlock { .. } | Block::Rule => {}
        }
    }
}

fn ordered_note_ids(document: &Document) -> Vec<String> {
    let mut valid: HashMap<&str, &Note> = HashMap::new();
    for note in &document.notes {
        if !note.blocks.iter().all(block_is_blank) {
            valid.entry(note.id.as_str()).or_insert(note);
        }
    }
    let mut order: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    collect_note_refs(&document.blocks, &valid, &mut order, &mut seen);
    for note in &document.notes {
        if valid.contains_key(note.id.as_str()) && seen.insert(note.id.clone()) {
            order.push(note.id.clone());
        }
    }
    order
}

fn image_extension(media_type: &str) -> Option<&'static str> {
    match media_type.to_ascii_lowercase().as_str() {
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/bmp" => Some("bmp"),
        "image/svg+xml" => Some("svg"),
        _ => None,
    }
}

struct ExtractedImage {
    file_name: String,
    image_markdown: String,
    fallback_text: String,
    bytes: Vec<u8>,
}

/// 在 Markdown 中定位一张图片的位置。
enum ImageInsertion {
    /// 替换一段已渲染的说明文字（精确匹配）
    Replace { start: usize, end: usize },
    /// 在指定字节偏移处插入图片 Markdown
    InsertAt { position: usize, cross_block: bool },
}

fn locate_image_insertion(markdown: &str, cursor: usize, image: &LocatedImage) -> Option<ImageInsertion> {
    // 1) 有说明文字：按渲染器转义后的文字精确匹配，最可靠
    let rendered_alt = escape_text(
        image.alt.trim(),
        image.ctx,
        EscapeOpts { in_label: image.in_label, ..Default::default() },
    );
    if !rendered_alt.is_empty() {
        if let Some(found) = markdown[cursor..].find(&rendered_alt) {
            let start = cursor + found;
            return Some(ImageInsertion::Replace { start, end: start + rendered_alt.len() });
        }
    }

    let search = &markdown[cursor..];
    let has_prev = !image.prev_inline_tail.is_empty();
    let has_next = !image.next_inline_head.is_empty();

    // 2) 块内定位：前后文 sandwich。优先用「后文开头」作为插入点（插在样式标记内侧，
    //    不破坏加粗/斜体配对），用「前文尾部」限定搜索窗口提高准确性。
    if has_prev && has_next {
        if let Some(prev_found) = search.find(&image.prev_inline_tail) {
            let window_start = prev_found + image.prev_inline_tail.len();
            let window_end = (window_start + 160).min(search.len());
            if let Some(next_found) = search[window_start..window_end].find(&image.next_inline_head) {
                return Some(ImageInsertion::InsertAt {
                    position: cursor + window_start + next_found,
                    cross_block: false,
                });
            }
        }
    }
    if has_next {
        if let Some(found) = search.find(&image.next_inline_head) {
            return Some(ImageInsertion::InsertAt { position: cursor + found, cross_block: false });
        }
    }
    if has_prev {
        if let Some(found) = search.rfind(&image.prev_inline_tail) {
            return Some(ImageInsertion::InsertAt {
                position: cursor + found + image.prev_inline_tail.len(),
                cross_block: false,
            });
        }
    }

    // 3) 跨块定位：图片独占一段时，插到前一块尾部之后，或后一块整行之前
    //    （插到整行开头，避免破坏标题/列表等块级标记）
    if !image.prev_block_tail.is_empty() {
        if let Some(found) = search.rfind(&image.prev_block_tail) {
            return Some(ImageInsertion::InsertAt {
                position: cursor + found + image.prev_block_tail.len(),
                cross_block: true,
            });
        }
    }
    if !image.next_block_head.is_empty() {
        if let Some(found) = search.find(&image.next_block_head) {
            let absolute = cursor + found;
            let line_start = markdown[..absolute]
                .rfind('\n')
                .map(|pos| pos + 1)
                .unwrap_or(0);
            return Some(ImageInsertion::InsertAt { position: line_start, cross_block: true });
        }
    }
    None
}

/// 把文档模型里的内嵌图片在 Markdown 中换成占位引用（尽量还原到原文位置）。
/// 返回 (待落盘图片列表, 未能提取的图片数)。
fn externalize_document_images(
    document: &Document,
    markdown: &mut String,
    extract: bool,
) -> (Vec<ExtractedImage>, usize) {
    let mut located: Vec<LocatedImage> = Vec::new();
    collect_images_blocks(&document.blocks, InlineContext::Block, &mut located);
    for note_id in ordered_note_ids(document) {
        if let Some(note) = document.notes.iter().find(|note| note.id == note_id) {
            collect_images_blocks(&note.blocks, InlineContext::Block, &mut located);
        }
    }

    let mut extracted: Vec<ExtractedImage> = Vec::new();
    let mut appendix: Vec<(String, Vec<u8>)> = Vec::new();
    let mut name_by_asset: HashMap<usize, String> = HashMap::new();
    let mut cursor = 0usize;
    let mut skipped = 0usize;

    for image in &located {
        let Some(asset) = document.assets.get(image.asset_id) else {
            skipped += 1;
            continue;
        };
        let Some(extension) = image_extension(&asset.media_type) else {
            skipped += 1;
            continue;
        };
        let file_name = match name_by_asset.get(&image.asset_id) {
            Some(name) => name.clone(),
            None => {
                let name = format!("image-{:03}.{}", name_by_asset.len() + 1, extension);
                name_by_asset.insert(image.asset_id, name.clone());
                name
            }
        };
        if !extract {
            skipped += 1;
            continue;
        }

        // 图片的 Markdown 说明文字：优先原说明，没有时用编号占位
        let rendered_alt = escape_text(
            image.alt.trim(),
            image.ctx,
            EscapeOpts { in_label: image.in_label, ..Default::default() },
        );
        let stem = file_name.split('.').next().unwrap_or(&file_name);
        let label = if rendered_alt.is_empty() { format!("图片 {}", stem) } else { rendered_alt.clone() };

        let Some(hit) = locate_image_insertion(markdown, cursor, image) else {
            appendix.push((file_name, asset.bytes.clone()));
            continue;
        };
        let image_markdown = format!("![{}](markflow-asset-{})", label, file_name);
        match hit {
            ImageInsertion::Replace { start, end } => {
                markdown.replace_range(start..end, &image_markdown);
                cursor = start + image_markdown.len();
            }
            ImageInsertion::InsertAt { position, cross_block } => {
                let block_separated = if cross_block {
                    // 插在前一块尾部之后：\n\n![..](..)；插在整行之前：![..](..)\n\n
                    let after_prev = !image.prev_block_tail.is_empty();
                    if after_prev { format!("\n\n{image_markdown}") } else { format!("{image_markdown}\n\n") }
                } else {
                    image_markdown.clone()
                };
                markdown.insert_str(position, &block_separated);
                cursor = position + block_separated.len();
            }
        }
        extracted.push(ExtractedImage {
            file_name,
            image_markdown,
            fallback_text: label,
            bytes: asset.bytes.clone(),
        });
    }

    // 完全无法定位的图片统一附在文末，避免丢失
    if !appendix.is_empty() {
        markdown.push_str("\n\n<!-- MarkFlow：以下图片无法还原到原文位置，按提取顺序附在文末 -->\n\n");
        for (file_name, bytes) in appendix {
            let stem = file_name.split('.').next().unwrap_or(&file_name);
            let label = format!("图片 {}", stem);
            let image_markdown = format!("![{}](markflow-asset-{})", label, file_name);
            markdown.push_str(&image_markdown);
            markdown.push('\n');
            extracted.push(ExtractedImage { file_name, image_markdown, fallback_text: label, bytes });
        }
    }
    (extracted, skipped)
}

/// 判断 Windows 盘符开头的绝对路径（与前端 imageReferenceForDocument 一致）。
fn is_windows_absolute(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && (bytes[2] == b'\\' || bytes[2] == b'/')
}

/// 与前端 fileUrlFromPath 一致的 file:// URL 生成。
fn file_url_from_path(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let prefix = if normalized.starts_with('/') { "file://" } else { "file:///" };
    let readable = normalized.replace('%', "%25").replace('#', "%23").replace('?', "%3F");
    format!("{prefix}{readable}")
}

/// 生成 Markdown 图片引用：优先相对路径，跨盘时回退 file:// URL，含空白或括号时加尖括号。
fn markdown_image_reference(md_target: &str, image_path: &str) -> String {
    let base = Path::new(md_target).parent().unwrap_or_else(|| Path::new(""));
    let relative = pathdiff::diff_paths(Path::new(image_path), base);
    let Some(relative) = relative else {
        return file_url_from_path(image_path);
    };
    let text = relative.to_string_lossy();
    if is_windows_absolute(&text) {
        return file_url_from_path(image_path);
    }
    let normalized = text.replace('\\', "/");
    if normalized.chars().any(|c| c.is_whitespace() || c == '(' || c == ')') {
        format!("<{normalized}>")
    } else {
        normalized
    }
}

/// 把占位引用落盘为真实图片文件，并在 Markdown 中替换成相对引用。
fn finalize_image_references(
    markdown: &mut String,
    images: &[ExtractedImage],
    directory: &Path,
    md_target: &str,
) -> (usize, usize) {
    let mut written = 0usize;
    let mut skipped = 0usize;
    for image in images {
        match store_image_bytes(directory, &image.file_name, &image.bytes, true) {
            Ok(result) => {
                written += 1;
                let reference = markdown_image_reference(md_target, &result.path);
                let marker = format!("](markflow-asset-{})", image.file_name);
                let replacement = format!("]({reference})");
                while let Some(position) = markdown.find(&marker) {
                    markdown.replace_range(position..position + marker.len(), &replacement);
                }
            }
            Err(_) => {
                skipped += 1;
                while let Some(position) = markdown.find(&image.image_markdown) {
                    markdown.replace_range(
                        position..position + image.image_markdown.len(),
                        &image.fallback_text,
                    );
                }
            }
        }
    }
    (written, skipped)
}

/// 把办公文档（Word/PowerPoint/Excel/ODF/RTF/EPUB/CSV/PDF）转换成 Markdown。
/// 有内嵌图片且提供了 imageDirectory/mdTarget 时，图片会外置到图片目录并写相对引用。
#[tauri::command]
fn convert_office_to_markdown(
    path: String,
    image_directory: Option<String>,
    md_target: Option<String>,
) -> Result<OfficeConversion, ConvertFailure> {
    let bytes =
        fs::read(&path).map_err(|error| convert_failure("io", format!("读取文件失败：{error}")))?;
    let format = AnyDocFormat::from_bytes(&bytes)
        .or_else(|| AnyDocFormat::from_path(Path::new(&path)))
        .ok_or_else(|| convert_failure("unsupported", "无法识别该文件格式，暂不支持转换"))?;
    let label = anydoc_format_label(format).to_string();

    if format == AnyDocFormat::Pdf {
        let markdown = anydoc::to_markdown_bytes(&bytes, format).map_err(map_anydoc_error)?;
        return Ok(OfficeConversion {
            markdown: markdown.trim_end().to_string(),
            format: label,
            image_count: 0,
            skipped_images: 0,
        });
    }

    let document = anydoc::to_document(&bytes, format).map_err(map_anydoc_error)?;
    let mut markdown = anydoc::to_markdown_bytes(&bytes, format).map_err(map_anydoc_error)?;

    let extract = image_directory.is_some() && md_target.is_some();
    let (images, mut skipped_images) =
        externalize_document_images(&document, &mut markdown, extract);

    let mut image_count = 0usize;
    if let (Some(directory), Some(target)) = (image_directory.as_deref(), md_target.as_deref()) {
        let (written, skipped) =
            finalize_image_references(&mut markdown, &images, Path::new(directory), target);
        image_count = written;
        skipped_images += skipped;
    }

    Ok(OfficeConversion {
        markdown: markdown.trim_end().to_string(),
        format: label,
        image_count,
        skipped_images,
    })
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

    #[test]
    fn path_exists_tracks_deleted_file() {
        let root = test_directory("path-exists");
        fs::create_dir_all(&root).unwrap();
        let file = root.join("document.md");
        fs::write(&file, "content").unwrap();
        assert!(path_exists(file.to_string_lossy().to_string()));
        fs::remove_file(&file).unwrap();
        assert!(!path_exists(file.to_string_lossy().to_string()));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn csv_file_converts_to_markdown_table() {
        let directory = test_directory("csv");
        fs::create_dir_all(&directory).unwrap();
        let csv = directory.join("数据.csv");
        fs::write(&csv, "姓名,分数\n张三,90\n李四,85\n").unwrap();
        let result = convert_office_to_markdown(csv.to_string_lossy().to_string(), None, None).unwrap();
        assert!(result.markdown.contains("张三"));
        assert!(result.markdown.contains("李四"));
        assert!(result.markdown.contains('|'));
        assert_eq!(result.image_count, 0);
        assert!(result.format.contains("CSV"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn unsupported_file_reports_friendly_code() {
        let directory = test_directory("unsupported");
        fs::create_dir_all(&directory).unwrap();
        let file = directory.join("notes.txt");
        fs::write(&file, "hello").unwrap();
        let result = convert_office_to_markdown(file.to_string_lossy().to_string(), None, None);
        let failure = result.unwrap_err();
        assert_eq!(failure.code, "unsupported");
        fs::remove_dir_all(directory).unwrap();
    }

    /// 构造一个带一张内嵌图片的最小 docx，验证 anydoc 提取 + 图片外置 + 相对引用。
    fn minimal_docx_with_image() -> Vec<u8> {
        use std::io::Write;
        let cursor = std::io::Cursor::new(Vec::new());
        let mut zip = zip::ZipWriter::new(cursor);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        let content_types = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"#;
        let root_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#;
        let document_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>"#;
        let document_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body>
<w:p><w:r><w:t>前文</w:t></w:r></w:p>
<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Picture 1" descr="示意图"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
<w:p><w:r><w:t>后文</w:t></w:r></w:p>
</w:body>
</w:document>"#;
        let styles_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults/></w:styles>"#;
        let png: [u8; 16] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0];
        zip.start_file("[Content_Types].xml", options).unwrap();
        zip.write_all(content_types.as_bytes()).unwrap();
        zip.start_file("_rels/.rels", options).unwrap();
        zip.write_all(root_rels.as_bytes()).unwrap();
        zip.start_file("word/document.xml", options).unwrap();
        zip.write_all(document_xml.as_bytes()).unwrap();
        zip.start_file("word/_rels/document.xml.rels", options).unwrap();
        zip.write_all(document_rels.as_bytes()).unwrap();
        zip.start_file("word/styles.xml", options).unwrap();
        zip.write_all(styles_xml.as_bytes()).unwrap();
        zip.start_file("word/media/image1.png", options).unwrap();
        zip.write_all(&png).unwrap();
        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn docx_images_externalize_to_asset_directory() {
        let directory = test_directory("docx-images");
        fs::create_dir_all(&directory).unwrap();
        let docx = directory.join("带图文档.docx");
        fs::write(&docx, minimal_docx_with_image()).unwrap();
        let assets = directory.join("assets");
        let md = directory.join("输出.md");
        let result = convert_office_to_markdown(
            docx.to_string_lossy().to_string(),
            Some(assets.to_string_lossy().to_string()),
            Some(md.to_string_lossy().to_string()),
        )
        .unwrap();
        assert!(result.markdown.contains("前文"));
        assert!(result.markdown.contains("后文"));
        assert!(result.markdown.contains("![示意图](assets/image-001.png)"));
        assert_eq!(result.image_count, 1);
        assert_eq!(result.skipped_images, 0);
        assert!(assets.join("image-001.png").exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn image_alt_with_special_characters_replaces_correctly() {
        use anydoc::model::{Asset, AssetId, Block, Document, ImageSource, Inline};
        let document = Document {
            blocks: vec![Block::Paragraph(vec![
                Inline::plain("开头"),
                Inline::Image { alt: "图 *片*".into(), source: ImageSource::Asset(AssetId(0)) },
                Inline::plain("结尾"),
            ])],
            notes: vec![],
            assets: vec![Asset {
                id: AssetId(0),
                media_type: "image/png".into(),
                origin_part: "word/media/image1.png".into(),
                bytes: vec![1, 2, 3],
            }],
        };
        // anydoc 渲染器输出的转义形式：第一个 * 前加反斜杠，末尾的 * 保持原样
        let mut markdown = "开头图 \\*片* 结尾".to_string();
        let (images, skipped) = externalize_document_images(&document, &mut markdown, true);
        assert_eq!(skipped, 0);
        assert_eq!(images.len(), 1);
        assert_eq!(markdown, "开头![图 \\*片*](markflow-asset-image-001.png) 结尾");
    }

    #[test]

    /// 调试用：把环境变量 MARKFLOW_TEST_DOCX 指向真实 docx，模拟工作区布局完整转换一次。
    #[test]
    fn convert_external_docx_via_env() {
        let Ok(path) = std::env::var("MARKFLOW_TEST_DOCX") else { return; };
        let source = Path::new(&path);
        assert!(source.exists(), "环境变量指向的文档不存在：{path}");
        let workspace = source.parent().unwrap().parent().unwrap();
        let img_root = workspace.join("img");
        fs::create_dir_all(&img_root).unwrap();
        let md_target = workspace.join("docs").join("转换结果.md");
        fs::create_dir_all(md_target.parent().unwrap()).unwrap();
        let image_dir = img_root.join("docs").join("转换结果.assets");

        let result = convert_office_to_markdown(
            source.to_string_lossy().to_string(),
            Some(image_dir.to_string_lossy().to_string()),
            Some(md_target.to_string_lossy().to_string()),
        )
        .unwrap_or_else(|error| panic!("转换失败 {:?}: {}", error.code, error.message));

        println!("=== FORMAT: {} | images: {} | skipped: {} ===", result.format, result.image_count, result.skipped_images);
        println!("{}", result.markdown);
        if image_dir.exists() {
            for entry in fs::read_dir(&image_dir).unwrap() {
                println!("ASSET: {:?}", entry.unwrap().path());
            }
        }
        let base = md_target.parent().unwrap();
        for reference in extract_image_refs(&result.markdown) {
            if reference.starts_with("file:") { continue; }
            let resolved = base.join(&reference);
            println!("REF: {reference} -> {} ({})", resolved.display(), if resolved.exists() { "存在" } else { "缺失!" });
        }
    }

    /// 从 Markdown 中抽出所有图片引用（去掉尖括号）。
    fn extract_image_refs(markdown: &str) -> Vec<String> {
        let mut refs = Vec::new();
        let mut rest = markdown;
        while let Some(start) = rest.find("![") {
            rest = &rest[start + 2..];
            let Some(open) = rest.find("](") else { break };
            let Some(close) = rest[open + 2..].find(')') else { break };
            let mut reference = rest[open + 2..open + 2 + close].to_string();
            if reference.starts_with('<') && reference.ends_with('>') {
                reference = reference[1..reference.len() - 1].to_string();
            }
            refs.push(reference);
            rest = &rest[open + 2 + close..];
        }
        refs
    }

    fn image_without_alt_stays_at_its_position() {
        use anydoc::model::{Asset, AssetId, Block, Document, ImageSource, Inline};
        let document = Document {
            blocks: vec![Block::Paragraph(vec![
                Inline::plain("只有文字"),
                Inline::Image { alt: String::new(), source: ImageSource::Asset(AssetId(0)) },
            ])],
            notes: vec![],
            assets: vec![Asset {
                id: AssetId(0),
                media_type: "image/png".into(),
                origin_part: "word/media/image1.png".into(),
                bytes: vec![1, 2, 3],
            }],
        };
        let mut markdown = "只有文字".to_string();
        let (images, skipped) = externalize_document_images(&document, &mut markdown, true);
        assert_eq!(skipped, 0);
        assert_eq!(images.len(), 1);
        // 图片应插在“只有文字”之后，而不是被丢到文末附录
        assert_eq!(markdown, "只有文字![图片 image-001](markflow-asset-image-001.png)");
        assert!(!markdown.contains("无法还原到原文位置"));
    }

    #[test]
    fn image_only_paragraph_lands_between_neighbour_blocks() {
        use anydoc::model::{Asset, AssetId, Block, Document, ImageSource, Inline};
        let document = Document {
            blocks: vec![
                Block::Paragraph(vec![Inline::plain("前一段落")]),
                Block::Paragraph(vec![Inline::Image {
                    alt: String::new(),
                    source: ImageSource::Asset(AssetId(0)),
                }]),
                Block::Paragraph(vec![Inline::plain("后一段落")]),
            ],
            notes: vec![],
            assets: vec![Asset {
                id: AssetId(0),
                media_type: "image/png".into(),
                origin_part: "word/media/image1.png".into(),
                bytes: vec![1, 2, 3],
            }],
        };
        // 模拟渲染器输出：图片独占段落被完全省略，只剩两个文字段落
        let mut markdown = "前一段落\n\n后一段落".to_string();
        let (images, skipped) = externalize_document_images(&document, &mut markdown, true);
        assert_eq!(skipped, 0);
        assert_eq!(images.len(), 1);
        // 图片应出现在两个段落之间，而不是文末
        assert_eq!(
            markdown,
            "前一段落\n\n![图片 image-001](markflow-asset-image-001.png)\n\n后一段落"
        );
    }

    #[test]
    fn image_between_text_runs_stays_inline() {
        use anydoc::model::{Asset, AssetId, Block, Document, ImageSource, Inline};
        let document = Document {
            blocks: vec![Block::Paragraph(vec![
                Inline::plain("看图"),
                Inline::Image { alt: String::new(), source: ImageSource::Asset(AssetId(0)) },
                Inline::plain("然后继续阅读"),
            ])],
            notes: vec![],
            assets: vec![Asset {
                id: AssetId(0),
                media_type: "image/png".into(),
                origin_part: "word/media/image1.png".into(),
                bytes: vec![1, 2, 3],
            }],
        };
        let mut markdown = "看图然后继续阅读".to_string();
        let (images, skipped) = externalize_document_images(&document, &mut markdown, true);
        assert_eq!(skipped, 0);
        assert_eq!(images.len(), 1);
        assert_eq!(markdown, "看图![图片 image-001](markflow-asset-image-001.png)然后继续阅读");
    }
}


fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            path_exists,
            read_file_bytes,
            write_text_file,
            write_existing_text_file,
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
            convert_office_to_markdown,
        ])
        .run(tauri::generate_context!())
        .expect("运行 MarkFlow 时出错");
}
