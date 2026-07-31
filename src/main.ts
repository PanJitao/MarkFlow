// 主界面与交互：Markdown 源码编辑 + 实时预览 + 文件转换
import './style.css'
import hljs from 'highlight.js/lib/core'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import dos from 'highlight.js/lib/languages/dos'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import pgsql from 'highlight.js/lib/languages/pgsql'
import powershell from 'highlight.js/lib/languages/powershell'
import python from 'highlight.js/lib/languages/python'
import sql from 'highlight.js/lib/languages/sql'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater'
import { renderMarkdown, buildHtmlDocument } from './lib/markdown'
import { docxToMarkdown, xlsxToMarkdown, markdownToDocxBlob } from './lib/convert'
import {
  clearBackgroundAsset,
  DEFAULT_APPEARANCE,
  loadAppearanceSettings,
  loadBackgroundAsset,
  saveAppearanceSettings,
  saveBackgroundAsset,
  type AppearanceSettings,
  type StoredBackgroundAsset,
} from './lib/appearance'
import {
  pickOpenFile,
  pickFilePath,
  pickOpenFolder,
  pickSavePath,
  writeTextFile,
  writeBytesFile,
  readTextFile,
  readFileBytes,
  swapExtension,
  getLaunchFile,
  registerMdHandler,
  openDefaultAppsSettings,
  openUrl,
  readDirectory,
  createWorkspaceFile,
  createWorkspaceFolder,
  relativePath,
  resolveRelativePath,
  newWindow,
  type DirectoryEntry,
} from './lib/io'

hljs.registerLanguage('c', c)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('csharp', csharp)
hljs.registerLanguage('dos', dos)
hljs.registerLanguage('java', java)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('pgsql', pgsql)
hljs.registerLanguage('powershell', powershell)
hljs.registerLanguage('python', python)
hljs.registerLanguage('sql', sql)

const SAMPLE = `# 欢迎使用 MarkFlow

一个轻量桌面小工具，可以完成 **Markdown、Word、Excel、HTML** 之间的互相转换。

## 它能做什么

- 左边直接写 Markdown，右边实时看到渲染效果
- 把 Word（.docx）文档转成 Markdown
- 把 Excel（.xlsx）表格转成 Markdown 表格
- 把 Markdown 导出成排版好的 HTML 或 Word

## 怎么用

1. 在左边编辑器里写内容，或点工具栏快速插入格式
2. 右边会立刻显示排版后的样子
3. 想转换文件时，点顶部按钮选择文件即可

> 提示：支持 **Ctrl+I** 斜体。
`

const editor = document.querySelector<HTMLTextAreaElement>('#editor')!
const preview = document.querySelector<HTMLElement>('#preview')!
const statusEl = document.querySelector<HTMLElement>('#status')!
const fileLabel = document.querySelector<HTMLElement>('#file-label')!
const wordCountEl = document.querySelector<HTMLElement>('#word-count')!
const zoomLevelEl = document.querySelector<HTMLElement>('#zoom-level')!
const toastEl = document.querySelector<HTMLElement>('#toast')!
const customBackground = document.querySelector<HTMLElement>('#custom-background')!
const backgroundImage = document.querySelector<HTMLImageElement>('#background-image')!
const backgroundVideo = document.querySelector<HTMLVideoElement>('#background-video')!
const appearanceDialog = document.querySelector<HTMLDialogElement>('#appearance-dialog')!
const updateDialog = document.querySelector<HTMLDialogElement>('#update-dialog')!
const appearanceSettingsBtn = document.querySelector<HTMLButtonElement>('#appearance-settings-btn')!
const updateVersionEl = document.querySelector<HTMLElement>('#update-version')!
const updateStatusEl = document.querySelector<HTMLElement>('#update-status')!
const updateProgressEl = document.querySelector<HTMLProgressElement>('#update-progress')!
const updateLaterBtn = document.querySelector<HTMLButtonElement>('#update-later-btn')!
const updateConfirmBtn = document.querySelector<HTMLButtonElement>('#update-confirm-btn')!
const chooseBackgroundBtn = document.querySelector<HTMLButtonElement>('#choose-background-btn')!
const clearBackgroundBtn = document.querySelector<HTMLButtonElement>('#clear-background-btn')!
const backgroundFileInput = document.querySelector<HTMLInputElement>('#background-file-input')!
const backgroundFileName = document.querySelector<HTMLElement>('#background-file-name')!
const backgroundColorInput = document.querySelector<HTMLInputElement>('#background-color-input')!
const backgroundOpacityInput = document.querySelector<HTMLInputElement>('#background-opacity-input')!
const backgroundOpacityValue = document.querySelector<HTMLOutputElement>('#background-opacity-value')!
const panelOpacityInput = document.querySelector<HTMLInputElement>('#panel-opacity-input')!
const panelOpacityValue = document.querySelector<HTMLOutputElement>('#panel-opacity-value')!
const codeBlockOpacityInput = document.querySelector<HTMLInputElement>('#code-block-opacity-input')!
const codeBlockOpacityValue = document.querySelector<HTMLOutputElement>('#code-block-opacity-value')!
const adaptiveContrastToggle = document.querySelector<HTMLButtonElement>('#adaptive-contrast-toggle')!
const adaptiveContrastValue = document.querySelector<HTMLElement>('#adaptive-contrast-value')!
const panelBlurToggle = document.querySelector<HTMLButtonElement>('#panel-blur-toggle')!
const panelBlurValue = document.querySelector<HTMLElement>('#panel-blur-value')!
const buttonTextColorInput = document.querySelector<HTMLInputElement>('#button-text-color-input')!
const editorColorInput = document.querySelector<HTMLInputElement>('#editor-color-input')!
const previewColorInput = document.querySelector<HTMLInputElement>('#preview-color-input')!
const resetAppearanceBtn = document.querySelector<HTMLButtonElement>('#reset-appearance-btn')!
const editorContextMenu = document.querySelector<HTMLElement>('#editor-context-menu')!
const contextSubmenuTriggers = [...editorContextMenu.querySelectorAll<HTMLButtonElement>('[data-context-submenu]')]
const fileTree = document.querySelector<HTMLElement>('#file-tree')!
const workspaceLabel = document.querySelector<HTMLElement>('#workspace-label')!
const fileTreeToggleBtn = document.querySelector<HTMLButtonElement>('#file-tree-toggle-btn')!
const fileBtn = document.querySelector<HTMLButtonElement>('#file-btn')!
const fileMenu = document.querySelector<HTMLElement>('#file-menu')!
const recentFilesBtn = document.querySelector<HTMLButtonElement>('#recent-files-btn')!
const recentFilesList = document.querySelector<HTMLElement>('#recent-files-list')!
let toastTimer: ReturnType<typeof setTimeout> | null = null
let appearanceSettings = loadAppearanceSettings()
let backgroundObjectUrl: string | null = null
let contextSelection: { start: number; end: number } | null = null
let pendingContextSelection: { start: number; end: number } | null = null
let lastNonEmptySelection: { start: number; end: number } | null = null
let availableUpdate: Update | null = null
let updateInstalling = false

let markdown = SAMPLE
let currentFile: string | null = null
let workspaceRoot: string | null = null
const previewImageObjectUrls = new Set<string>()
const expandedTreeDirectories = new Set<string>()
let busy = false
let writingPreviewTable = false
const undoStack: Array<{ value: string; start: number; end: number }> = []
const MAX_UNDO_STEPS = 100

const APP_WINDOW_TITLE = 'MarkFlow 文档转换工作台'
const RECENT_FOLDERS_KEY = 'markflow:recentFolders'
const MAX_RECENT_FOLDERS = 10

function fileNameFromPath(path: string) {
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return separator >= 0 ? path.slice(separator + 1) : path
}

function parentDirectoryFromPath(path: string) {
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return separator >= 0 ? path.slice(0, separator) : ''
}

function loadRecentFolders(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_FOLDERS_KEY) || '[]')
    return Array.isArray(value) ? value.filter((path): path is string => typeof path === 'string') : []
  } catch {
    return []
  }
}

function rememberRecentFolder(path: string) {
  const recent = [path, ...loadRecentFolders().filter((item) => item !== path)].slice(0, MAX_RECENT_FOLDERS)
  localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(recent))
  renderRecentFolderList()
}

function setCurrentFile(path: string | null) {
  currentFile = path
  fileLabel.textContent = path ?? '未保存的草稿 · Markdown 源码'
  const title = path ? fileNameFromPath(path) : APP_WINDOW_TITLE
  document.title = title
  if (isTauri()) void getCurrentWindow().setTitle(title).catch(() => undefined)
}

const STATE_KEY = 'exchangemd:lastState'
let persistTimer: ReturnType<typeof setTimeout> | null = null

/** 防抖保存当前编辑器内容 + 文件路径，下次打开可恢复 */
function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({ markdown: editor.value, currentFile }))
    } catch {
      // 容量超限或隐私模式，忽略
    }
  }, 400)
}

/** 恢复上次会话；没有则用欢迎示例 */
function restoreSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_KEY) || 'null')
    if (saved && typeof saved.markdown === 'string' && saved.markdown.trim()) {
      setMarkdown(saved.markdown)
      setCurrentFile(typeof saved.currentFile === 'string' ? saved.currentFile : null)
      return true
    }
  } catch {
    // 损坏的状态，忽略
  }
  setMarkdown(SAMPLE)
  return false
}

function setBusy(value: boolean, msg?: string) {
  busy = value
  document.body.classList.toggle('is-busy', value)
  if (msg !== undefined) setStatus(msg)
  else if (value) setStatus('处理中…')
  // 关闭忙碌时不重置状态，避免覆盖刚设置的成功/失败信息
  ;[...document.querySelectorAll<HTMLButtonElement>('[data-convert]')].forEach((b) => (b.disabled = value))
}

function setStatus(msg: string) {
  statusEl.textContent = msg
}

/** 更新字数统计（汉字按字、英文按词综合估算） */
function updateCount() {
  const text = editor.value.trim()
  if (!text) { wordCountEl.textContent = '0 字'; return }
  // 中日韩字符逐个计数，其余按空白分词
  const cjk = (text.match(/[一-鿿぀-ヿ가-힯]/g) || []).length
  const words = (text.replace(/[一-鿿぀-ヿ가-힯]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length
  wordCountEl.textContent = `${cjk + words} 字`
}

/** 短暂浮层提示 */
function showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
  toastEl.textContent = message
  toastEl.className = `toast show ${type}`
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastEl.className = 'toast'
  }, 3200)
}

// ---------- 在线更新 ----------

function setUpdateControls(disabled: boolean) {
  updateLaterBtn.disabled = disabled
  updateConfirmBtn.disabled = disabled
}

function showUpdateProgress(event: DownloadEvent, state: { total: number; downloaded: number }) {
  if (event.event === 'Started') {
    state.total = event.data.contentLength || 0
    state.downloaded = 0
    updateProgressEl.value = 0
    updateStatusEl.textContent = '正在下载更新…'
    return
  }
  if (event.event === 'Progress') {
    state.downloaded += event.data.chunkLength
    if (state.total > 0) {
      const percent = Math.min(100, Math.round((state.downloaded / state.total) * 100))
      updateProgressEl.value = percent
      updateStatusEl.textContent = `正在下载更新… ${percent}%`
    }
    return
  }
  updateProgressEl.value = 100
  updateStatusEl.textContent = '下载完成，正在安装…'
}

async function checkForUpdate() {
  if (!isTauri()) return
  try {
    const update = await check({ timeout: 12_000 })
    if (!update) return
    availableUpdate = update
    updateInstalling = false
    updateVersionEl.textContent = `发现新版本 ${update.version}，当前版本 ${update.currentVersion}`
    updateStatusEl.textContent = update.body || '确认后将下载并安装更新。'
    updateProgressEl.value = 0
    setUpdateControls(false)
    if (!updateDialog.open) {
      window.getSelection()?.removeAllRanges()
      updateDialog.showModal()
    }
  } catch (err) {
    console.warn('检查更新失败', err)
  }
}

updateLaterBtn.addEventListener('click', () => updateDialog.close())
updateDialog.addEventListener('cancel', (event) => {
  if (updateInstalling) event.preventDefault()
})

updateConfirmBtn.addEventListener('click', async () => {
  if (!availableUpdate || updateInstalling) return
  updateInstalling = true
  setUpdateControls(true)
  const download = { total: 0, downloaded: 0 }
  try {
    await availableUpdate.downloadAndInstall((event) => showUpdateProgress(event, download))
    updateStatusEl.textContent = '安装完成，正在重新启动…'
    await relaunch()
  } catch (err) {
    updateInstalling = false
    setUpdateControls(false)
    updateStatusEl.textContent = `更新失败：${errMsg(err)}`
    showToast(`更新失败：${errMsg(err)}`, 'error')
  }
})

// ---------- 外观设置 ----------

const MAX_BACKGROUND_BYTES = 100 * 1024 * 1024

function adaptiveTextColor(background: string): string {
  const red = parseInt(background.slice(1, 3), 16) / 255
  const green = parseInt(background.slice(3, 5), 16) / 255
  const blue = parseInt(background.slice(5, 7), 16) / 255
  const linear = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  const luminance = 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
  return luminance > 0.42 ? '#20262e' : '#ffffff'
}

function applyAppearance(settings: AppearanceSettings) {
  const root = document.documentElement
  const panelOpacity = settings.panelOpacity / 100
  const codeBlockOpacity = settings.codeBlockOpacity / 100
  const contrastText = adaptiveTextColor(settings.backgroundColor)
  root.style.setProperty('--bg', settings.backgroundColor)
  root.style.setProperty('--background-opacity', String(settings.backgroundOpacity / 100))
  root.style.setProperty('--panel-opacity', String(panelOpacity))
  root.style.setProperty('--panel-highlight-opacity', String(panelOpacity * 0.28))
  root.style.setProperty('--panel-sheen-opacity', String(panelOpacity * 0.36))
  root.style.setProperty('--panel-reflection-opacity', String(panelOpacity * 0.19))
  root.style.setProperty('--panel-soft-opacity', String(panelOpacity * 0.06))
  root.style.setProperty('--panel-header-opacity', String(panelOpacity * 0.4))
  root.style.setProperty('--code-block-opacity', String(codeBlockOpacity))
  root.style.setProperty('--code-gutter-opacity', String(Math.max(0.08, codeBlockOpacity * 0.72)))
  root.style.setProperty('--code-shadow-opacity', String(0.12 + codeBlockOpacity * 0.24))
  root.style.setProperty('--code-border-opacity', String(0.14 + codeBlockOpacity * 0.28))
  root.style.setProperty('--code-block-blur', settings.panelBlurEnabled ? '12px' : '0px')
  root.classList.toggle('adaptive-contrast-enabled', settings.adaptiveContrastEnabled)
  root.style.setProperty('--content-highlight-opacity', String(panelOpacity * 0.21))
  root.style.setProperty('--content-reflection-opacity', String(panelOpacity * 0.13))
  root.style.setProperty('--content-soft-opacity', String(panelOpacity * 0.04))
  root.style.setProperty('--content-surface-opacity', String(panelOpacity * 0.17))
  root.style.setProperty('--content-accent-opacity', String(panelOpacity * 0.87))
  root.style.setProperty('--glass-button-opacity', String(0.08 + panelOpacity * 0.3))
  root.style.setProperty('--glass-button-hover-opacity', String(0.18 + panelOpacity * 0.34))
  root.style.setProperty('--glass-highlight-opacity', String(0.08 + panelOpacity * 0.2))
  root.style.setProperty('--glass-primary-opacity', String(0.18 + panelOpacity * 0.4))
  root.style.setProperty('--glass-primary-hover-opacity', String(0.24 + panelOpacity * 0.46))
  root.style.setProperty('--panel-blur', settings.panelBlurEnabled ? '28px' : '0px')
  root.style.setProperty('--panel-header-blur', settings.panelBlurEnabled ? '16px' : '0px')
  root.style.setProperty('--content-blur', settings.panelBlurEnabled ? '16px' : '0px')
  root.style.setProperty('--glass-blur', settings.panelBlurEnabled ? '8px' : '0px')
  root.style.setProperty('--adaptive-text', contrastText)
  root.style.setProperty('--button-text', settings.adaptiveContrastEnabled ? contrastText : settings.buttonTextColor)
  root.style.setProperty('--editor-text', settings.editorColor)
  root.style.setProperty('--preview-text', settings.previewColor)

  backgroundColorInput.value = settings.backgroundColor
  backgroundOpacityInput.value = String(settings.backgroundOpacity)
  backgroundOpacityValue.value = `${settings.backgroundOpacity}%`
  panelOpacityInput.value = String(settings.panelOpacity)
  panelOpacityValue.value = `${settings.panelOpacity}%`
  codeBlockOpacityInput.value = String(settings.codeBlockOpacity)
  codeBlockOpacityValue.value = `${settings.codeBlockOpacity}%`
  adaptiveContrastToggle.setAttribute('aria-checked', String(settings.adaptiveContrastEnabled))
  adaptiveContrastValue.textContent = settings.adaptiveContrastEnabled ? '开启' : '关闭'
  panelBlurToggle.setAttribute('aria-checked', String(settings.panelBlurEnabled))
  panelBlurValue.textContent = settings.panelBlurEnabled ? '开启' : '关闭'
  buttonTextColorInput.value = settings.buttonTextColor
  editorColorInput.value = settings.editorColor
  previewColorInput.value = settings.previewColor

  if (settings.backgroundOpacity === 0) backgroundVideo.pause()
  else if (customBackground.classList.contains('has-video') && !document.hidden) {
    void backgroundVideo.play().catch(() => undefined)
  }
}

function updateAppearance(patch: Partial<AppearanceSettings>) {
  appearanceSettings = { ...appearanceSettings, ...patch }
  applyAppearance(appearanceSettings)
  try {
    saveAppearanceSettings(appearanceSettings)
  } catch {
    // 设置体积很小；存储不可用时仍保留当前会话效果。
  }
}

function enableAdaptiveButtonLabels() {
  document.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    for (const child of [...button.childNodes]) {
      if (child.nodeType !== Node.TEXT_NODE || !child.textContent?.trim()) continue
      const label = document.createElement('span')
      label.className = 'adaptive-contrast'
      label.textContent = child.textContent
      button.replaceChild(label, child)
    }
  })
}

function backgroundKind(asset: Pick<StoredBackgroundAsset, 'name' | 'type'>): 'image' | 'video' | null {
  const name = asset.name.toLowerCase()
  if (asset.type.startsWith('video/') || /\.(mp4|webm)$/.test(name)) return 'video'
  if (asset.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/.test(name)) return 'image'
  return null
}

function showBackgroundAsset(asset: StoredBackgroundAsset | null) {
  if (backgroundObjectUrl) URL.revokeObjectURL(backgroundObjectUrl)
  backgroundObjectUrl = null
  backgroundImage.removeAttribute('src')
  backgroundVideo.pause()
  backgroundVideo.removeAttribute('src')
  backgroundVideo.load()
  customBackground.classList.remove('has-image', 'has-video')

  if (!asset) {
    backgroundFileName.textContent = '未选择'
    backgroundFileName.title = '未选择背景素材'
    clearBackgroundBtn.disabled = true
    return
  }

  const kind = backgroundKind(asset)
  if (!kind) return
  backgroundObjectUrl = URL.createObjectURL(asset.blob)
  if (kind === 'video') {
    backgroundVideo.src = backgroundObjectUrl
    customBackground.classList.add('has-video')
    if (appearanceSettings.backgroundOpacity > 0 && !document.hidden) {
      void backgroundVideo.play().catch(() => undefined)
    }
  } else {
    backgroundImage.src = backgroundObjectUrl
    customBackground.classList.add('has-image')
  }
  backgroundFileName.textContent = asset.name
  backgroundFileName.title = asset.name
  clearBackgroundBtn.disabled = false
}

async function restoreBackground() {
  try {
    showBackgroundAsset(await loadBackgroundAsset())
  } catch (err) {
    showToast(`恢复背景失败：${errMsg(err)}`, 'error')
  }
}

const CONTENT_ZOOM_MIN = 70
const CONTENT_ZOOM_MAX = 180
const CONTENT_ZOOM_STEP = 10
let contentZoom = 100
let restoringZoomScroll = false
let lastWheelZoomAt = 0

function scrollProgress(element: HTMLElement) {
  const range = element.scrollHeight - element.clientHeight
  return range > 0 ? element.scrollTop / range : 0
}

function setContentZoom(nextZoom: number) {
  const clamped = Math.min(CONTENT_ZOOM_MAX, Math.max(CONTENT_ZOOM_MIN, nextZoom))
  if (clamped === contentZoom) {
    const atLimit = clamped === CONTENT_ZOOM_MIN || clamped === CONTENT_ZOOM_MAX
    showToast(atLimit ? `显示比例已达 ${clamped}%` : `内容显示 ${clamped}%`, 'info')
    return
  }

  const editorProgress = scrollProgress(editor)
  const previewProgress = scrollProgress(preview)
  contentZoom = clamped
  restoringZoomScroll = true
  document.documentElement.style.setProperty('--content-scale', String(contentZoom / 100))
  zoomLevelEl.textContent = `${contentZoom}%`
  zoomLevelEl.setAttribute('aria-label', `内容显示比例 ${contentZoom}%`)

  requestAnimationFrame(() => {
    editor.scrollTop = editorProgress * Math.max(0, editor.scrollHeight - editor.clientHeight)
    preview.scrollTop = previewProgress * Math.max(0, preview.scrollHeight - preview.clientHeight)
    requestAnimationFrame(() => { restoringZoomScroll = false })
  })
  showToast(`内容显示 ${contentZoom}%`, 'info')
}

function setMarkdown(value: string) {
  undoStack.length = 0
  markdown = value
  editor.value = value
  renderPreview(value)
  updateCount()
  schedulePersist()
}

function renderOnly() {
  renderPreview(editor.value)
  markdown = editor.value
  updateCount()
  schedulePersist()
}

function recordUndoState() {
  const value = editor.value
  if (undoStack.at(-1)?.value === value) return
  undoStack.push({
    value,
    start: editor.selectionStart ?? value.length,
    end: editor.selectionEnd ?? value.length,
  })
  if (undoStack.length > MAX_UNDO_STEPS) undoStack.shift()
}

function undoMarkdown() {
  const previous = undoStack.pop()
  if (!previous) return false
  editor.value = previous.value
  markdown = previous.value
  editor.setSelectionRange(previous.start, previous.end)
  renderOnly()
  showToast('已撤回', 'info')
  return true
}

const JSON_TOKEN = /"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b/g
const CODE_LANGUAGE_ALIASES: Record<string, string> = {
  c: 'c',
  'c++': 'cpp',
  cc: 'cpp',
  cpp: 'cpp',
  csharp: 'csharp',
  'c#': 'csharp',
  cs: 'csharp',
  bat: 'dos',
  batch: 'dos',
  cmd: 'dos',
  dos: 'dos',
  java: 'java',
  javascript: 'javascript',
  js: 'javascript',
  node: 'javascript',
  'node.js': 'javascript',
  nodejs: 'javascript',
  postgres: 'pgsql',
  postgresql: 'pgsql',
  pgsql: 'pgsql',
  powershell: 'powershell',
  ps: 'powershell',
  ps1: 'powershell',
  pwsh: 'powershell',
  py: 'python',
  python: 'python',
  mysql: 'sql',
  plsql: 'sql',
  sql: 'sql',
  sqlite: 'sql',
  tsql: 'sql',
}

function codeLanguage(code: HTMLElement) {
  return [...code.classList]
    .find((className) => className.startsWith('language-'))
    ?.slice('language-'.length)
    .toLowerCase() || ''
}

function isJsonLanguage(language: string) {
  return language === 'json' || language === 'jsonc' || language === 'application/json'
}

function codeHighlightLanguage(language: string) {
  return CODE_LANGUAGE_ALIASES[language] || ''
}

function appendJsonTokens(container: HTMLElement, line: string) {
  let previousEnd = 0
  for (const match of line.matchAll(JSON_TOKEN)) {
    const token = match[0]
    const start = match.index ?? 0
    const end = start + token.length
    container.append(document.createTextNode(line.slice(previousEnd, start)))

    const span = document.createElement('span')
    const following = line.slice(end)
    if (token.startsWith('"')) {
      span.className = /^\s*:/.test(following) ? 'json-key' : 'json-string'
    } else if (token === 'true' || token === 'false') {
      span.className = 'json-boolean'
    } else if (token === 'null') {
      span.className = 'json-null'
    } else {
      span.className = 'json-number'
    }
    span.textContent = token
    container.append(span)
    previousEnd = end
  }
  container.append(document.createTextNode(line.slice(previousEnd)))
}

function appendHighlightedLine(container: HTMLElement, line: string, language: string) {
  // Highlight.js escapes source text before returning its span markup.
  container.innerHTML = hljs.highlight(line, { language, ignoreIllegals: true }).value
}

function enhanceCodeBlock(code: HTMLElement) {
  const source = code.textContent || ''
  const hasTrailingNewline = source.endsWith('\n')
  const lines = (hasTrailingNewline ? source.slice(0, -1) : source).split('\n')
  const language = codeLanguage(code)
  const json = isJsonLanguage(language)
  const highlightLanguage = codeHighlightLanguage(language)

  code.textContent = ''
  code.classList.add('code-with-line-numbers')
  code.classList.toggle('json-highlight', json)
  code.classList.toggle('syntax-highlight', Boolean(highlightLanguage))
  code.dataset.trailingNewline = String(hasTrailingNewline)

  lines.forEach((line, index) => {
    const row = document.createElement('span')
    const lineNumber = document.createElement('span')
    const lineContent = document.createElement('span')
    row.className = 'code-line'
    lineNumber.className = 'code-line-number'
    lineNumber.setAttribute('aria-hidden', 'true')
    lineNumber.textContent = String(index + 1)
    lineContent.className = 'code-line-content'

    if (json) appendJsonTokens(lineContent, line)
    else if (highlightLanguage) appendHighlightedLine(lineContent, line, highlightLanguage)
    else lineContent.textContent = line

    row.append(lineNumber, lineContent)
    code.append(row)
  })
}

function codeBlockText(code: HTMLElement) {
  const lines = [...code.querySelectorAll<HTMLElement>('.code-line-content')]
  if (!lines.length) return code.textContent || ''
  const source = lines.map((line) => line.textContent || '').join('\n')
  return code.dataset.trailingNewline === 'true' ? `${source}\n` : source
}

function setCodeCopyButtonState(button: HTMLButtonElement, copied = false) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  path.setAttribute('d', copied
    ? 'm5 12 4 4L19 6'
    : 'M8 8h10v12H8zM6 16H5V4h10v2')
  svg.append(path)
  button.replaceChildren(svg)
  button.title = copied ? '已复制' : '复制代码'
  button.setAttribute('aria-label', copied ? '已复制代码' : '复制代码')
}

function isRelativeImageSource(source: string) {
  return source.length > 0 && !/^(?:[a-z]+:|\/|#)/i.test(source)
}

function imageMimeType(source: string) {
  const extension = source.split('?')[0].split('.').at(-1)?.toLowerCase()
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' } as Record<string, string>)[extension || ''] || 'application/octet-stream'
}

async function resolvePreviewImages() {
  if (!isTauri() || !currentFile) return
  const images = [...preview.querySelectorAll<HTMLImageElement>('img[src]')]
  for (const image of images) {
    const source = image.getAttribute('src') || ''
    if (!isRelativeImageSource(source)) continue
    try {
      const path = await resolveRelativePath(currentFile, decodeURIComponent(source))
      const bytes = await readFileBytes(path)
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: imageMimeType(source) }))
      if (preview.contains(image)) {
        image.src = url
        previewImageObjectUrls.add(url)
      } else {
        URL.revokeObjectURL(url)
      }
    } catch {
      // 路径无效时保留原始 Markdown 地址，让浏览器显示加载失败状态。
    }
  }
}

function renderPreview(value: string) {
  previewImageObjectUrls.forEach((url) => URL.revokeObjectURL(url))
  previewImageObjectUrls.clear()
  preview.innerHTML = renderMarkdown(value)
  preview.querySelectorAll<HTMLTableElement>('table').forEach((table, index) => {
    enhancePreviewTable(table, index)
  })
  preview.querySelectorAll<HTMLPreElement>('pre').forEach((pre) => {
    const code = pre.querySelector<HTMLElement>('code')
    if (!code) return
    enhanceCodeBlock(code)
    const wrapper = document.createElement('div')
    const button = document.createElement('button')
    wrapper.className = 'code-block'
    button.type = 'button'
    button.className = 'code-copy-btn'
    setCodeCopyButtonState(button)
    pre.before(wrapper)
    wrapper.append(pre, button)
  })
  void resolvePreviewImages()
}

interface MarkdownTableSource {
  start: number
  end: number
  rows: string[][]
  divider: string[]
}

function splitMarkdownTableRow(line: string): string[] {
  const content = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cell = ''
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]
    if (char === '\\' && content[index + 1] === '|') {
      cell += '|'
      index += 1
    } else if (char === '|') {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += char
    }
  }
  cells.push(cell.trim())
  return cells
}

function isMarkdownTableDivider(cells: string[]) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function findMarkdownTables(source: string): MarkdownTableSource[] {
  const lines = source.split('\n')
  const tables: MarkdownTableSource[] = []
  let fenced = false
  for (let start = 0; start < lines.length - 1; start += 1) {
    if (/^\s*(`{3,}|~{3,})/.test(lines[start])) {
      fenced = !fenced
      continue
    }
    if (fenced || !lines[start].includes('|') || !lines[start + 1].includes('|')) continue
    const header = splitMarkdownTableRow(lines[start])
    const divider = splitMarkdownTableRow(lines[start + 1])
    if (header.length < 2 || header.length !== divider.length || !isMarkdownTableDivider(divider)) continue

    const rows = [header]
    let end = start + 1
    while (end + 1 < lines.length && lines[end + 1].includes('|')) {
      const row = splitMarkdownTableRow(lines[end + 1])
      if (row.length !== header.length) break
      rows.push(row)
      end += 1
    }
    tables.push({ start, end, rows, divider })
    start = end
  }
  return tables
}

function tableCellMarkdown(value: string) {
  return value.trim().replace(/\|/g, '\\|')
}

function writeMarkdownTable(tableIndex: number, mutate: (rows: string[][], divider: string[]) => void) {
  if (writingPreviewTable) return
  writingPreviewTable = true
  const lines = editor.value.split('\n')
  const table = findMarkdownTables(editor.value)[tableIndex]
  if (!table) {
    writingPreviewTable = false
    return
  }
  try {
    const rows = table.rows.map((row) => [...row])
    const divider = [...table.divider]
    mutate(rows, divider)
    const width = Math.max(...rows.map((row) => row.length), divider.length)
    rows.forEach((row) => { while (row.length < width) row.push('') })
    while (divider.length < width) divider.push('---')
    const format = (row: string[]) => `| ${row.map(tableCellMarkdown).join(' | ')} |`
    const nextTable = [format(rows[0]), format(divider), ...rows.slice(1).map(format)]
    lines.splice(table.start, table.end - table.start + 1, ...nextTable)
    const next = lines.join('\n')
    if (next === editor.value) return
    recordUndoState()
    editor.value = next
    markdown = next
    renderPreview(next)
    updateCount()
    schedulePersist()
  } finally {
    writingPreviewTable = false
  }
}

function createTableControlButton(label: string, iconPath: string) {
  const button = document.createElement('button')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  button.type = 'button'
  button.className = 'table-edge-btn'
  button.title = label
  button.setAttribute('aria-label', label)
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  path.setAttribute('d', iconPath)
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '2')
  path.setAttribute('stroke-linecap', 'round')
  svg.append(path)
  button.append(svg)
  return button
}

function enhancePreviewTable(table: HTMLTableElement, tableIndex: number) {
  const wrapper = document.createElement('div')
  wrapper.className = 'preview-table-editor'
  table.before(wrapper)
  wrapper.append(table)

  table.querySelectorAll<HTMLTableCellElement>('th, td').forEach((cell) => {
    const row = (cell.closest('tr') as HTMLTableRowElement | null)?.rowIndex ?? 0
    const column = cell.cellIndex
    cell.contentEditable = 'plaintext-only'
    cell.spellcheck = false
    cell.addEventListener('focus', () => { cell.dataset.beforeEdit = cell.textContent || '' })
    cell.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        cell.blur()
      }
      if (event.key === 'Escape') {
        cell.textContent = cell.dataset.beforeEdit || ''
        cell.blur()
      }
    })
    cell.addEventListener('blur', () => {
      const beforeEdit = cell.dataset.beforeEdit
      delete cell.dataset.beforeEdit
      if (beforeEdit === undefined) return
      const value = (cell.textContent || '').replace(/\s+/g, ' ').trim()
      if (value !== beforeEdit) {
        writeMarkdownTable(tableIndex, (rows) => { rows[row][column] = value })
      }
    })
  })

  const rowEdge = document.createElement('div')
  const columnEdge = document.createElement('div')
  const addRow = createTableControlButton('在表格末尾新增一行', 'M12 5v14M5 12h14')
  const removeRow = createTableControlButton('删除表格最后一行', 'M5 12h14')
  const addColumn = createTableControlButton('在表格右侧新增一列', 'M12 5v14M5 12h14')
  const removeColumn = createTableControlButton('删除表格最后一列', 'M5 12h14')
  rowEdge.className = 'table-edge table-row-edge'
  columnEdge.className = 'table-edge table-column-edge'
  removeRow.disabled = (table.tBodies[0]?.rows.length ?? 0) === 0
  removeColumn.disabled = (table.rows[0]?.cells.length ?? 0) <= 2
  rowEdge.append(addRow, removeRow)
  columnEdge.append(addColumn, removeColumn)
  wrapper.append(rowEdge, columnEdge)

  addRow.addEventListener('click', () => {
    writeMarkdownTable(tableIndex, (rows) => rows.push(Array(rows[0].length).fill('')))
  })
  removeRow.addEventListener('click', () => {
    writeMarkdownTable(tableIndex, (rows) => { rows.pop() })
  })
  addColumn.addEventListener('click', () => {
    writeMarkdownTable(tableIndex, (rows, divider) => {
      rows.forEach((row, index) => row.push(index === 0 ? '列名' : ''))
      divider.push('---')
    })
  })
  removeColumn.addEventListener('click', () => {
    writeMarkdownTable(tableIndex, (rows, divider) => {
      rows.forEach((row) => row.pop())
      divider.pop()
    })
  })
}

// ---------- 工具栏：对选区插入 Markdown 标记 ----------

function getSelection() {
  return {
    text: editor.value,
    start: editor.selectionStart ?? 0,
    end: editor.selectionEnd ?? 0,
  }
}

function applyEdit(next: string, start: number, end: number) {
  if (next === editor.value) return
  recordUndoState()
  editor.value = next
  markdown = next
  editor.focus()
  editor.setSelectionRange(start, end)
  renderOnly()
}

function wrapSelection(wrapper: string) {
  const { text, start, end } = getSelection()
  const selected = text.slice(start, end) || '文字'
  const next = text.slice(0, start) + wrapper + selected + wrapper + text.slice(end)
  applyEdit(next, start + wrapper.length, start + wrapper.length + selected.length)
}

function prefixLines(prefix: string) {
  const { text, start, end } = getSelection()
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  const nl = text.indexOf('\n', end)
  const lineEnd = nl === -1 ? text.length : nl
  const block = text.slice(lineStart, lineEnd)
  const prefixed = block.split('\n').map((l) => prefix + l).join('\n')
  const next = text.slice(0, lineStart) + prefixed + text.slice(lineEnd)
  applyEdit(next, lineStart, lineStart + prefixed.length)
}

function insertBlock(block: string) {
  const { text, start, end } = getSelection()
  const next = text.slice(0, start) + block + text.slice(end)
  applyEdit(next, start + block.length, start + block.length)
}

function insertCodeBlock(language: string) {
  const { text, start, end } = getSelection()
  const selected = text.slice(start, end)
  const prefix = start > 0 && text[start - 1] !== '\n' ? '\n' : ''
  const suffix = end < text.length && text[end] !== '\n' ? '\n' : ''
  const opening = `\`\`\`${language}\n`
  const block = `${prefix}${opening}${selected}\n\`\`\`${suffix}`
  const contentStart = start + prefix.length + opening.length
  applyEdit(text.slice(0, start) + block + text.slice(end), contentStart, contentStart + selected.length)
}

/** Tab：无选区插入两个空格；有选区则给选中的每一行加两格缩进 */
function indentOrInsert() {
  const { text, start, end } = getSelection()
  if (start === end) {
    insertBlock('  ')
    return
  }
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  const nl = text.indexOf('\n', end)
  // 选区末尾若停在换行符上，不把下一行算进来
  const lineEnd = nl === -1 ? text.length : (text[end - 1] === '\n' ? end : nl)
  const block = text.slice(lineStart, lineEnd)
  const indented = block.split('\n').map((l) => '  ' + l).join('\n')
  const next = text.slice(0, lineStart) + indented + text.slice(lineEnd)
  applyEdit(next, lineStart, lineStart + indented.length)
}

/** Shift+Tab：去掉选中每一行开头的最多两个空格 */
function outdentSelection() {
  const { text, start, end } = getSelection()
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  const nl = text.indexOf('\n', end)
  const lineEnd = nl === -1 ? text.length : (text[end - 1] === '\n' ? end : nl)
  const block = text.slice(lineStart, lineEnd)
  const outdented = block.split('\n').map((l) => l.replace(/^ {1,2}/, '')).join('\n')
  const next = text.slice(0, lineStart) + outdented + text.slice(lineEnd)
  applyEdit(next, lineStart, lineStart + outdented.length)
}

function continueMarkdownStructure(): boolean {
  const { text, start, end } = getSelection()
  if (start !== end) return false

  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  const nextLine = text.indexOf('\n', start)
  const lineEnd = nextLine === -1 ? text.length : nextLine
  const lineBeforeCaret = text.slice(lineStart, start)
  const fullLine = text.slice(lineStart, lineEnd)
  const emptyList = fullLine.match(/^(\s*)(?:[-+*]|\d+[.)])\s*$/)
  const emptyQuote = fullLine.match(/^(\s*)(?:>\s*)+$/)

  if (emptyList || emptyQuote) {
    const indent = (emptyList ?? emptyQuote)![1]
    const next = text.slice(0, lineStart) + indent + text.slice(lineEnd)
    applyEdit(next, lineStart + indent.length, lineStart + indent.length)
    return true
  }

  const list = lineBeforeCaret.match(/^(\s*)([-+*]|\d+[.)])\s+/)
  if (list) {
    const [, indent, marker] = list
    const nextMarker = /^\d+[.)]$/.test(marker)
      ? `${Number.parseInt(marker, 10) + 1}${marker.at(-1)} `
      : `${marker} `
    const next = text.slice(0, start) + `\n${indent}${nextMarker}` + text.slice(start)
    const caret = start + indent.length + nextMarker.length + 1
    applyEdit(next, caret, caret)
    return true
  }

  const quote = lineBeforeCaret.match(/^(\s*(?:>\s*)+)/)
  if (quote) {
    const prefix = quote[1].endsWith(' ') ? quote[1] : `${quote[1]} `
    const next = text.slice(0, start) + `\n${prefix}` + text.slice(start)
    const caret = start + prefix.length + 1
    applyEdit(next, caret, caret)
    return true
  }

  return false
}


function handleToolbar(action: string) {
  switch (action) {
    case 'h1': return prefixLines('# ')
    case 'h2': return prefixLines('## ')
    case 'bold': return wrapSelection('**')
    case 'italic': return wrapSelection('*')
    case 'list': return prefixLines('- ')
    case 'quote': return prefixLines('> ')
    case 'code':
      return insertCodeBlock('text')
    case 'table':
      return insertBlock('\n| 列名 | 数值 |\n| --- | --- |\n| 示例 | 内容 |\n')
    case 'link': {
      const url = prompt('请输入链接地址', 'https://')
      if (!url) return
      const { text, start, end } = getSelection()
      const label = text.slice(start, end) || '链接文字'
      insertBlock(`[${label}](${url})`)
      return
    }
  }
}

function restoreContextSelection() {
  if (!contextSelection) return
  const start = Math.min(contextSelection.start, editor.value.length)
  const end = Math.min(contextSelection.end, editor.value.length)
  editor.focus()
  editor.setSelectionRange(start, end)
}

function closeEditorContextMenu() {
  editorContextMenu.hidden = true
  editorContextMenu.classList.remove('opens-left')
  contextSubmenuTriggers.forEach((trigger) => {
    trigger.parentElement?.classList.remove('open')
    trigger.setAttribute('aria-expanded', 'false')
  })
  contextSelection = null
}

function openContextSubmenu(trigger: HTMLButtonElement) {
  contextSubmenuTriggers.forEach((item) => {
    const open = item === trigger
    item.parentElement?.classList.toggle('open', open)
    item.setAttribute('aria-expanded', String(open))
  })

  const submenu = trigger.parentElement?.querySelector<HTMLElement>('.editor-context-submenu')
  if (!submenu) return
  submenu.style.top = '-6px'
  const inset = 8
  let top = -6
  let bounds = submenu.getBoundingClientRect()
  if (bounds.bottom > window.innerHeight - inset) {
    top -= bounds.bottom - (window.innerHeight - inset)
    submenu.style.top = `${top}px`
    bounds = submenu.getBoundingClientRect()
  }
  if (bounds.top < inset) submenu.style.top = `${top + inset - bounds.top}px`
}

function openEditorContextMenu(event: MouseEvent) {
  const currentSelection = {
    start: editor.selectionStart ?? 0,
    end: editor.selectionEnd ?? 0,
  }
  contextSelection = pendingContextSelection
    ?? (currentSelection.start !== currentSelection.end ? currentSelection : lastNonEmptySelection)
    ?? currentSelection
  pendingContextSelection = null
  lastNonEmptySelection = null
  editorContextMenu.hidden = false
  const width = editorContextMenu.offsetWidth
  const height = editorContextMenu.offsetHeight
  const left = Math.min(event.clientX, window.innerWidth - width - 8)
  const top = Math.min(event.clientY, window.innerHeight - height - 8)
  editorContextMenu.style.left = `${Math.max(8, left)}px`
  editorContextMenu.style.top = `${Math.max(8, top)}px`
  editorContextMenu.classList.toggle('opens-left', left + width * 2 + 12 > window.innerWidth)
  editorContextMenu.querySelector<HTMLButtonElement>('[data-context-action="copy"]')?.focus({ preventScroll: true })
}

async function copyEditorSelection() {
  const { text, start, end } = getSelection()
  const value = text.slice(start, end) || text
  if (!value) {
    showToast('没有可复制的内容', 'info')
    return
  }
  await navigator.clipboard.writeText(value)
  showToast('已复制', 'success')
}

async function pasteIntoEditor() {
  const value = await navigator.clipboard.readText()
  if (!value) return
  insertBlock(value)
  showToast('已粘贴', 'success')
}

function describeJsonParseError(error: unknown, source: string) {
  const message = errMsg(error)
  const match = message.match(/\bposition (\d+)\b/i)
  if (!match) return `JSON 格式错误：${message}`

  const position = Math.min(Number(match[1]), source.length)
  const beforeError = source.slice(0, position)
  const line = beforeError.split('\n').length
  const column = position - beforeError.lastIndexOf('\n')
  const reason = message
    .replace(/\s*at position \d+(?:\s*\(line \d+ column \d+\))?/i, '')
    .trim()
  return `JSON 格式错误：第 ${line} 行，第 ${column} 列，${reason}`
}

function formatJsonCodeBlock() {
  const { text, start, end } = getSelection()
  const openingFence = text.lastIndexOf('```', start)
  const openingLineEnd = openingFence === -1 ? -1 : text.indexOf('\n', openingFence)
  if (openingLineEnd === -1 || !isJsonLanguage(text.slice(openingFence + 3, openingLineEnd).trim().toLowerCase())) {
    showToast('请将光标放在 JSON 代码块内', 'info')
    return
  }

  const contentStart = openingLineEnd + 1
  const closingFence = text.indexOf('\n```', contentStart)
  if (closingFence === -1 || start < contentStart || end > closingFence) {
    showToast('请将光标放在 JSON 代码块内', 'info')
    return
  }

  try {
    const formatted = JSON.stringify(JSON.parse(text.slice(contentStart, closingFence)), null, 2)
    const next = text.slice(0, contentStart) + formatted + text.slice(closingFence)
    applyEdit(next, contentStart, contentStart + formatted.length)
    showToast('JSON 已格式化', 'success')
  } catch (error) {
    showToast(describeJsonParseError(error, text.slice(contentStart, closingFence)), 'error')
  }
}

// ---------- 文件操作 ----------

function isMarkdownPath(path: string) {
  return /\.(md|markdown|mdown|txt)$/i.test(path)
}

function isImagePath(path: string) {
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(path)
}

function imageAltFromPath(path: string) {
  return fileNameFromPath(path).replace(/\.[^.]+$/, '') || '图片'
}

function markdownImagePath(path: string) {
  return /[\s()]/.test(path) ? `<${path}>` : path
}

async function openMarkdownPath(path: string) {
  const text = await readTextFile(path)
  setCurrentFile(path)
  setMarkdown(text)
  if (!workspaceRoot) {
    workspaceRoot = parentDirectoryFromPath(path)
    rememberRecentFolder(workspaceRoot)
    await renderWorkspaceTree()
  } else {
    renderWorkspaceTree()
  }
  setStatus(`已打开 ${path}`)
}

async function openWorkspaceFolder() {
  const folder = await pickOpenFolder()
  if (!folder) return
  workspaceRoot = folder
  rememberRecentFolder(folder)
  expandedTreeDirectories.clear()
  expandedTreeDirectories.add(folder)
  workspaceLabel.textContent = fileNameFromPath(folder) || folder
  workspaceLabel.title = folder
  await renderWorkspaceTree()
  setStatus(`已打开文件夹 ${folder}`)
}

async function renderWorkspaceTree() {
  if (!workspaceRoot) {
    workspaceLabel.textContent = '文件'
    workspaceLabel.title = '未打开文件夹'
    fileTree.replaceChildren()
    return
  }

  workspaceLabel.textContent = fileNameFromPath(workspaceRoot) || workspaceRoot
  workspaceLabel.title = workspaceRoot
  const fragment = document.createDocumentFragment()
  try {
    await appendTreeEntries(fragment, workspaceRoot, 0)
    fileTree.replaceChildren(fragment)
  } catch (error) {
    fileTree.replaceChildren(Object.assign(document.createElement('p'), {
      className: 'file-tree-empty',
      textContent: `无法读取文件夹：${errMsg(error)}`,
    }))
  }
}

async function appendTreeEntries(container: DocumentFragment | HTMLElement, folder: string, depth: number): Promise<void> {
  const entries = await readDirectory(folder)
  for (const entry of entries) {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'file-tree-row'
    row.style.setProperty('--tree-indent', `${depth * 16}px`)
    row.dataset.path = entry.path
    row.dataset.kind = entry.is_dir ? 'directory' : isImagePath(entry.path) ? 'image' : isMarkdownPath(entry.path) ? 'markdown' : 'file'
    row.title = entry.path

    const icon = document.createElement('span')
    icon.className = 'file-tree-icon'
    icon.textContent = entry.is_dir ? (expandedTreeDirectories.has(entry.path) ? '▾' : '▸') : isImagePath(entry.path) ? '▧' : '·'
    const label = document.createElement('span')
    label.className = 'file-tree-name'
    label.textContent = entry.name
    row.append(icon, label)
    container.append(row)

    if (entry.is_dir && expandedTreeDirectories.has(entry.path)) {
      await appendTreeEntries(container, entry.path, depth + 1)
    }
  }
}

async function insertImageFromPath(path: string) {
  if (!currentFile) {
    showToast('请先保存当前 Markdown 文件，再插入相对路径图片', 'info')
    return
  }
  const relative = await relativePath(currentFile, path)
  insertBlock(`![${imageAltFromPath(path)}](${markdownImagePath(relative)})`)
  showToast('已插入相对路径图片', 'success')
}

async function insertImage() {
  const path = await pickFilePath([{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }])
  if (!path) return
  await insertImageFromPath(path)
}

async function newWorkspaceFile() {
  const parent = workspaceRoot || (currentFile ? parentDirectoryFromPath(currentFile) : null)
  if (!parent) {
    showToast('请先打开文件夹', 'info')
    return
  }
  const requested = prompt('请输入文件名', '新建文档.md')?.trim()
  if (!requested) return
  const name = /\.md$/i.test(requested) ? requested : `${requested}.md`
  const path = await createWorkspaceFile(parent, name)
  workspaceRoot ??= parent
  expandedTreeDirectories.add(parent)
  await renderWorkspaceTree()
  await openMarkdownPath(path)
}

async function newWorkspaceFolder() {
  const parent = workspaceRoot || (currentFile ? parentDirectoryFromPath(currentFile) : null)
  if (!parent) {
    showToast('请先打开文件夹', 'info')
    return
  }
  const name = prompt('请输入文件夹名', '新建文件夹')?.trim()
  if (!name) return
  await createWorkspaceFolder(parent, name)
  workspaceRoot ??= parent
  expandedTreeDirectories.add(parent)
  await renderWorkspaceTree()
  showToast('已新建文件夹', 'success')
}

async function openMarkdown() {
  const picked = await pickOpenFile([{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }], 'text')
  if (!picked) return
  setCurrentFile(picked.filePath)
  setMarkdown(picked.text)
  workspaceRoot = parentDirectoryFromPath(picked.filePath)
  expandedTreeDirectories.clear()
  expandedTreeDirectories.add(workspaceRoot)
  rememberRecentFolder(workspaceRoot)
  await renderWorkspaceTree()
  setStatus(`已打开 ${picked.filePath}`)
}

async function saveMarkdown() {
  const target = currentFile ?? await pickSavePath('文档.md', [{ name: 'Markdown', extensions: ['md'] }])
  if (!target) return
  try {
    await writeTextFile(target, markdown)
    setCurrentFile(target)
    if (!workspaceRoot) {
      workspaceRoot = parentDirectoryFromPath(target)
      rememberRecentFolder(workspaceRoot)
      await renderWorkspaceTree()
    } else {
      void renderWorkspaceTree()
    }
    setStatus(`已保存到 ${target}`)
    showToast('已保存', 'success')
  } catch (err) {
    setStatus(`保存失败：${errMsg(err)}`)
    showToast(`保存失败：${errMsg(err)}`, 'error')
  }
}

async function saveMarkdownAs() {
  const target = await pickSavePath(currentFile ? fileNameFromPath(currentFile) : '文档.md', [{ name: 'Markdown', extensions: ['md'] }])
  if (!target) return
  try {
    await writeTextFile(target, markdown)
    setCurrentFile(target)
    if (!workspaceRoot) {
      workspaceRoot = parentDirectoryFromPath(target)
      rememberRecentFolder(workspaceRoot)
    }
    await renderWorkspaceTree()
    setStatus(`已另存为 ${target}`)
    showToast('已另存为', 'success')
  } catch (err) {
    showToast(`另存失败：${errMsg(err)}`, 'error')
  }
}

async function convertOfficeToMarkdown(kind: 'docx' | 'xlsx') {
  const label = kind === 'docx' ? 'Word' : 'Excel'
  const picked = await pickOpenFile(
    [{ name: label, extensions: [kind] }],
    'bytes',
  )
  if (!picked) return

  setBusy(true, `正在转换 ${label}…`)
  try {
    const md = kind === 'docx'
      ? await docxToMarkdown(picked.buffer)
      : xlsxToMarkdown(picked.buffer)

    const target = await pickSavePath(swapExtension(picked.filePath, '.md'), [{ name: 'Markdown', extensions: ['md'] }])
    if (!target) return
    await writeTextFile(target, md)
    setCurrentFile(target)
    setMarkdown(md)
    setStatus(`已把 ${label} 文件转换成 Markdown`)
    showToast(`已把 ${label} 转成 Markdown`, 'success')
  } catch (err) {
    setStatus(`转换失败：${errMsg(err)}`)
    showToast(`转换失败：${errMsg(err)}`, 'error')
  } finally {
    setBusy(false)
  }
}

async function exportHtml() {
  // 先选要导出的 .md 文件，再选输出位置
  const picked = await pickOpenFile(
    [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    'text',
  )
  if (!picked) return
  const target = await pickSavePath(swapExtension(picked.filePath, '.html'), [
    { name: 'HTML', extensions: ['html'] },
  ])
  if (!target) return
  setBusy(true, '正在导出 HTML…')
  try {
    const html = buildHtmlDocument(picked.text, 'MarkFlow 导出文档')
    await writeTextFile(target, html)
    setMarkdown(picked.text)
    setCurrentFile(picked.filePath)
    setStatus(`已导出 HTML 到 ${target}`)
    showToast('已导出 HTML', 'success')
  } catch (err) {
    setStatus(`导出失败：${errMsg(err)}`)
    showToast(`导出失败：${errMsg(err)}`, 'error')
  } finally {
    setBusy(false)
  }
}

async function exportDocx() {
  // 先选要导出的 .md 文件，再选输出位置
  const picked = await pickOpenFile(
    [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    'text',
  )
  if (!picked) return
  const target = await pickSavePath(swapExtension(picked.filePath, '.docx'), [
    { name: 'Word', extensions: ['docx'] },
  ])
  if (!target) return
  setBusy(true, '正在导出 Word…')
  try {
    const blob = await markdownToDocxBlob(picked.text)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    await writeBytesFile(target, bytes)
    setMarkdown(picked.text)
    setCurrentFile(picked.filePath)
    setStatus(`已导出 Word 到 ${target}`)
    showToast('已导出 Word', 'success')
  } catch (err) {
    setStatus(`导出失败：${errMsg(err)}`)
    showToast(`导出失败：${errMsg(err)}`, 'error')
  } finally {
    setBusy(false)
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ---------- 绑定事件 ----------

document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((btn) => {
  btn.addEventListener('click', () => handleToolbar(btn.dataset.action!))
})

document.querySelectorAll<HTMLButtonElement>('[data-file]').forEach((btn) => {
  const type = btn.dataset.file!
  btn.addEventListener('click', () => {
    const action = type === 'new-file' ? newWorkspaceFile
      : type === 'new-folder' ? newWorkspaceFolder
      : type === 'new-window' ? newWindow
      : type === 'open-md' ? openMarkdown
      : type === 'open-folder' ? openWorkspaceFolder
      : type === 'save-md' ? saveMarkdown
      : type === 'save-as' ? saveMarkdownAs
      : type === 'docx-to-md' ? () => convertOfficeToMarkdown('docx')
      : type === 'xlsx-to-md' ? () => convertOfficeToMarkdown('xlsx')
      : type === 'md-to-docx' ? exportDocx
      : type === 'export-html' ? exportHtml
      : null
    if (action) void action().catch((error) => showToast(`操作失败：${errMsg(error)}`, 'error'))
  })
})

fileTree.addEventListener('click', (event) => {
  const row = (event.target as Element | null)?.closest<HTMLButtonElement>('.file-tree-row')
  if (!row) return
  const path = row.dataset.path
  const kind = row.dataset.kind
  if (!path || !kind) return
  if (kind === 'directory') {
    if (expandedTreeDirectories.has(path)) expandedTreeDirectories.delete(path)
    else expandedTreeDirectories.add(path)
    void renderWorkspaceTree()
  } else if (kind === 'markdown') {
    void openMarkdownPath(path).catch((error) => showToast(`打开失败：${errMsg(error)}`, 'error'))
  } else if (kind === 'image') {
    void insertImageFromPath(path).catch((error) => showToast(`插入图片失败：${errMsg(error)}`, 'error'))
  }
})

editor.addEventListener('beforeinput', (event) => {
  if (!event.inputType.startsWith('history')) recordUndoState()
})
editor.addEventListener('input', () => {
  lastNonEmptySelection = null
  renderOnly()
})

editor.addEventListener('select', () => {
  const start = editor.selectionStart ?? 0
  const end = editor.selectionEnd ?? 0
  if (start !== end) lastNonEmptySelection = { start, end }
})
editor.addEventListener('pointerdown', (event) => {
  if (event.button !== 2) {
    lastNonEmptySelection = null
    return
  }
  pendingContextSelection = {
    start: editor.selectionStart ?? 0,
    end: editor.selectionEnd ?? 0,
  }
})
editor.addEventListener('contextmenu', (event) => {
  event.preventDefault()
  openEditorContextMenu(event)
})

contextSubmenuTriggers.forEach((trigger) => {
  const wrapper = trigger.parentElement!
  wrapper.addEventListener('pointerenter', () => openContextSubmenu(trigger))
  wrapper.addEventListener('pointerleave', () => {
    wrapper.classList.remove('open')
    trigger.setAttribute('aria-expanded', 'false')
  })
  trigger.addEventListener('click', () => openContextSubmenu(trigger))
  trigger.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight') return
    event.preventDefault()
    openContextSubmenu(trigger)
    wrapper.querySelector<HTMLButtonElement>('.editor-context-submenu button')?.focus()
  })
})

editorContextMenu.addEventListener('click', async (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  if (target.closest('[data-context-submenu]')) return

  const language = target.closest<HTMLButtonElement>('[data-context-code]')?.dataset.contextCode
  const action = target.closest<HTMLButtonElement>('[data-context-action]')?.dataset.contextAction
  if (!language && !action) return

  restoreContextSelection()
  try {
    if (language) insertCodeBlock(language)
    else if (action === 'copy') await copyEditorSelection()
    else if (action === 'paste') await pasteIntoEditor()
    else if (action === 'format-json') formatJsonCodeBlock()
    else if (action === 'image') await insertImage()
    else if (action === 'table' || action === 'quote') handleToolbar(action)
  } catch (err) {
    showToast(`操作失败：${errMsg(err)}`, 'error')
  }
  closeEditorContextMenu()
})

document.addEventListener('pointerdown', (event) => {
  if (!editorContextMenu.hidden && !editorContextMenu.contains(event.target as Node)) closeEditorContextMenu()
})
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !editorContextMenu.hidden) closeEditorContextMenu()
})
window.addEventListener('resize', closeEditorContextMenu)
editor.addEventListener('scroll', closeEditorContextMenu)

// ---------- 外部链接：拦截点击，用系统浏览器打开，绝不接管当前窗口 ----------

const EXTERNAL_HREF = /^(https?:|mailto:|tel:|ftp:|file:)/i

function handleExternalLink(e: Event, anchor: HTMLAnchorElement) {
  const href = anchor.getAttribute('href') || ''
  if (!EXTERNAL_HREF.test(href)) return false
  e.preventDefault()
  e.stopPropagation()
  openUrl(href)
    .then(() => showToast('已在浏览器打开链接', 'info'))
    .catch((err) => showToast(`无法打开链接：${errMsg(err)}`, 'error'))
  return true
}

// 捕获阶段：左键点击
document.addEventListener('click', (e) => {
  const anchor = (e.target as HTMLElement | null)?.closest?.('a')
  if (anchor) handleExternalLink(e, anchor)
}, true)
// 中键点击（新标签意图）
document.addEventListener('auxclick', (e) => {
  if ((e as MouseEvent).button !== 1) return
  const anchor = (e.target as HTMLElement | null)?.closest?.('a')
  if (anchor) handleExternalLink(e, anchor)
}, true)

editor.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && continueMarkdownStructure()) {
    e.preventDefault()
    return
  }
  // Tab 不带 Ctrl/Meta，必须单独、优先处理，否则会被默认行为（跳走焦点）吃掉
  if (e.key === 'Tab') {
    e.preventDefault()
    if (e.shiftKey) outdentSelection()
    else indentOrInsert()
    return
  }
  if (!(e.ctrlKey || e.metaKey)) return
  const key = e.key.toLowerCase()
  if (key === 'i') { e.preventDefault(); wrapSelection('*') }
})

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z' && undoMarkdown()) {
    e.preventDefault()
    return
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
    e.preventDefault()
    toggleFileTree()
    return
  }
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return
  const zoomIn = e.key === '+' || e.key === '=' || e.code === 'NumpadAdd'
  const zoomOut = e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract'
  const zoomReset = e.key === '0' || e.code === 'Numpad0'
  if (!zoomIn && !zoomOut && !zoomReset) return
  e.preventDefault()
  if (zoomReset) setContentZoom(100)
  else setContentZoom(contentZoom + (zoomIn ? CONTENT_ZOOM_STEP : -CONTENT_ZOOM_STEP))
}, true)

window.addEventListener('wheel', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return
  e.preventDefault()
  if (e.deltaY === 0) return
  const now = performance.now()
  if (now - lastWheelZoomAt < 80) return
  lastWheelZoomAt = now
  setContentZoom(contentZoom + (e.deltaY < 0 ? CONTENT_ZOOM_STEP : -CONTENT_ZOOM_STEP))
}, { passive: false })

// ---------- 顶栏下拉菜单 ----------

const conversionBtn = document.querySelector<HTMLButtonElement>('#conversion-btn')!
const conversionMenu = document.querySelector<HTMLElement>('#conversion-menu')!

function isConversionMenuOpen() {
  return conversionMenu.classList.contains('open')
}
function toggleConversionMenu(open: boolean) {
  conversionMenu.classList.toggle('open', open)
  conversionBtn.setAttribute('aria-expanded', String(open))
}

conversionBtn.addEventListener('click', (event) => {
  event.stopPropagation()
  toggleConversionMenu(!isConversionMenuOpen())
})
conversionMenu.addEventListener('click', () => toggleConversionMenu(false))

function isFileMenuOpen() {
  return fileMenu.classList.contains('open')
}

function toggleFileMenu(open: boolean) {
  fileMenu.classList.toggle('open', open)
  fileBtn.setAttribute('aria-expanded', String(open))
  if (!open) {
    recentFilesList.hidden = true
    recentFilesBtn.setAttribute('aria-expanded', 'false')
  }
}

function renderRecentFolderList() {
  const recent = loadRecentFolders()
  recentFilesList.replaceChildren()
  if (!recent.length) {
    const empty = document.createElement('span')
    empty.className = 'recent-files-empty'
    empty.textContent = '暂无最近文件夹'
    recentFilesList.append(empty)
    return
  }
  for (const path of recent) {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.recentPath = path
    button.title = path
    button.textContent = fileNameFromPath(path)
    recentFilesList.append(button)
  }
}

function positionRecentFilesMenu() {
  recentFilesList.classList.remove('opens-left')
  recentFilesList.style.top = '-4px'
  const inset = 8
  let bounds = recentFilesList.getBoundingClientRect()
  if (bounds.right > window.innerWidth - inset) {
    recentFilesList.classList.add('opens-left')
    bounds = recentFilesList.getBoundingClientRect()
  }
  if (bounds.bottom > window.innerHeight - inset) {
    recentFilesList.style.top = `${-4 - (bounds.bottom - (window.innerHeight - inset))}px`
  }
}

async function openRecentFolder(path: string) {
  try {
    await readDirectory(path)
    workspaceRoot = path
    expandedTreeDirectories.clear()
    expandedTreeDirectories.add(path)
    await renderWorkspaceTree()
    rememberRecentFolder(path)
    setStatus(`已打开文件夹 ${path}`)
    toggleFileMenu(false)
  } catch (error) {
    const retained = loadRecentFolders().filter((item) => item !== path)
    localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(retained))
    renderRecentFolderList()
    showToast(`无法打开最近文件夹：${errMsg(error)}`, 'error')
  }
}

fileBtn.addEventListener('click', (event) => {
  event.stopPropagation()
  toggleConversionMenu(false)
  toggleSettingsMenu(false)
  toggleFileMenu(!isFileMenuOpen())
})
fileMenu.addEventListener('click', (event) => {
  if ((event.target as Element | null)?.closest('[data-file]')) toggleFileMenu(false)
})
recentFilesBtn.addEventListener('click', (event) => {
  event.stopPropagation()
  const open = recentFilesList.hidden
  renderRecentFolderList()
  recentFilesList.hidden = !open
  recentFilesBtn.setAttribute('aria-expanded', String(open))
  if (open) positionRecentFilesMenu()
})
recentFilesList.addEventListener('click', (event) => {
  const path = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-recent-path]')?.dataset.recentPath
  if (path) void openRecentFolder(path)
})

// ---------- 设置菜单：文件关联 / 设为默认 ----------

const settingsBtn = document.querySelector<HTMLElement>('#settings-btn')!
const settingsMenu = document.querySelector<HTMLElement>('#settings-menu')!

function isMenuOpen() {
  return settingsMenu.classList.contains('open')
}
function toggleSettingsMenu(open: boolean) {
  settingsMenu.classList.toggle('open', open)
  settingsBtn.setAttribute('aria-expanded', String(open))
}

settingsBtn.addEventListener('click', (e) => {
  e.stopPropagation()
  toggleSettingsMenu(!isMenuOpen())
})

appearanceSettingsBtn.addEventListener('click', (e) => {
  e.stopPropagation()
  toggleSettingsMenu(false)
  if (!appearanceDialog.open) appearanceDialog.showModal()
})

appearanceDialog.addEventListener('click', (e) => {
  if (e.target === appearanceDialog) appearanceDialog.close()
})

appearanceDialog.addEventListener('close', () => appearanceSettingsBtn.focus())

backgroundColorInput.addEventListener('input', () => {
  updateAppearance({ backgroundColor: backgroundColorInput.value })
})
backgroundOpacityInput.addEventListener('input', () => {
  updateAppearance({ backgroundOpacity: Number(backgroundOpacityInput.value) })
})
panelOpacityInput.addEventListener('input', () => {
  updateAppearance({ panelOpacity: Number(panelOpacityInput.value) })
})
codeBlockOpacityInput.addEventListener('input', () => {
  updateAppearance({ codeBlockOpacity: Number(codeBlockOpacityInput.value) })
})
adaptiveContrastToggle.addEventListener('click', () => {
  updateAppearance({ adaptiveContrastEnabled: !appearanceSettings.adaptiveContrastEnabled })
})
panelBlurToggle.addEventListener('click', () => {
  updateAppearance({ panelBlurEnabled: !appearanceSettings.panelBlurEnabled })
})
buttonTextColorInput.addEventListener('input', () => {
  updateAppearance({ buttonTextColor: buttonTextColorInput.value })
})
editorColorInput.addEventListener('input', () => {
  updateAppearance({ editorColor: editorColorInput.value })
})
previewColorInput.addEventListener('input', () => {
  updateAppearance({ previewColor: previewColorInput.value })
})

chooseBackgroundBtn.addEventListener('click', () => backgroundFileInput.click())
backgroundFileInput.addEventListener('change', async () => {
  const file = backgroundFileInput.files?.[0]
  backgroundFileInput.value = ''
  if (!file) return
  const kind = backgroundKind(file)
  if (!kind) {
    showToast('请选择 PNG、JPG、WebP、GIF、MP4 或 WebM 文件', 'error')
    return
  }
  if (file.size > MAX_BACKGROUND_BYTES) {
    showToast('背景文件不能超过 100 MB', 'error')
    return
  }

  const asset: StoredBackgroundAsset = { blob: file, name: file.name, type: file.type }
  showBackgroundAsset(asset)
  if (appearanceSettings.backgroundOpacity === 0) updateAppearance({ backgroundOpacity: 100 })
  try {
    await saveBackgroundAsset(asset)
    showToast(kind === 'video' || /\.gif$/i.test(file.name) ? '动态背景已应用' : '背景已应用', 'success')
  } catch (err) {
    showToast(`背景已应用，但保存失败：${errMsg(err)}`, 'error')
  }
})

clearBackgroundBtn.addEventListener('click', async () => {
  try {
    await clearBackgroundAsset()
    showBackgroundAsset(null)
    showToast('背景素材已清除', 'success')
  } catch (err) {
    showToast(`清除背景失败：${errMsg(err)}`, 'error')
  }
})

resetAppearanceBtn.addEventListener('click', async () => {
  appearanceSettings = { ...DEFAULT_APPEARANCE }
  applyAppearance(appearanceSettings)
  try { saveAppearanceSettings(appearanceSettings) } catch { /* 保留当前会话效果 */ }
  showBackgroundAsset(null)
  try {
    await clearBackgroundAsset()
    showToast('外观已恢复默认', 'success')
  } catch (err) {
    showToast(`外观已恢复，背景存储清理失败：${errMsg(err)}`, 'error')
  }
})

document.addEventListener('visibilitychange', () => {
  if (!customBackground.classList.contains('has-video')) return
  if (document.hidden || appearanceSettings.backgroundOpacity === 0) backgroundVideo.pause()
  else void backgroundVideo.play().catch(() => undefined)
})

// 点击菜单外部收起
document.addEventListener('click', () => {
  toggleSettingsMenu(false)
  toggleConversionMenu(false)
  toggleFileMenu(false)
})
// ESC 收起
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isMenuOpen()) {
    toggleSettingsMenu(false)
    settingsBtn.focus()
  }
  if (e.key === 'Escape' && isConversionMenuOpen()) {
    toggleConversionMenu(false)
    conversionBtn.focus()
  }
  if (e.key === 'Escape' && isFileMenuOpen()) {
    toggleFileMenu(false)
    fileBtn.focus()
  }
})

document.querySelectorAll<HTMLButtonElement>('[data-setting]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    toggleSettingsMenu(false)
    const action = btn.dataset.setting
    setBusy(true)
    try {
      if (action === 'open-with') {
        await registerMdHandler()
        showToast('已启用 Markdown 打开方式与新建菜单', 'success')
        setStatus('已注册 .md 打开方式和「新建」菜单')
      } else if (action === 'default-app') {
        await registerMdHandler()
        await openDefaultAppsSettings()
        showToast('已打开系统设置，请在 .md 中选择 MarkFlow', 'info')
        setStatus('请在系统「默认应用」里把 .md 设为 MarkFlow')
      }
    } catch (err) {
      showToast(`操作失败：${errMsg(err)}`, 'error')
      setStatus(`操作失败：${errMsg(err)}`)
    } finally {
      setBusy(false)
    }
  })
})

preview.addEventListener('click', async (e) => {
  const target = e.target
  if (!(target instanceof Element)) return
  const button = target.closest<HTMLButtonElement>('.code-copy-btn')
  if (!button || !preview.contains(button)) return
  const code = button.closest('.code-block')?.querySelector('code')
  if (!code) return
  try {
    await navigator.clipboard.writeText(codeBlockText(code))
    setCodeCopyButtonState(button, true)
    showToast('已复制代码', 'success')
    setTimeout(() => { setCodeCopyButtonState(button) }, 1600)
  } catch (err) {
    showToast(`复制失败：${errMsg(err)}`, 'error')
  }
})

preview.addEventListener('dblclick', (e) => {
  const target = e.target
  if (!(target instanceof Element)) return
  const cell = target.closest<HTMLTableCellElement>('th, td')
  if (!cell || !preview.contains(cell)) return
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  range.selectNodeContents(cell)
  selection.removeAllRanges()
  selection.addRange(range)
})

let scrollSyncSource: HTMLElement | null = null
let scrollSyncFrame: number | null = null

function syncScroll(source: HTMLElement, target: HTMLElement) {
  if (restoringZoomScroll) return
  if (scrollSyncSource && scrollSyncSource !== source) return
  const sourceRange = source.scrollHeight - source.clientHeight
  const targetRange = target.scrollHeight - target.clientHeight
  scrollSyncSource = source
  target.scrollTop = sourceRange > 0 ? (source.scrollTop / sourceRange) * targetRange : 0
  if (scrollSyncFrame !== null) cancelAnimationFrame(scrollSyncFrame)
  scrollSyncFrame = requestAnimationFrame(() => {
    scrollSyncSource = null
    scrollSyncFrame = null
  })
}

editor.addEventListener('scroll', () => syncScroll(editor, preview))
preview.addEventListener('scroll', () => syncScroll(preview, editor))

// ---------- 可拖拽分栏（编辑器 / 预览宽度） ----------

const splitter = document.querySelector<HTMLElement>('#splitter')!
const fileTreeSplitter = document.querySelector<HTMLElement>('#file-tree-splitter')!
const workspace = document.querySelector<HTMLElement>('#workspace')!
const editorToggleBtn = document.querySelector<HTMLButtonElement>('#editor-toggle-btn')!
const editorToggleLabel = document.querySelector<HTMLElement>('#editor-toggle-label')!
const SPLIT_KEY = 'exchangemd:split'
const FILE_TREE_HIDDEN_KEY = 'markflow:fileTreeHidden'
const FILE_TREE_WIDTH_KEY = 'markflow:fileTreeWidth'

function setFileTreeVisible(visible: boolean) {
  workspace.classList.toggle('file-tree-hidden', !visible)
  fileTreeToggleBtn.setAttribute('aria-expanded', String(visible))
  fileTreeToggleBtn.title = visible ? '收起文件树' : '展开文件树'
}

setFileTreeVisible(localStorage.getItem(FILE_TREE_HIDDEN_KEY) !== 'true')
function toggleFileTree() {
  const visible = workspace.classList.contains('file-tree-hidden')
  setFileTreeVisible(visible)
  localStorage.setItem(FILE_TREE_HIDDEN_KEY, String(!visible))
}
fileTreeToggleBtn.addEventListener('click', toggleFileTree)

editorToggleBtn.addEventListener('click', () => {
  const hidden = !workspace.classList.contains('editor-hidden')
  workspace.classList.toggle('editor-hidden', hidden)
  editorToggleBtn.setAttribute('aria-expanded', String(!hidden))
  editorToggleBtn.title = hidden ? '展开编辑区' : '隐藏编辑区'
  editorToggleLabel.textContent = hidden ? '展开编辑区' : '隐藏编辑区'
})

function applySplit(pct: number): number {
  const clamped = Math.min(80, Math.max(20, pct))
  workspace.style.setProperty('--split', `${clamped}%`)
  return clamped
}

function applyFileTreeWidth(width: number): number {
  const max = Math.max(160, Math.min(640, workspace.clientWidth - 530))
  const clamped = Math.min(max, Math.max(160, width))
  workspace.style.setProperty('--tree-width', `${clamped}px`)
  workspace.style.setProperty('--tree-editor-offset', `${Math.round(clamped / 2)}px`)
  return clamped
}

const savedSplit = parseFloat(localStorage.getItem(SPLIT_KEY) || '')
if (!isNaN(savedSplit)) applySplit(savedSplit)
const savedFileTreeWidth = parseFloat(localStorage.getItem(FILE_TREE_WIDTH_KEY) || '')
if (!isNaN(savedFileTreeWidth)) applyFileTreeWidth(savedFileTreeWidth)

function startDrag(clientX: number) {
  splitter.classList.add('dragging')
  document.body.style.cursor = 'col-resize'
  const rect = workspace.getBoundingClientRect()
  const onMove = (ev: MouseEvent) => applySplit(((ev.clientX - rect.left) / rect.width) * 100)
  const onUp = () => {
    splitter.classList.remove('dragging')
    document.body.style.cursor = ''
    localStorage.setItem(SPLIT_KEY, workspace.style.getPropertyValue('--split') || '54%')
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

splitter.addEventListener('mousedown', (e) => {
  e.preventDefault()
  startDrag(e.clientX)
})

function startFileTreeDrag(clientX: number) {
  fileTreeSplitter.classList.add('dragging')
  document.body.style.cursor = 'col-resize'
  const rect = workspace.getBoundingClientRect()
  const onMove = (ev: MouseEvent) => applyFileTreeWidth(ev.clientX - rect.left)
  const onUp = () => {
    fileTreeSplitter.classList.remove('dragging')
    document.body.style.cursor = ''
    localStorage.setItem(FILE_TREE_WIDTH_KEY, workspace.style.getPropertyValue('--tree-width') || '230px')
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

fileTreeSplitter.addEventListener('mousedown', (e) => {
  e.preventDefault()
  startFileTreeDrag(e.clientX)
})
// 键盘可达：左右方向键微调（可访问性）
splitter.addEventListener('keydown', (e) => {
  const cur = parseFloat(workspace.style.getPropertyValue('--split')) || 54
  if (e.key === 'ArrowLeft') { e.preventDefault(); localStorage.setItem(SPLIT_KEY, applySplit(cur - 2) + '%') }
  else if (e.key === 'ArrowRight') { e.preventDefault(); localStorage.setItem(SPLIT_KEY, applySplit(cur + 2) + '%') }
})
fileTreeSplitter.addEventListener('keydown', (e) => {
  const current = parseFloat(workspace.style.getPropertyValue('--tree-width')) || 230
  if (e.key === 'ArrowLeft') { e.preventDefault(); localStorage.setItem(FILE_TREE_WIDTH_KEY, `${applyFileTreeWidth(current - 20)}px`) }
  else if (e.key === 'ArrowRight') { e.preventDefault(); localStorage.setItem(FILE_TREE_WIDTH_KEY, `${applyFileTreeWidth(current + 20)}px`) }
})

// ---------- 启动初始化 ----------

async function init() {
  try {
    const launchFile = await getLaunchFile()
    if (launchFile) {
      const text = await readTextFile(launchFile)
      setCurrentFile(launchFile)
      setMarkdown(text)
      setStatus(`已打开 ${currentFile}`)
      return
    }
  } catch (err) {
    setStatus(`打开传入文件失败：${errMsg(err)}`)
  }
  restoreSession()
  setStatus('就绪')
}

applyAppearance(appearanceSettings)
enableAdaptiveButtonLabels()
void restoreBackground()
void init()
setTimeout(() => void checkForUpdate(), 1200)
