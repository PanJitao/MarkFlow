# MarkFlow 官网部署

正式域名：`https://markflow.wuhupan.top`。2026-11-04 已部署；修改本地源码不会自动更新线上站点。

## 发布方式

官网沿用现有 Nginx 与 HTTPS 配置。连接信息保存在本机发布环境，不随公开源码发布。先备份当前文件，上传并核对签名安装包及静态资源，再切换页面引用；旧版安装包链接继续保留。截图使用带版本的 PNG 文件名，避免旧资源缓存。

## 文件

- `index.html`：产品首页。
- `mcp/index.html`：宠物 MCP 接入说明与可复制 AI 指令。
- `mcp/ai.txt`：AI 可直接读取的操作指南。
- `mcp/pet.schema.json`、`mcp/protocol.json`：从软件运行时源文件复制的规范。
- `assets/`：页面样式、交互和真实软件截图。
- `downloads/MarkFlow_0.4.5_x64-setup.exe`：Windows 0.4.5 正式安装包。

安装包不入 Git；从 [v0.4.5 发布页](https://github.com/PanJitao/MarkFlow/releases/tag/v0.4.5) 下载 CI 签名产物后，补入上述路径。不要用之前同版本的本地体验包替代正式产物。部署前后核对完整文件 SHA-256，并验证 `.sig` 与更新清单中的签名。

## 本地查看

在 rebuild 目录运行：

```powershell
python -m http.server 8124 --bind 127.0.0.1 --directory web
```

访问 `http://127.0.0.1:8124/` 与 `http://127.0.0.1:8124/mcp/`。

## 更新正式站点

1. 备份现有站点目录；将发布包解压到新的版本目录。
2. 沿用当前域名与 HTTPS 证书配置，将站点根目录切换到新版文件目录。Nginx 路由示例见 `nginx.example.conf`，不要用示例文件替换整份生产配置。
3. 确认 `/mcp/` 返回 HTML，`/mcp/ai.txt` 返回 UTF-8 文本，两个 JSON 规范文件可直接访问。未知地址应返回 404，不能统一重写成首页。
4. 确认 Windows 下载链接返回真实安装包，长度与 SHA-256 匹配；测试 Mac 发布页、导航、手机布局、截图放大与复制指令。
5. 如果使用 CDN，刷新首页、MCP 页面与样式脚本的缓存。检查成功后再移除旧版本目录。

AI 指令固定使用正式域名。每次更新后须检查公网实际内容与复制结果，不能只凭本地预览判定发布成功。

## 版本维护

首页展示 0.4.5 的功能，Windows 提供 CI 签名的正式安装包。macOS 指向 v0.4.5 预览构建，明确标注尚未完成 Developer ID 签名、公证与真机验证。

以后变更宠物协议时，需同步复制 `public/pet-api/schema.json` 和 `public/pet-api/protocol.json` 到 `web/mcp/`，并核对 `ai.txt` 与说明页。不要给网页加入本机用户路径、连接令牌或模型密钥。
