use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::{fs::OpenOptions,io::{BufRead,BufReader,Read,Write},net::{TcpListener,TcpStream,SocketAddr},path::{Path,PathBuf},time::Duration};
use tauri::Manager;
use crate::pets::{PetStore,read_limited};
const MAX_MESSAGE:u64=256*1024;
const VERSION:&str="2025-11-25";
fn protocol()->Value { serde_json::from_str(include_str!("../../public/pet-api/protocol.json")).expect("pet protocol") }
pub fn tools()->Value { let mut tools=protocol()["tools"].clone(); for tool in tools.as_array_mut().unwrap() { tool.as_object_mut().unwrap().remove("operation"); } tools }
pub fn schema()->Value { json!({"schema":serde_json::from_str::<Value>(include_str!("../../public/pet-api/schema.json")).unwrap(),"template":protocol()["template"],"settingsSchema":protocol()["settingsSchema"],"notes":["A package is a folder containing pet.json and local media. Assets are copied into MarkFlow's library.","Only raster images, WebM and MP4 are accepted; no HTML, SVG, scripts or remote URLs.","Provide a static PNG poster and an alpha WebP fallback for transparent WebM on macOS.","Actions may use custom names. idle is required; missing standard actions fall back to idle.","Sprite sheets are row-major, uniformly sized cells. canvas is the size of one cell.","Limits: 64 MB per asset, 256 MB per pack, 64 clips, 32 actions."]}) }
fn generation(args:&Value)->Value {
    let mode=args["mode"].as_str().unwrap_or("image");
    let asset=match mode {
        "sprite"=>"Generate one transparent PNG sprite sheet, exactly 1024×1024 pixels, a 4×4 grid of 256×256 cells, 16 row-major frames at 8 fps, consistent character, scale, baseline and lighting. No gutters, labels, grid lines or background. Use pet_create_from_image with sprite={columns:4,rows:4,frames:16,fps:8}.",
        "clips"=>"Generate transparent 512×512 media for idle, wave, remind and sleep, maintaining character identity and baseline. Supply a static poster.png and animation WebP files. Each clip must have its actual durationMs (100–60000). Map those names in actions, save pet.json next to the files, validate and install the package.",
        _=>"Generate one transparent 512×512 PNG, full character visible, centered, with 10% safe margin, no text or background. Save it locally and pass its absolute path and desired name to pet_create_from_image. A still image does not contain frame animation; a sprite sheet or animated pack can add it later.",
    };
    json!({"description":args["description"],"mode":mode,"brief":asset,"workflow":["Use your connected image/video generation tool to create the requested artwork. MarkFlow does not call an AI model.","Save the generated assets on the same computer where MarkFlow runs.","Call pet_create_from_image, or pet_validate_pack then pet_install_pack.","Call pet_configure with the returned id, then pet_show; use pet_get_state to inspect the result."],"template":protocol()["template"]})
}
fn validate_args(value:&Value,schema:&Value)->Result<(),String> {
    match schema["type"].as_str() {
        Some("object")=>{ let value=value.as_object().ok_or("参数必须是对象")?;
            if let Some(required)=schema["required"].as_array() { for key in required { if !value.contains_key(key.as_str().unwrap()) {return Err(format!("缺少参数 {}",key));} } }
            for (key,value) in value { if let Some(property)=schema["properties"].get(key) {validate_args(value,property).map_err(|e|format!("{key}: {e}"))?;} else {return Err(format!("未知参数 {key}"));} }
        },
        Some("string")=>{ let text=value.as_str().ok_or("必须是字符串")?; let len=text.chars().count() as u64;
            if schema["minLength"].as_u64().is_some_and(|n|len<n) || schema["maxLength"].as_u64().is_some_and(|n|len>n) {return Err("字符串长度超出限制".into());}
        },
        Some("boolean")=>{if !value.is_boolean(){return Err("必须是布尔值".into());}},
        Some("number")|Some("integer")=>{let n=value.as_f64().ok_or("必须是数字")?;
            if !n.is_finite() || (schema["type"]=="integer" && n.fract()!=0.) || schema["minimum"].as_f64().is_some_and(|v|n<v) || schema["maximum"].as_f64().is_some_and(|v|n>v) {return Err("数字超出范围或格式无效".into());}
        },_=>{},
    }
    if schema["enum"].as_array().is_some_and(|choices|!choices.contains(value)) {return Err("选项无效".into());} Ok(())
}
fn read_line(reader:&mut impl BufRead)->Result<Option<Value>,String> {
    let mut bytes=Vec::new(); let size=reader.take(MAX_MESSAGE+1).read_until(b'\n',&mut bytes).map_err(|e|e.to_string())?;
    if size==0 {return Ok(None);} if size as u64>MAX_MESSAGE {return Err("Message exceeds 256 KB".into());}
    serde_json::from_slice(&bytes).map(Some).map_err(|e|e.to_string())
}
fn write_line(writer:&mut impl Write,value:&Value)->Result<(),String> {serde_json::to_writer(&mut *writer,value).map_err(|e|e.to_string())?; writer.write_all(b"\n").and_then(|_|writer.flush()).map_err(|e|e.to_string())}
#[derive(Serialize,Deserialize)]
struct Endpoint {port:u16,token:String}
pub fn start(app:&tauri::AppHandle) {
    let store=app.state::<PetStore>(); if store.current().is_err(){return;}
    let directory=store.directory.clone(); let app=app.clone();
    std::thread::spawn(move || {
        let result=(||->Result<(),String>{
            let listener=TcpListener::bind(("127.0.0.1",0)).map_err(|e|e.to_string())?;
            let endpoint=Endpoint {port:listener.local_addr().map_err(|e|e.to_string())?.port(),token:format!("{}{}",uuid::Uuid::new_v4().simple(),uuid::Uuid::new_v4().simple())};
            let mut options=OpenOptions::new(); options.create(true).truncate(true).write(true);
            #[cfg(unix)] {use std::os::unix::fs::OpenOptionsExt; options.mode(0o600);}
            let mut file=options.open(directory.join("pet-bridge.json")).map_err(|e|e.to_string())?;
            serde_json::to_writer(&mut file,&endpoint).map_err(|e|e.to_string())?; file.sync_all().map_err(|e|e.to_string())?; drop(file);
            // One bounded local request at a time. No HTTP or public listener is exposed.
            for connection in listener.incoming() {
                let Ok(mut stream)=connection else {continue;};
                let _=stream.set_read_timeout(Some(Duration::from_secs(3))); let _=stream.set_write_timeout(Some(Duration::from_secs(5)));
                let response=(||->Result<Value,String>{
                    let request=read_line(&mut BufReader::new(&mut stream))?.ok_or("Empty request")?;
                    if request["token"].as_str()!=Some(&endpoint.token) {return Err("Invalid local session".into());}
                    if !app.state::<PetStore>().allowed() {return Err("请在「宠物样式与 AI 接入」中开启「允许 MCP 控制宠物」".into());}
                    let name=crate::pets::required(&request,"name")?;
                    let definition=protocol()["tools"].as_array().unwrap().iter().find(|t|t["name"]==name).cloned().ok_or("Unknown pet tool")?;
                    validate_args(&request["args"],&definition["inputSchema"])?;
                    let value=crate::pets::execute(&app,definition["operation"].as_str().unwrap(),request["args"].clone())?;
                    use tauri::Emitter; let _=app.emit_to("pet-settings","pet-mcp-activity",json!({"tool":name,"at":crate::pets::now_ms()}));
                    Ok(value)
                })();
                let response=match response {Ok(value)=>json!({"result":value}),Err(error)=>json!({"error":error})}; let _=write_line(&mut stream,&response);
            } Ok(())
        })(); if let Err(error)=result {eprintln!("Pet bridge: {error}");}
    });
}
fn call(directory:&Path,name:&str,args:Value)->Result<Value,String> {
    let endpoint:Endpoint=serde_json::from_slice(&read_limited(&directory.join("pet-bridge.json"),4096).map_err(|_|"请先打开 MarkFlow，并启用宠物的 MCP 控制")?).map_err(|_|"MarkFlow 连接信息暂不可用，请稍后重试")?;
    let address=SocketAddr::from(([127,0,0,1],endpoint.port));
    let mut stream=TcpStream::connect_timeout(&address,Duration::from_secs(2)).map_err(|_|"MarkFlow 未运行，请打开软件后重试")?;
    stream.set_read_timeout(Some(Duration::from_secs(30))).map_err(|e|e.to_string())?; stream.set_write_timeout(Some(Duration::from_secs(5))).map_err(|e|e.to_string())?;
    write_line(&mut stream,&json!({"token":endpoint.token,"name":name,"args":args}))?;
    let response=read_line(&mut BufReader::new(stream)).map_err(|e|format!("连接中断，操作结果未知，请先查询宠物状态再重试：{e}"))?.ok_or("连接已关闭")?;
    if let Some(error)=response["error"].as_str(){return Err(error.into());} Ok(response["result"].clone())
}
pub fn run_stdio(directory:PathBuf)->Result<(),String> {
    let stdin=std::io::stdin(); let stdout=std::io::stdout(); let mut input=stdin.lock(); let mut output=stdout.lock(); let mut initialized=false;
    loop {
        let request=match read_line(&mut input) {Ok(Some(value))=>value,Ok(None)=>break,Err(error)=>{write_line(&mut output,&json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":error}}))?;break;}};
        let id=request.get("id").cloned(); let method=request["method"].as_str();
        if request["jsonrpc"]!="2.0" || method.is_none() {write_line(&mut output,&json!({"jsonrpc":"2.0","id":id,"error":{"code":-32600,"message":"Invalid Request"}}))?;continue;}
        let Some(id)=id else {continue;};
        let mut error_code=-32602;
        let result:Result<Value,String>=match method.unwrap() {
            "initialize"=>{
                if !request["params"]["protocolVersion"].is_string() || !request["params"]["capabilities"].is_object() || !request["params"]["clientInfo"].is_object() {Err("Invalid initialization parameters".into())} else {
                    initialized=true; let requested=request["params"]["protocolVersion"].as_str().unwrap();
                    let version=if [VERSION,"2025-06-18","2025-03-26","2024-11-05"].contains(&requested){requested}else{VERSION};
                    Ok(json!({"protocolVersion":version,"capabilities":{"tools":{}},"serverInfo":{"name":"markflow-pet","version":env!("CARGO_PKG_VERSION")},"instructions":"Generate artwork with your own image tools. Use pet_prepare_generation for the brief, install local assets, then activate the pet. MarkFlow must be running and MCP control enabled. This server does not access editor documents, notes, model credentials, or the network."}))
                }
            },
            "ping"=>Ok(json!({})),
            _ if !initialized=>Err("Initialize first".into()),
            "tools/list"=>Ok(json!({"tools":tools()})),
            "tools/call"=>{
                let name=request["params"]["name"].as_str().unwrap_or(""); let args=request["params"].get("arguments").cloned().unwrap_or(json!({}));
                let definition=protocol()["tools"].as_array().unwrap().iter().find(|t|t["name"]==name).cloned();
                match definition {
                    None=>Err("Unknown tool".into()),
                    Some(definition)=>match validate_args(&args,&definition["inputSchema"]) {
                        Err(error)=>Err(error),
                        Ok(())=>{let value=match definition["operation"].as_str().unwrap() {"schema"=>Ok(schema()),"generation"=>Ok(generation(&args)),_=>call(&directory,name,args)};
                            Ok(match value {Ok(value)=>json!({"content":[{"type":"text","text":serde_json::to_string_pretty(&value).unwrap()}],"structuredContent":value,"isError":false}),Err(error)=>json!({"content":[{"type":"text","text":error}],"isError":true})})
                        }
                    }
                }
            },
            _=>{error_code=-32601;Err("Method not found".into())},
        };
        write_line(&mut output,&match result {Ok(result)=>json!({"jsonrpc":"2.0","id":id,"result":result}),Err(message)=>json!({"jsonrpc":"2.0","id":id,"error":{"code":error_code,"message":message}})})?;
    } Ok(())
}
pub fn data_directory(args:&[String])->Result<PathBuf,String> {
    if let Some(index)=args.iter().position(|a|a=="--data-dir") {return args.get(index+1).map(PathBuf::from).filter(|p|p.is_absolute()).ok_or("--data-dir needs an absolute path".into());}
    #[cfg(windows)] let root=PathBuf::from(std::env::var_os("APPDATA").ok_or("APPDATA is unavailable")?);
    #[cfg(target_os="macos")] let root=PathBuf::from(std::env::var_os("HOME").ok_or("Home directory is unavailable")?).join("Library/Application Support");
    #[cfg(not(any(windows,target_os="macos")))] let root=match std::env::var_os("XDG_DATA_HOME") {Some(root)=>PathBuf::from(root),None=>PathBuf::from(std::env::var_os("HOME").ok_or("Home directory is unavailable")?).join(".local/share")};
    Ok(root.join("com.exchangemd.app"))
}
