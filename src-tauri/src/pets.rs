use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::{BTreeMap, BTreeSet}, fs::{self, File, OpenOptions}, io::{Read, Write}, path::{Component, Path, PathBuf}, sync::Mutex};
use tauri::{Emitter, Manager};

pub const BUILTIN: &str = "dsh-blue";
const MAX_FILE: u64 = 64 * 1024 * 1024;
const MAX_PACK: u64 = 256 * 1024 * 1024;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Canvas { pub width: u32, pub height: u32 }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HitBox { pub x: f64, pub y: f64, pub width: f64, pub height: f64 }
impl Default for HitBox { fn default() -> Self { Self { x: 0., y: 0., width: 1., height: 1. } } }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Sprite { pub columns: u32, pub rows: u32, pub frames: u32, pub fps: f64 }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Clip { pub file: String, #[serde(skip_serializing_if = "Option::is_none")] pub fallback: Option<String>, pub duration_ms: u32, #[serde(skip_serializing_if = "Option::is_none")] pub sprite: Option<Sprite> }
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Phrases { pub greeting: String, pub tap: Vec<String>, pub idle: Vec<String> }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Pet {
    pub version: u32, pub id: String, pub name: String,
    #[serde(default)] pub description: String,
    #[serde(default)] pub author: String,
    #[serde(default)] pub license: String,
    pub canvas: Canvas, #[serde(default)] pub hit_box: HitBox, pub poster: String,
    pub clips: BTreeMap<String, Clip>, pub actions: BTreeMap<String, Vec<String>>,
    #[serde(default)] pub phrases: Phrases,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings { pub scale: f64, pub opacity: f64, pub speed: f64, pub flip: bool, pub bubble_color: String, pub idle_chat: bool, pub greeting: String }
impl Default for Settings { fn default() -> Self { Self { scale: 1., opacity: 1., speed: 1., flip: false, bubble_color: "#fcfdff".into(), idle_chat: true, greeting: String::new() } } }
impl Settings {
    fn validate(&self) -> Result<(), String> {
        if !(0.5..=1.5).contains(&self.scale) || !(0.3..=1.).contains(&self.opacity) || !(0.5..=2.).contains(&self.speed) { return Err("大小需为 0.5–1.5，透明度 0.3–1，速度 0.5–2".into()); }
        if self.bubble_color.len() != 7 || !self.bubble_color.starts_with('#') || !self.bubble_color[1..].bytes().all(|c| c.is_ascii_hexdigit()) || self.greeting.chars().count() > 300 { return Err("气泡颜色需为 #RRGGBB，问候语最多 300 字".into()); } Ok(())
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Preferences { revision: u64, active_id: String, profiles: BTreeMap<String, Settings>, allow_mcp: bool }
impl Default for Preferences { fn default() -> Self { Self { revision: 0, active_id: BUILTIN.into(), profiles: BTreeMap::new(), allow_mcp: false } } }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetCommand { pub id: String, pub action: Option<String>, pub text: Option<String>, pub expires_at: i64 }
pub struct PetStore { pub directory: PathBuf, preferences: Mutex<Result<Preferences, String>>, command: Mutex<Option<PetCommand>>, _lock: Option<File> }
fn builtin_for_platform(platform: &str) -> Pet {
    let mut pet: Pet = serde_json::from_str(include_str!("../../public/pets/dsh-blue/pet.json")).expect("built-in pet manifest");
    for clip in pet.clips.values_mut() {
        if platform == "windows" { clip.fallback = Some(pet.poster.clone()); }
        else if platform == "macos" { clip.file = clip.fallback.take().expect("built-in WebP animation"); }
    }
    pet
}
pub fn builtin() -> Pet { builtin_for_platform(std::env::consts::OS) }
pub fn now_ms() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as i64 }
pub fn read_limited(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() { return Err("素材必须是普通文件".into()); }
    let mut bytes = Vec::new(); Read::by_ref(&mut file).take(limit + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit { return Err("文件超过大小限制".into()); } Ok(bytes)
}
fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| { let mut f = File::create(&temporary).map_err(|e| e.to_string())?; f.write_all(&serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?).and_then(|_| f.sync_all()).map_err(|e| e.to_string())?; drop(f); fs::rename(&temporary, path).map_err(|e| e.to_string()) })();
    if result.is_err() { let _ = fs::remove_file(temporary); } result
}
fn valid_id(id: &str) -> bool { !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') && id.as_bytes()[0].is_ascii_alphanumeric() }
fn valid_key(key: &str) -> bool { !key.is_empty() && key.len() <= 40 && key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') }
fn extension(file: &str) -> String { Path::new(file).extension().and_then(|x| x.to_str()).unwrap_or("").to_ascii_lowercase() }
fn is_image(file: &str) -> bool { ["png", "webp", "gif", "jpg", "jpeg"].contains(&extension(file).as_str()) }
fn asset_path(root: &Path, file: &str) -> Result<PathBuf, String> {
    let relative = Path::new(file);
    if file.is_empty() || file.contains(['\\', ':']) || !relative.components().all(|p| matches!(p, Component::Normal(_))) || !["png", "webp", "gif", "jpg", "jpeg", "webm", "mp4"].contains(&extension(file).as_str()) { return Err(format!("不支持的素材路径：{file}")); }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let path = root.join(relative).canonicalize().map_err(|e| format!("素材 {file} 不可读：{e}"))?;
    if !path.starts_with(&root) || !path.is_file() { return Err("素材必须位于宠物包内，不可引用外部文件".into()); } Ok(path)
}
fn files(pet: &Pet) -> BTreeSet<String> { let mut files = BTreeSet::from([pet.poster.clone()]); for clip in pet.clips.values() { files.insert(clip.file.clone()); if let Some(f) = &clip.fallback { files.insert(f.clone()); } } files }
fn dimensions(path: &Path) -> Result<(u32, u32), String> {
    let size = image::ImageReader::open(path).map_err(|e| e.to_string())?.with_guessed_format().map_err(|e| e.to_string())?.into_dimensions().map_err(|e| format!("图片无法识别：{e}"))?;
    if size.0 == 0 || size.1 == 0 || size.0 as u64 * size.1 as u64 > 32 * 1024 * 1024 { return Err("图片像素总量超过 3200 万或尺寸无效".into()); } Ok(size)
}
pub fn validate(root: &Path, pet: &Pet) -> Result<Vec<String>, String> {
    if pet.version != 1 || !valid_id(&pet.id) || pet.id == BUILTIN || pet.name.trim().is_empty() || pet.name.chars().count() > 80 { return Err("宠物包需为 version 1，名称 1–80 字，id 使用小写英文、数字和连字符，且不能占用内置宠物".into()); }
    if pet.description.chars().count() > 1000 || pet.author.len() > 300 || pet.license.len() > 1000 || pet.phrases.greeting.chars().count() > 300 || pet.phrases.tap.len() + pet.phrases.idle.len() > 40 || pet.phrases.tap.iter().chain(&pet.phrases.idle).any(|s| s.chars().count() > 300) { return Err("说明或互动文案过长".into()); }
    let c = &pet.canvas; let ratio = c.width as f64 / c.height as f64;
    if !(32..=4096).contains(&c.width) || !(32..=4096).contains(&c.height) || !(0.5..=2.5).contains(&ratio) { return Err("单帧尺寸需为 32–4096，宽高比需在 0.5–2.5 之间".into()); }
    let h = &pet.hit_box;
    if ![h.x, h.y, h.width, h.height].iter().all(|v| v.is_finite() && (0.0..=1.).contains(v)) || h.width <= 0. || h.height <= 0. || h.x + h.width > 1.00001 || h.y + h.height > 1.00001 { return Err("hitBox 需为画布内的 0–1 归一化矩形".into()); }
    if pet.clips.is_empty() || pet.clips.len() > 64 || pet.actions.len() > 32 || !pet.actions.contains_key("idle") || !is_image(&pet.poster) { return Err("需包含图片封面、idle 动作；最多 64 个片段和 32 个动作".into()); }
    for (key, references) in &pet.actions { if !valid_key(key) || references.is_empty() || references.len() > 32 || references.iter().any(|k| !pet.clips.contains_key(k)) { return Err(format!("动作 {key} 引用了无效片段")); } }
    let mut total = 0; let mut warnings = Vec::new();
    for file in files(pet) {
        let path = asset_path(root, &file)?; let size = fs::metadata(&path).map_err(|e| e.to_string())?.len(); total += size;
        if size == 0 || size > MAX_FILE || total > MAX_PACK { return Err("单个素材最多 64 MB，宠物包最多 256 MB，不可为空文件".into()); }
        if is_image(&file) { dimensions(&path)?; } else {
            let mut signature = [0u8; 12]; File::open(path).and_then(|mut f| f.read_exact(&mut signature)).map_err(|e| e.to_string())?;
            if (extension(&file) == "webm" && signature[..4] != [0x1a, 0x45, 0xdf, 0xa3]) || (extension(&file) == "mp4" && &signature[4..8] != b"ftyp") { return Err(format!("视频文件格式与扩展名不符：{file}")); }
        }
    }
    for (key, clip) in &pet.clips {
        if !valid_key(key) || !(100..=60000).contains(&clip.duration_ms) { return Err("片段名称无效或时长不在 100–60000 毫秒范围内".into()); }
        if let Some(f) = &clip.fallback { if !is_image(f) { return Err("fallback 需为 PNG / WebP / GIF / JPG 图片动画或图片".into()); } }
        if extension(&clip.file) == "webm" && clip.fallback.is_none() { warnings.push(format!("{key} 未提供图片动画 fallback，Mac 可能丢失透明度")); }
        if let Some(s) = &clip.sprite {
            if !["png", "webp"].contains(&extension(&clip.file).as_str()) || !(1..=32).contains(&s.columns) || !(1..=32).contains(&s.rows) || s.frames == 0 || s.frames > s.columns * s.rows || !(1.0..=60.0).contains(&s.fps) || s.frames as f64 / s.fps > 60. { return Err("精灵图需为 PNG/WebP，有效帧数、行列数和 1–60 FPS".into()); }
            if dimensions(&asset_path(root, &clip.file)?)? != (c.width * s.columns, c.height * s.rows) { return Err(format!("{key} 精灵图尺寸应等于单帧尺寸 × 行列数")); }
        }
    }
    Ok(warnings)
}
pub fn load_pack(path: &Path) -> Result<(PathBuf, Pet, Vec<String>), String> {
    let manifest = if path.is_dir() { path.join("pet.json") } else { path.to_path_buf() };
    let root = manifest.parent().ok_or("无效的宠物包路径")?.canonicalize().map_err(|e| e.to_string())?;
    let pet: Pet = serde_json::from_slice(&read_limited(&manifest, 128 * 1024)?).map_err(|e| format!("pet.json 格式无效：{e}"))?;
    let warnings = validate(&root, &pet)?; Ok((root, pet, warnings))
}
impl PetStore {
    pub fn open(directory: PathBuf) -> Self {
        let mut lock = None;
        let preferences = (|| {
            fs::create_dir_all(directory.join("pets")).map_err(|e| e.to_string())?;
            let f = OpenOptions::new().create(true).truncate(false).read(true).write(true).open(directory.join("pet-library.lock")).map_err(|e| e.to_string())?;
            f.try_lock().map_err(|_| "宠物库已在另一个 MarkFlow 进程中运行")?; lock = Some(f);
            let p = directory.join("pet-preferences.json");
            if !p.exists() { return Ok(Preferences::default()); }
            let data: Preferences = serde_json::from_slice(&read_limited(&p, 1024 * 1024)?).map_err(|_| "宠物设置无法读取，已保留原文件".to_string())?;
            for settings in data.profiles.values() { settings.validate()?; } Ok(data)
        })();
        Self { directory, preferences: Mutex::new(preferences), command: Mutex::new(None), _lock: lock }
    }
    fn preferences(&self) -> Result<Preferences, String> { self.preferences.lock().map_err(|_| "宠物设置不可用")?.clone() }
    fn update(&self, edit: impl FnOnce(&mut Preferences) -> Result<(), String>) -> Result<(), String> {
        let mut guard = self.preferences.lock().map_err(|_| "宠物设置不可用")?;
        let mut next = guard.as_ref().map_err(Clone::clone)?.clone(); edit(&mut next)?; next.revision += 1;
        write_json(&self.directory.join("pet-preferences.json"), &next)?; *guard = Ok(next); Ok(())
    }
    pub fn allowed(&self) -> bool { self.preferences().is_ok_and(|p| p.allow_mcp) }
    fn pet(&self, id: &str) -> Result<Pet, String> {
        if id == BUILTIN { return Ok(builtin()); }
        if !valid_id(id) { return Err("无效的宠物 ID".into()); }
        let (_, pet, _) = load_pack(&self.directory.join("pets").join(id))?;
        if pet.id != id { return Err("宠物目录与 ID 不一致".into()); } Ok(pet)
    }
    pub fn current(&self) -> Result<Value, String> {
        let p = self.preferences()?;
        let (pet, warning) = match self.pet(&p.active_id) { Ok(pet) => (pet, String::new()), Err(e) => (builtin(), format!("当前宠物不可用，已临时显示内置角色：{e}")) };
        let settings = p.profiles.get(&pet.id).cloned().unwrap_or_default();
        let command = self.command.lock().map_err(|_| "宠物动作不可用")?.clone().filter(|c| c.expires_at > now_ms());
        Ok(json!({"revision":p.revision,"pet":pet,"settings":settings,"command":command,"warning":warning}))
    }
    pub fn library(&self) -> Result<Value, String> {
        let p = self.preferences()?; let mut pets = vec![builtin()]; let mut warnings = Vec::new();
        for entry in fs::read_dir(self.directory.join("pets")).map_err(|e| e.to_string())?.flatten() {
            let id = entry.file_name().to_string_lossy().to_string(); if id.starts_with('.') { continue; }
            match self.pet(&id) { Ok(pet) => pets.push(pet), Err(e) => warnings.push(format!("{id}：{e}")) }
        }
        pets[1..].sort_by(|a,b| a.name.cmp(&b.name));
        let executable = std::env::current_exe().map_err(|e| e.to_string())?;
        Ok(json!({"pets":pets,"activeId":p.active_id,"profiles":p.profiles,"allowMcp":p.allow_mcp,"warnings":warnings,
            "mcpConfig":{"mcpServers":{"markflow-pet":{"command":executable,"args":["--pet-mcp","--data-dir",self.directory]}}},"tools":crate::pet_mcp::tools()}))
    }
    fn install(&self, path: &Path) -> Result<Value, String> {
        self.preferences()?;
        let (root, pet, warnings) = load_pack(path)?;
        let destination = self.directory.join("pets").join(&pet.id);
        if destination.exists() { return Err("同名 ID 的宠物已存在，请换一个 ID，或先在宠物库移除旧版本".into()); }
        let stage = self.directory.join("pets").join(format!(".import-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&stage).map_err(|e| e.to_string())?;
        let result = (|| {
            for file in files(&pet) { let target = stage.join(&file); fs::create_dir_all(target.parent().unwrap()).map_err(|e| e.to_string())?; let bytes = read_limited(&asset_path(&root, &file)?, MAX_FILE)?; fs::write(target, bytes).map_err(|e| e.to_string())?; }
            // Copy notices without executing or interpreting package content.
            for name in ["LICENSE.txt", "NOTICE.txt"] { let notice = root.join(name); if notice.is_file() && notice.canonicalize().is_ok_and(|p| p.starts_with(&root)) { fs::write(stage.join(name), read_limited(&notice, 128 * 1024)?).map_err(|e| e.to_string())?; } }
            write_json(&stage.join("pet.json"), &pet)?; validate(&stage, &pet)?;
            fs::rename(&stage, &destination).map_err(|e| e.to_string())?;
            Ok(json!({"id":pet.id,"name":pet.name,"warnings":warnings,"installed":true}))
        })();
        if stage.exists() { let _ = fs::remove_dir_all(&stage); } result
    }
    fn from_image(&self, args: &Value) -> Result<Value, String> {
        let path = PathBuf::from(required(args, "path")?); let name = required(args, "name")?;
        let id = args["id"].as_str().map(str::to_string).unwrap_or_else(|| format!("pet-{}", uuid::Uuid::new_v4()));
        if !valid_id(&id) || id == BUILTIN || !is_image(&path.to_string_lossy()) { return Err("请选择 PNG / WebP / GIF / JPG 图片，使用合法的宠物 ID".into()); }
        let bytes = read_limited(&path, MAX_FILE)?; let (width,height) = dimensions(&path)?;
        let sprite: Option<Sprite> = args.get("sprite").map(|v| serde_json::from_value(v.clone()).map_err(|e| e.to_string())).transpose()?;
        let (w,h) = match &sprite { Some(s) if s.columns > 0 && s.rows > 0 => (width / s.columns, height / s.rows), Some(_) => return Err("精灵图行列数不能为零".into()), None => (width,height) };
        let stage = self.directory.join("pets").join(format!(".image-{}", uuid::Uuid::new_v4())); fs::create_dir(&stage).map_err(|e| e.to_string())?;
        let result = (|| {
            let file = format!("character.{}", extension(&path.to_string_lossy())); fs::write(stage.join(&file), bytes).map_err(|e| e.to_string())?;
            let duration = sprite.as_ref().map(|s| (s.frames as f64 / s.fps * 1000.).round() as u32).unwrap_or(3000);
            let mut pet = Pet { version:1, id, name, description:"自定义素材宠物".into(), author:String::new(), license:String::new(), canvas:Canvas {width:w,height:h}, hit_box:HitBox::default(), poster:file.clone(), clips:BTreeMap::from([("idle".into(),Clip {file,fallback:None,duration_ms:duration,sprite})]), actions:BTreeMap::from([("idle".into(),vec!["idle".into()])]), phrases:Phrases::default() };
            validate(&stage,&pet)?;
            // A static first frame keeps reduced-motion mode and sprite posters correct.
            let image = image::load_from_memory(&read_limited(&stage.join(&pet.poster), MAX_FILE)?).map_err(|e| e.to_string())?;
            image.crop_imm(0,0,w,h).save(stage.join("poster.png")).map_err(|e| e.to_string())?; pet.poster = "poster.png".into();
            write_json(&stage.join("pet.json"), &pet)?; self.install(&stage)
        })();
        let _ = fs::remove_dir_all(stage); result
    }
}
pub fn required(args: &Value, key: &str) -> Result<String,String> { args[key].as_str().map(str::to_string).ok_or_else(|| format!("缺少字符串参数 {key}")) }
pub fn execute(app: &tauri::AppHandle, operation: &str, args: Value) -> Result<Value, String> {
    let store = app.state::<PetStore>();
    let result = match operation {
        "list" => store.library(), "current" => store.current(),
        "validate" => { let (_,pet,warnings) = load_pack(Path::new(&required(&args,"path")?))?; Ok(json!({"valid":true,"pet":pet,"warnings":warnings})) },
        "install" => store.install(Path::new(&required(&args,"path")?)),
        "from_image" => store.from_image(&args),
        "configure" => {
            let id = required(&args,"id")?; store.pet(&id)?;
            store.update(|p| {
                let mut settings = serde_json::to_value(p.profiles.get(&id).cloned().unwrap_or_default()).map_err(|e|e.to_string())?;
                if let Some(patch) = args.get("settings") { for (key,value) in patch.as_object().ok_or("settings 必须是对象")? { settings[key] = value.clone(); } }
                let settings:Settings = serde_json::from_value(settings).map_err(|e|e.to_string())?; settings.validate()?;
                p.profiles.insert(id.clone(),settings); if args["activate"].as_bool().unwrap_or(true) { p.active_id = id; } Ok(())
            })?; store.current()
        },
        "remove" => {
            let id=required(&args,"id")?; if id==BUILTIN { return Err("内置宠物不能移除".into()); } store.pet(&id)?;
            trash::delete(store.directory.join("pets").join(&id)).map_err(|e| e.to_string())?;
            store.update(|p| { p.profiles.remove(&id); if p.active_id==id { p.active_id=BUILTIN.into(); } Ok(()) })?; store.current()
        },
        "allow_mcp" => { let enabled=args["enabled"].as_bool().ok_or("enabled 必须是布尔值")?; store.update(|p| {p.allow_mcp=enabled; Ok(())})?; Ok(json!({"enabled":enabled})) },
        "show" => { crate::desktop_notes::enable_pet(app)?; Ok(json!({"visible":true})) },
        "perform" => {
            let current=store.current()?; let pet:Pet=serde_json::from_value(current["pet"].clone()).map_err(|e|e.to_string())?;
            let action=args.get("action").map(|_|required(&args,"action")).transpose()?;
            let text=args.get("text").map(|_|required(&args,"text")).transpose()?;
            if action.as_ref().is_some_and(|a| !pet.actions.contains_key(a)) { return Err("当前宠物没有这个动作，请先读取 pet_get_state 的 actions".into()); }
            if text.as_ref().is_some_and(|s|s.trim().is_empty() || s.chars().count()>300) || (action.is_none() && text.is_none()) { return Err("请提供有效动作或 1–300 字的文本".into()); }
            let command=PetCommand {id:uuid::Uuid::new_v4().to_string(),action,text,expires_at:now_ms()+30000};
            *store.command.lock().map_err(|_|"宠物动作不可用")?=Some(command.clone()); crate::desktop_notes::enable_pet(app)?;
            app.emit_to("desktop-pet","pet-command",&command).map_err(|e|e.to_string())?;
            Ok(json!({"status":"queued","command":command,"note":"待办提醒优先；空闲后执行，30 秒后过期。"}))
        },
        _ => Err("无效的宠物操作".into()),
    }?;
    if ["install","from_image","configure","remove","allow_mcp"].contains(&operation) {
        app.emit("pet-library-changed",()).map_err(|e|e.to_string())?;
        if let Ok(current)=store.current() { app.emit_to("desktop-pet","pet-updated",current).map_err(|e|e.to_string())?; }
    }
    Ok(result)
}
#[tauri::command]
pub async fn pet_request(app:tauri::AppHandle, operation:String, args:Value) -> Result<Value,String> { execute(&app,&operation,args) }
#[tauri::command]
pub fn pet_read_asset(app:tauri::AppHandle, id:String, file:String) -> Result<tauri::ipc::Response,String> {
    let store=app.state::<PetStore>(); let pet=store.pet(&id)?;
    if id==BUILTIN || !files(&pet).contains(&file) { return Err("该素材不属于自定义宠物".into()); }
    Ok(tauri::ipc::Response::new(read_limited(&asset_path(&store.directory.join("pets").join(id),&file)?,MAX_FILE)?))
}
#[tauri::command]
pub fn pet_resize(window:tauri::WebviewWindow,width:f64,height:f64) -> Result<(),String> {
    if window.label()!="desktop-pet" || !(320.0..=800.0).contains(&width) || !(320.0..=900.0).contains(&height) { return Err("宠物窗口尺寸无效".into()); }
    let position=window.outer_position().map_err(|e|e.to_string())?;
    window.set_size(tauri::LogicalSize::new(width,height)).map_err(|e|e.to_string())?;
    crate::desktop_notes::position_pet(&window,Some((position.x,position.y)))
}
pub fn open_settings(app:&tauri::AppHandle) -> Result<(),String> {
    if let Some(w)=app.get_webview_window("pet-settings") { return w.show().and_then(|_|w.set_focus()).map_err(|e|e.to_string()); }
    tauri::WebviewWindowBuilder::new(app,"pet-settings",tauri::WebviewUrl::App("pet-settings.html".into())).title("宠物样式与 AI 接入").inner_size(760.,760.).min_inner_size(600.,560.).center().build().map_err(|e|e.to_string())?; Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn platform_packages_keep_all_actions_and_available_media() {
        let original: Pet = serde_json::from_str(include_str!("../../public/pets/dsh-blue/pet.json")).unwrap();
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/pets/dsh-blue");
        for (platform, extension) in [("windows", "webm"), ("macos", "webp")] {
            let pet = builtin_for_platform(platform);
            assert_eq!(pet.clips.len(), 15);
            assert_eq!(pet.actions, original.actions);
            for (id, clip) in &pet.clips {
                assert!(clip.file.ends_with(extension));
                assert_eq!(clip.duration_ms, original.clips[id].duration_ms);
            }
            for file in files(&pet) { assert!(root.join(file).is_file()); }
            assert_eq!(files(&pet).len(), 16, "15 animations plus one poster; no duplicate format");
        }
    }
    fn root() -> PathBuf { let root=std::env::temp_dir().join(format!("markflow-pet-test-{}",uuid::Uuid::new_v4())); fs::create_dir_all(&root).unwrap(); root }
    fn package(root:&Path)->Pet {
        image::RgbaImage::new(64,64).save(root.join("pet.png")).unwrap();
        let pet:Pet=serde_json::from_value(json!({"version":1,"id":"test-pet","name":"测试宠物","canvas":{"width":64,"height":64},"poster":"pet.png","clips":{"idle":{"file":"pet.png","durationMs":1000}},"actions":{"idle":["idle"],"dance":["idle"]}})).unwrap();
        write_json(&root.join("pet.json"),&pet).unwrap(); pet
    }
    #[test]
    fn validates_media_actions_and_rejects_traversal() {
        let root=root(); let mut pet=package(&root); assert!(validate(&root,&pet).is_ok());
        pet.poster="../outside.png".into(); assert!(validate(&root,&pet).is_err());
        pet.poster="https://example.com/pet.png".into(); assert!(validate(&root,&pet).is_err());
        pet.poster="pet.svg".into(); assert!(validate(&root,&pet).is_err());
        pet.poster="pet.png".into(); pet.actions.insert("wave".into(),vec!["missing".into()]); assert!(validate(&root,&pet).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn rejects_invalid_sprite_and_hit_box() {
        let root=root(); let mut pet=package(&root);
        pet.clips.get_mut("idle").unwrap().sprite=Some(Sprite{columns:2,rows:1,frames:2,fps:12.}); assert!(validate(&root,&pet).is_err());
        pet.canvas.width=32; assert!(validate(&root,&pet).is_ok());
        pet.clips.get_mut("idle").unwrap().sprite.as_mut().unwrap().frames=3; assert!(validate(&root,&pet).is_err());
        pet.clips.get_mut("idle").unwrap().sprite=None; pet.hit_box.x=0.9; assert!(validate(&root,&pet).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn install_is_self_contained_and_never_overwrites() {
        let source=root(); package(&source); let data=root(); let store=PetStore::open(data.clone());
        assert!(store.install(&source).is_ok()); assert!(store.install(&source).is_err());
        fs::remove_dir_all(source).unwrap(); assert!(store.pet("test-pet").is_ok());
        store.update(|p|{p.active_id="test-pet".into();p.profiles.insert("test-pet".into(),Settings{scale:1.3,..Default::default()});Ok(())}).unwrap();
        assert_eq!(store.current().unwrap()["settings"]["scale"],1.3); drop(store);
        let store=PetStore::open(data.clone()); assert_eq!(store.current().unwrap()["pet"]["id"],"test-pet");
        let second=PetStore::open(data.clone()); assert!(second.current().is_err()); drop(second); drop(store); fs::remove_dir_all(data).unwrap();
    }
    #[test]
    fn create_sprite_from_image_generates_static_poster() {
        let source=root(); image::RgbaImage::new(128,64).save(source.join("sprite.png")).unwrap(); let data=root(); let store=PetStore::open(data.clone());
        let result=store.from_image(&json!({"path":source.join("sprite.png"),"id":"sprite","name":"精灵","sprite":{"columns":2,"rows":1,"frames":2,"fps":10}})).unwrap();
        assert_eq!(result["id"],"sprite"); assert_eq!(dimensions(&data.join("pets/sprite/poster.png")).unwrap(),(64,64));
        assert!(store.from_image(&json!({"path":source.join("sprite.png"),"name":"坏参数","sprite":{"columns":0,"rows":1,"frames":2,"fps":10}})).is_err());
        drop(store); fs::remove_dir_all(data).unwrap(); fs::remove_dir_all(source).unwrap();
    }
    #[test]
    fn settings_bounds_and_corrupt_preferences_are_preserved() {
        assert!(Settings{scale:0.,..Default::default()}.validate().is_err());
        assert!(Settings{bubble_color:"red".into(),..Default::default()}.validate().is_err());
        let root=root(); fs::write(root.join("pet-preferences.json"),"broken").unwrap(); let store=PetStore::open(root.clone());
        assert!(store.current().is_err()); assert_eq!(fs::read_to_string(root.join("pet-preferences.json")).unwrap(),"broken");
        drop(store); fs::remove_dir_all(root).unwrap();
    }
}
