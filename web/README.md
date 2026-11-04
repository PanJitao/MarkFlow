# MarkFlow 官网与宠物 MCP 文档

2026-11-04 通过本机已注册的 OpenDesign MCP 生成首页与 MCP 页面，再接入当前软件实拍、运行时规范和 Windows 安装包。原生 HTML、CSS、JavaScript，无构建步骤、外部字体或 CDN 依赖。正式站点已部署到 `https://markflow.wuhupan.top`；发布配置见 `DEPLOY.md`。

## 本地预览

在 `rebuild` 目录执行：

```powershell
python -m http.server 8124 --bind 127.0.0.1 --directory web
```

打开 <http://127.0.0.1:8124/> 与 <http://127.0.0.1:8124/mcp/>。部署包解压后，在包目录执行 `python -m http.server 8124 --bind 127.0.0.1` 即可预览。

## 页面与素材

- `index.html`：编辑与预览、文件树与命令、外观与壁纸、格式转换、便签提醒、自定义宠物、Windows/macOS 下载。
- `mcp/index.html`：角色描述、完整 AI 指令复制、接入步骤、11 个实际工具和折叠的高级规范。
- `mcp/ai.txt`：供外部 AI 读取的操作指南。`pet.schema.json` 与 `protocol.json` 分别与 `public/pet-api/` 的对应运行时文件一致。
- `assets/site.css`、`assets/site.js`：共享样式、指令复制和截图放大。
- `assets/img/current-*-hd.png`：当前 MarkFlow 0.4.5 Windows 原生窗口实拍，包括编辑器、转换菜单、外观设置、宠物设置、MCP 区域和待办提醒表单。使用系统窗口截图，以 PNG 保存原始像素，避免工具预览图的缩小和 JPEG 压缩；没有放大旧图或重绘界面。编辑器截图为 1638 × 1047，宠物窗口为 952 × 989，便签为 527 × 777。截图前将鼠标移到窗口外，待光圈与拖尾消失后截取；6 张截图均不含鼠标指针、光圈和本机完整路径，状态栏显示保存状态。页面图片与放大入口使用 `?v=20261104-clean` 更新缓存。示例文档位于 `docs/website-demo/`，未使用个人文档。提醒表单仅展示设置，截图后取消，未创建定时任务。
- 内置蓝发角色来自 dsh-pet，保留 `pet-LICENSE.txt`、`pet-NOTICE.txt` 与页面署名。

截图用于展示当前界面，不代表在本次官网工作中重新验证了全部文档转换或 Mac 原生功能。Windows 下载改为 0.4.5 CI 签名的正式安装包，macOS 指向 v0.4.5 预览构建；页面明确标注平台验证范围。

## 验证与交付

本次检查了桌面 1440 × 900、手机 390 × 844 的页面布局与横向溢出；验证角色描述更新、留空回退、鼠标及键盘复制、剪贴板文本一致、规范展开、截图放大、Escape 关闭与焦点返回。页面无控制台错误，所有引用图片可加载。

静态检查覆盖本地链接与锚点、11 个 MCP 工具与运行时一致、JSON 规范哈希、安装包 SHA-256。结果为 `output/website-audit.json`，页面预览保存在 `docs/website-preview/opendesign-*.jpg`。

正式发布前的无损截图更新中，17 个公开文件均通过 HTTPS 下载并与本地逐字节核对，首页与 `/mcp/` 正常，旧 JPEG 地址与未知页面返回 404。Windows 安装包实际下载为 11,582,098 字节，SHA-256 与原构建一致。浏览器实测自定义描述的鼠标复制、留空默认指令的键盘复制，剪贴板内容均一致；首页与 MCP 截图放大链接指向 PNG 原图。HTTP 结果为 `output/website-live-hd-check.json`，线上效果见 `docs/website-preview/live-hd-home.jpg`。浏览器自动下载事件等待超时，因此下载验证使用直接 HTTPS 完整下载与哈希核对，不把自动化超时算作成功。

部署包仅包含新页面实际使用的资源、规范、安装包和部署说明；目录中之前保留的旧图片、GSAP 和旧样式脚本不会进入新包。安装包被 Git 忽略，源码部署时需要另行补入。发布步骤与校验值见 `DEPLOY.md`。

正式发布前的无损截图部署包：`output/MarkFlow-website-OpenDesign-20261104-hd.zip`。旧包留存用于回溯，重新部署应以当前发布源码和 CI 正式安装包为准。

AI 指令使用正式域名；说明页、AI 指南与 JSON 规范均随官网发布。

OpenDesign 项目：`markflow-website-20261104`。生成任务已成功完成。官网已发布；后续 0.4.5 正式发布将官网版本说明、下载入口和内置角色作者署名一并纳入源码。
