<div align="center">

<img src="app-icon.png" width="96" alt="MarkFlow logo" />

# MarkFlow

本地优先的 Markdown 文档转换与编辑工作台

Markdown、Word、Excel、HTML 的转换、编辑和预览都在一个桌面应用中完成。

[![Version](https://img.shields.io/badge/version-0.3.12-1f7a8c.svg)](https://github.com/PanJitao/word-to-markdown/releases/latest)
![Tauri](https://img.shields.io/badge/desktop-Tauri%20v2-24c8db.svg)
![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-3a6ea5.svg)
[![License](https://img.shields.io/badge/license-MIT-4c956c.svg)](LICENSE)

[下载最新版本](https://github.com/PanJitao/word-to-markdown/releases/latest) · [核心功能](#核心功能) · [使用方式](#使用方式) · [自行构建](#自行构建)

</div>

---

## 项目简介

MarkFlow 是一款面向日常写作、文档整理和格式转换的桌面工具。它提供 Markdown 源码编辑与实时预览，支持将 Word、Excel 导入为 Markdown，并将 Markdown 导出为 Word 或独立 HTML。

当前源码版本为 `0.3.12`。文档转换、预览和外观设置均在本机运行，文件不会上传到服务端。

## 核心功能

### Markdown 编辑与预览

- 左侧 Markdown 源码编辑，右侧实时渲染预览。
- 支持隐藏或展开编辑区，预览区可获得完整宽度。
- 可拖动中间分隔条调整编辑区和预览区比例。
- 编辑区和预览区上下滚动自动同步，便于边改边核对排版。
- 工具栏可快速插入标题、加粗、斜体、列表、引用、表格、代码块和链接。
- 支持复制 Markdown 源码、实时字数统计和上次会话恢复。

### 预览复制增强

- 预览表格中双击单元格，可直接选中该单元格内容。
- 每个代码块右上角提供复制按钮。
- 外部链接在系统默认浏览器中打开，不会替换当前工作区。

### 内容显示缩放

- 支持 `Ctrl/Command + 滚轮` 调整内容大小。
- 支持 `Ctrl/Command + +` 与 `Ctrl/Command + -` 调整内容大小。
- 缩放范围限制为 `70% - 180%`，仅影响编辑和预览内容，不缩放整套界面。

### 外观与背景定制

- 支持 PNG、JPG、WebP、GIF、MP4、WebM 作为静态或动态背景素材，单个文件最大 `100 MB`。
- 支持设置背景底色、背景透明度、面板与按钮透明度。
- 编辑区和预览区透明度最低可调整到 `5%`。
- 支持分别设置编辑器和预览区字体颜色。
- 提供独立的面板背景模糊开关。
- 按钮、编辑区和预览区统一使用白色半透明玻璃质感，并保留清晰的层级和焦点状态。
- 外观设置、背景素材和透明度会在本机保存，重启后自动恢复。

### 文档转换

所有转换在本机完成，不上传文档内容。

| 转换方向 | 说明 |
| --- | --- |
| Word -> Markdown | 保留标题、列表、表格、合并单元格、图片标记等结构。 |
| Excel -> Markdown | 将每个工作表转换为 Markdown 表格。 |
| Markdown -> Word | 生成真实 `.docx`，支持标题、列表、表格、代码块、链接和嵌套文本格式。 |
| Markdown -> HTML | 导出带基础排版的独立 HTML 文档。 |

### 桌面集成

- 自动恢复上次编辑内容和文件名。
- 可将 MarkFlow 加入 `.md` 文件右键“打开方式”。
- 可注册为 Markdown 默认应用，并跳转至 Windows 系统设置确认默认程序。
- 双击 `.md` 文件或通过右键菜单打开时，文件会直接载入编辑区。

## 截图

### 编辑与实时预览

![MarkFlow 主界面](docs/screenshots/01-main.png)

### Word 转 Markdown

![Word 转 Markdown 效果](docs/screenshots/03-conversion.png)

### 可调节分栏

![可拖动分栏](docs/screenshots/04-resizable.png)

## 下载与使用

前往 [GitHub Releases](https://github.com/PanJitao/word-to-markdown/releases/latest) 下载对应平台的安装包。

| 平台 | 文件名格式 |
| --- | --- |
| Windows x64 | `MarkFlow_<version>_x64-setup.exe` |
| Windows x64 | `MarkFlow_<version>_x64_en-US.msi` |
| macOS Apple Silicon | `MarkFlow_<version>_aarch64.dmg` |
| macOS Intel | `MarkFlow_<version>_x64.dmg` |

Windows 10/11 通常已内置 WebView2。少数旧系统如缺少该运行时，可从 [Microsoft Edge WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) 安装。

首次打开后，可通过右上角“设置 -> 外观设置”配置背景、透明度、字体颜色和模糊效果。

## 使用方式

1. 在左侧输入或粘贴 Markdown，右侧即时查看渲染结果。
2. 需要转换文件时，使用顶部“打开 MD”“Word 转 MD”或“Excel 转 MD”。
3. 使用“保存 MD”“MD 转 Word”“导出 HTML”保存所需格式。
4. 使用编辑区右上方的显示切换按钮隐藏或展开编辑区。
5. 使用右上角“设置 -> 外观设置”调整背景与玻璃面板效果。

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl/Command + B` | 加粗 |
| `Ctrl/Command + I` | 斜体 |
| `Ctrl/Command + 滚轮` | 放大或缩小内容显示 |
| `Ctrl/Command + +` | 放大内容显示 |
| `Ctrl/Command + -` | 缩小内容显示 |
| `Tab` | 插入两个空格，或为选中行增加缩进 |
| `Shift + Tab` | 减少缩进 |
| `Esc` | 关闭设置菜单或对话框 |

## 自行构建

### 环境要求

- Node.js `20` 或更高版本。
- Rust stable 工具链和 Cargo。
- Windows 构建需安装 WebView2 运行时。

### 开发与测试

```bash
# 安装依赖
npm install

# 启动 Tauri 开发应用
npm run tauri -- dev

# 仅启动前端页面，访问 http://127.0.0.1:1420
npm run dev

# 前端生产构建
npm run build

# 转换逻辑冒烟测试
node scripts/smoke-convert.mjs
```

### 打包

```bash
# 根据当前系统生成默认安装产物
npm run tauri -- build

# 仅构建 Windows NSIS 安装程序
npm run tauri -- build --bundles nsis
```

Windows NSIS 安装程序输出至：

```text
src-tauri/target/release/bundle/nsis/MarkFlow_0.3.12_x64-setup.exe
```

## 项目结构

```text
├─ index.html                 界面结构
├─ package.json               前端依赖与脚本
├─ docs/screenshots/          README 截图
├─ src/
│  ├─ main.ts                 界面交互、文件操作、缩放、同步滚动和外观控制
│  ├─ style.css               玻璃界面、编辑器与预览区样式
│  └─ lib/
│     ├─ appearance.ts         外观设置与背景素材本地存储
│     ├─ convert.ts            docx、xlsx、Markdown 转换
│     ├─ io.ts                 Tauri 文件读写封装
│     └─ markdown.ts           Markdown 渲染与 HTML 导出
└─ src-tauri/
   ├─ src/main.rs             Rust 命令、文件关联与外部链接处理
   ├─ icons/                  Windows 与 macOS 应用图标
   └─ tauri.conf.json         窗口、CSP 与打包配置
```

## 技术栈

- 桌面外壳：[Tauri v2](https://tauri.app/) 和 Rust。
- 前端：原生 TypeScript 与 [Vite](https://vitejs.dev/)。
- Word 导入：[mammoth](https://github.com/mwilliamson/mammoth)。
- Excel 导入：[SheetJS](https://sheetjs.com/)。
- Word 导出：[docx](https://github.com/dolanmiu/docx)。
- HTML 转 Markdown：[turndown](https://github.com/mixmark-io/turndown) 和 `turndown-plugin-gfm`。
- 渲染与清理：[markdown-it](https://github.com/markdown-it/markdown-it) 和 [DOMPurify](https://github.com/cure53/DOMPurify)。

## 许可证

本项目采用 [MIT License](LICENSE) 开源。你可以使用、复制、修改、发布和商用本项目代码，但需保留原始版权和许可声明。
