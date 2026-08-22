// 文件读写：用 Tauri 的对话框选文件，再调用 Rust 命令读写
import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'

export type FileFilter = { name: string; extensions: string[] }
export type DirectoryEntry = { name: string; path: string; is_dir: boolean }
export type ImageAssetResult = { path: string; status: 'created' | 'reused' | 'conflict' }

/** 办公文档 → Markdown 的转换结果（由 Rust 端 anydoc 引擎返回） */
export type OfficeConversionResult = {
  markdown: string
  format: string
  imageCount: number
  skippedImages: number
}

/** 转换失败的结构化错误（code 为机器可读原因，message 为技术细节） */
export type ConvertFailure = { code: string; message: string }

/**
 * 调用 Rust 端 anydoc 引擎，把 Word / PowerPoint / Excel / ODF / RTF / EPUB / CSV / PDF
 * 转换成 Markdown。提供 imageDirectory 与 mdTarget 时，文档内嵌图片会外置到图片目录，
 * 正文写入相对引用。
 */
export function convertOfficeToMarkdown(
  path: string,
  imageDirectory: string | null,
  mdTarget: string | null,
): Promise<OfficeConversionResult> {
  return invoke<OfficeConversionResult>('convert_office_to_markdown', {
    path,
    imageDirectory,
    mdTarget,
  })
}

/** 让用户选一个文件并读取文本内容 */
export async function pickOpenFile(
  filters: FileFilter[],
  mode: 'text',
): Promise<{ filePath: string; text: string } | null>
/** 让用户选一个文件并读取二进制内容 */
export async function pickOpenFile(
  filters: FileFilter[],
  mode: 'bytes',
): Promise<{ filePath: string; buffer: ArrayBuffer } | null>
export async function pickOpenFile(
  filters: FileFilter[],
  mode: 'text' | 'bytes',
): Promise<{ filePath: string; text: string } | { filePath: string; buffer: ArrayBuffer } | null> {
  const path = await open({ filters, multiple: false, directory: false })
  if (!path) return null
  const filePath = typeof path === 'string' ? path : path[0]
  if (mode === 'text') {
    const text = await invoke<string>('read_text_file', { path: filePath })
    return { filePath, text }
  }
  const bytes = await invoke<number[]>('read_file_bytes', { path: filePath })
  const buffer = new Uint8Array(bytes).buffer
  return { filePath, buffer }
}

/** 仅选择文件路径，不读取文件内容。 */
export async function pickFilePath(filters: FileFilter[]): Promise<string | null> {
  const path = await open({ filters, multiple: false, directory: false })
  if (!path) return null
  return typeof path === 'string' ? path : path[0]
}

/** 让用户选一个保存位置，返回完整路径或 null */
export async function pickSavePath(defaultName: string, filters: FileFilter[]): Promise<string | null> {
  return await save({ defaultPath: defaultName, filters })
}

/** 选择一个工作区文件夹 */
export async function pickOpenFolder(): Promise<string | null> {
  const path = await open({ multiple: false, directory: true })
  if (!path) return null
  return typeof path === 'string' ? path : path[0]
}

/** 把文本写入指定路径 */
export async function writeTextFile(path: string, content: string): Promise<void> {
  await invoke('write_text_file', { path, content })
}

export async function writeExistingTextFile(path: string, content: string): Promise<void> {
  await invoke('write_existing_text_file', { path, content })
}

/** 按路径读取文本（用于启动时打开传入的文件） */
export function readTextFile(path: string): Promise<string> {
  return invoke<string>('read_text_file', { path })
}

export function pathExists(path: string): Promise<boolean> {
  return invoke<boolean>('path_exists', { path })
}

/** 按路径读取二进制文件，用于本地图片预览。 */
export function readFileBytes(path: string): Promise<number[]> {
  return invoke<number[]>('read_file_bytes', { path })
}

/** 获取文件字节数（不读取内容，用于前端做大小上限判断） */
export function fileSize(path: string): Promise<number> {
  return invoke<number>('file_size', { path })
}

/** 把二进制写入指定路径（用于导出 docx） */
export async function writeBytesFile(path: string, bytes: Uint8Array): Promise<void> {
  await invoke('write_file_bytes', { path, bytes: Array.from(bytes) })
}

/** 取文件所在目录，用于 docx 图片资源等 */
export function parentDir(filePath: string): string {
  const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return slash >= 0 ? filePath.slice(0, slash) : filePath
}

/** 替换扩展名 */
export function swapExtension(filePath: string, ext: string): string {
  return filePath.replace(/\.[^./\\]+$/, '') + ext
}

// ---------- 系统集成：文件关联 / 启动参数 ----------

/** 启动时系统传入的文件路径（双击 / 上下文菜单打开时） */
export function getLaunchFile(): Promise<string | null> {
  return invoke<string | null>('get_launch_file')
}

/** 注册到 .md 的「打开方式」列表（HKCU，无需管理员） */
export function registerMdHandler(): Promise<string> {
  return invoke<string>('register_md_handler')
}

/** 复制用户自定义应用图标到应用数据目录。支持 PNG / ICO。 */
export function installCustomAppIcon(source: string): Promise<string> {
  return invoke<string>('install_custom_app_icon', { source })
}

/** 复制用户自定义 Markdown 文件图标到应用数据目录。Windows 使用 ICO。 */
export function installCustomFileIcon(source: string): Promise<string> {
  return invoke<string>('install_custom_file_icon', { source })
}

export function clearCustomIcon(kind: 'app' | 'file'): Promise<void> {
  return invoke<void>('clear_custom_icon', { kind })
}

export function getIconPath(kind: 'app' | 'file'): Promise<string> {
  return invoke<string>('get_icon_path', { kind })
}

/** 打开系统「默认应用」设置页 */
export function openDefaultAppsSettings(): Promise<void> {
  return invoke<void>('open_default_apps_settings')
}

/** 用系统默认浏览器打开外部链接（不在应用窗口内跳转） */
export function openUrl(url: string): Promise<void> {
  return invoke<void>('open_url', { url })
}

export function readDirectory(path: string): Promise<DirectoryEntry[]> {
  return invoke<DirectoryEntry[]>('read_directory', { path })
}

export function createWorkspaceFile(parent: string, name: string, root: string | null = null): Promise<string> {
  return invoke<string>('create_workspace_file', { parent, name, root })
}

export function createWorkspaceFolder(parent: string, name: string, root: string | null = null): Promise<string> {
  return invoke<string>('create_workspace_folder', { parent, name, root })
}

export function saveImageAsset(directory: string, fileName: string, bytes: Uint8Array, overwrite = false): Promise<ImageAssetResult> {
  return invoke<ImageAssetResult>('save_image_asset', { directory, fileName, bytes: Array.from(bytes), overwrite })
}

export function copyImageAsset(source: string, directory: string, overwrite = false): Promise<ImageAssetResult> {
  return invoke<ImageAssetResult>('copy_image_asset', { source, directory, overwrite })
}

export function ensureWorkspaceImageDir(root: string): Promise<string> {
  return invoke<string>('ensure_workspace_image_dir', { root })
}

export function renameWorkspaceEntry(root: string, path: string, newName: string): Promise<string> {
  return invoke<string>('rename_workspace_entry', { root, path, newName })
}

export function trashWorkspaceEntry(root: string, path: string): Promise<void> {
  return invoke<void>('trash_workspace_entry', { root, path })
}

export function workspaceRelativePath(root: string, path: string): Promise<string> {
  return invoke<string>('workspace_relative_path', { root, path })
}

export function revealInFileManager(path: string): Promise<void> {
  return invoke<void>('reveal_in_file_manager', { path })
}

export function relativePath(fromFile: string, target: string): Promise<string> {
  return invoke<string>('relative_path', { fromFile, target })
}

export function resolveRelativePath(fromFile: string, relative: string): Promise<string> {
  return invoke<string>('resolve_relative_path', { fromFile, relative })
}

export function newWindow(): Promise<void> {
  return invoke<void>('new_window')
}
