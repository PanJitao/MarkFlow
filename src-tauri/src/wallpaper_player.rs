use std::{collections::HashMap, fs, io::{Read, Seek, SeekFrom}, path::PathBuf, sync::{Mutex, atomic::{AtomicU64, Ordering}}};
use tauri::{http::{Request, Response}, Manager};

#[derive(Default)]
pub struct Players(Mutex<HashMap<String, PathBuf>>);
static NEXT_PLAYER: AtomicU64 = AtomicU64::new(1);

#[tauri::command]
pub fn open_wallpaper_player(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let project = super::wallpaper::get_wallpaper_project(path.clone())?;
    if !matches!(project["type"].as_str().unwrap_or("").to_ascii_lowercase().as_str(), "scene" | "web") {
        return Err("该项目不是场景或网页壁纸".into());
    }
    let root = PathBuf::from(path).canonicalize().map_err(|e| e.to_string())?.parent().ok_or("无效的项目目录")?.to_path_buf();
    let token = NEXT_PLAYER.fetch_add(1, Ordering::Relaxed).to_string();
    let state = app.state::<Players>();
    let mut players = state.0.lock().map_err(|_| "壁纸播放器暂不可用")?;
    if players.len() >= 32 { return Err("打开的壁纸过多，请关闭其他编辑器窗口后重试".into()); }
    players.insert(token.clone(), root);
    Ok(token)
}

#[tauri::command]
pub fn close_wallpaper_player(app: tauri::AppHandle, token: String) {
    if let Ok(mut players) = app.state::<Players>().0.lock() { players.remove(&token); }
}

fn decode_path(path: &str) -> Option<String> {
    let mut bytes = Vec::new();
    let mut chars = path.bytes();
    while let Some(ch) = chars.next() {
        if ch == b'%' {
            let hi = (chars.next()? as char).to_digit(16)?;
            let lo = (chars.next()? as char).to_digit(16)?;
            bytes.push((hi * 16 + lo) as u8);
        } else { bytes.push(ch); }
    }
    String::from_utf8(bytes).ok()
}

fn mime(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "html" | "htm" => "text/html; charset=utf-8", "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8", "json" => "application/json", "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg", "gif" => "image/gif", "webp" => "image/webp", "svg" => "image/svg+xml",
        "avif" => "image/avif", "mp4" | "m4v" => "video/mp4", "webm" => "video/webm",
        "mp3" => "audio/mpeg", "ogg" => "audio/ogg", "wav" => "audio/wav",
        "woff" => "font/woff", "woff2" => "font/woff2", "ttf" => "font/ttf", "otf" => "font/otf",
        _ => "application/octet-stream",
    }
}

// Only selected wallpaper directories are exposed. The player is a separate,
// opaque-origin iframe: wallpaper scripts never get the editor's IPC or storage.
pub fn respond(app: &tauri::AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let origin = "wallpaper: wallpaper-media: http://wallpaper.localhost http://wallpaper-media.localhost https://wallpaper.localhost https://wallpaper-media.localhost";
    let csp = format!("default-src 'none'; script-src {origin} 'unsafe-inline' 'unsafe-eval' blob:; style-src {origin} 'unsafe-inline'; img-src {origin} data: blob:; media-src {origin} data: blob:; font-src {origin} data: blob:; connect-src {origin}; frame-src {origin} blob:; worker-src blob:; object-src 'none'; form-action 'none'");
    let response = Response::builder().header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Headers", "Range").header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        .header("Content-Security-Policy", csp).header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store");
    if request.method() == "OPTIONS" { return response.status(204).body(vec![]).unwrap(); }
    if request.method() != "GET" && request.method() != "HEAD" { return response.status(405).body(vec![]).unwrap(); }
    let Some(path) = decode_path(request.uri().path()) else { return response.status(400).body(vec![]).unwrap(); };
    let path = path.trim_start_matches('/');
    let Some((token, file)) = path.split_once('/') else { return response.status(404).body(vec![]).unwrap(); };
    let state = app.state::<Players>();
    let root = state.0.lock().ok().and_then(|p| p.get(token).cloned());
    let Some(root) = root else { return response.status(404).body(vec![]).unwrap(); };
    let built_in: Option<&[u8]> = match file {
        "player.html" => Some(include_bytes!("../../src/wallpaper-player/player.html")),
        "player.js" => Some(include_bytes!("../../src/wallpaper-player/player.js")),
        "engine.js" => Some(include_bytes!("../../node_modules/webwallgl/webwallgl.global.min.js")),
        _ => None,
    };
    if let Some(bytes) = built_in {
        return response.header("Content-Type", mime(file)).body(if request.method() == "HEAD" { vec![] } else { bytes.to_vec() }).unwrap();
    }
    let Some(relative) = file.strip_prefix("files/") else { return response.status(404).body(vec![]).unwrap(); };
    if relative == "project.json" {
        let project = super::wallpaper::get_wallpaper_project(root.join("project.json").to_string_lossy().to_string());
        return match project {
            Ok(project) => response.header("Content-Type", "application/json").body(project.to_string().into_bytes()).unwrap(),
            Err(_) => response.status(404).body(vec![]).unwrap(),
        };
    }
    let Some(path) = super::wallpaper::project_path(&root, relative).filter(|p| p.is_file()) else {
        return response.status(404).body(vec![]).unwrap();
    };
    let Ok(mut file) = fs::File::open(&path) else { return response.status(404).body(vec![]).unwrap(); };
    let Ok(metadata) = file.metadata() else { return response.status(500).body(vec![]).unwrap(); };
    let size = metadata.len();
    if size > 512 * 1024 * 1024 { return response.status(413).body(b"Wallpaper asset exceeds 512 MB".to_vec()).unwrap(); }
    let response = response.header("Content-Type", mime(relative)).header("Accept-Ranges", "bytes");
    let range = request.headers().get("Range").and_then(|v| v.to_str().ok());
    let (start, end, partial) = if let Some(range) = range {
        let pair = range.strip_prefix("bytes=").and_then(|r| r.split_once('-'));
        let parsed = pair.and_then(|(s, e)| Some((s.parse::<u64>().ok()?, if e.is_empty() { size.saturating_sub(1) } else { e.parse().ok()? })));
        match parsed {
            Some((s, e)) if s < size && e >= s => (s, e.min(size - 1), true),
            _ => return response.status(416).header("Content-Range", format!("bytes */{size}")).body(vec![]).unwrap(),
        }
    } else { (0, size.saturating_sub(1), false) };
    let length = if size == 0 { 0 } else { end - start + 1 };
    let mut bytes = Vec::new();
    if request.method() != "HEAD" && (file.seek(SeekFrom::Start(start)).is_err() || file.take(length).read_to_end(&mut bytes).is_err()) {
        return response.status(500).body(vec![]).unwrap();
    }
    let response = response.header("Content-Length", length.to_string());
    let response = if partial { response.status(206).header("Content-Range", format!("bytes {start}-{end}/{size}")) } else { response };
    response.body(bytes).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn url_paths_preserve_unicode_and_reject_bad_encoding() {
        assert_eq!(decode_path("1/files/%E4%B8%AD%E6%96%87%20a.png").unwrap(), "1/files/中文 a.png");
        assert!(decode_path("%ZZ").is_none());
        assert!(decode_path("%ff").is_none());
    }
}
