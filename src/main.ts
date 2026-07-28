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
  pickSavePath,
  writeTextFile,
  writeBytesFile,
  readTextFile,
  swapExtension,
  getLaunchFile,
  registerMdHandler,
  openDefaultAppsSettings,
  openUrl,
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

const SAMPLE = `# 欢迎使用 ExchangeMD

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

> 提示：支持 **Ctrl+B** 加粗、**Ctrl+I** 斜体。
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
const appearanceSettingsBtn = document.querySelector<HTMLButtonElement>('#appearance-settings-btn')!
const chooseBackgroundBtn = document.querySelector<HTMLButtonElement>('#choose-background-btn')!
const clearBackgroundBtn = document.querySelector<HTMLButtonElement>('#clear-background-btn')!
const backgroundFileInput = document.querySelector<HTMLInputElement>('#background-file-input')!
const backgroundFileName = document.querySelector<HTMLElement>('#background-file-name')!
const backgroundColorInput = document.querySelector<HTMLInputElement>('#background-color-input')!
const backgroundOpacityInput = document.querySelector<HTMLInputElement>('#background-opacity-input')!
const backgroundOpacityValue = document.querySelector<HTMLOutputElement>('#background-opacity-value')!
const panelOpacityInput = document.querySelector<HTMLInputElement>('#panel-opacity-input')!
const panelOpacityValue = document.querySelector<HTMLOutputElement>('#panel-opacity-value')!
const panelBlurToggle = document.querySelector<HTMLButtonElement>('#panel-blur-toggle')!
const panelBlurValue = document.querySelector<HTMLElement>('#panel-blur-value')!
const editorColorInput = document.querySelector<HTMLInputElement>('#editor-color-input')!
const previewColorInput = document.querySelector<HTMLInputElement>('#preview-color-input')!
const resetAppearanceBtn = document.querySelector<HTMLButtonElement>('#reset-appearance-btn')!
const editorContextMenu = document.querySelector<HTMLElement>('#editor-context-menu')!
const contextSubmenuTriggers = [...editorContextMenu.querySelectorAll<HTMLButtonElement>('[data-context-submenu]')]
let toastTimer: ReturnType<typeof setTimeout> | null = null
let appearanceSettings = loadAppearanceSettings()
let backgroundObjectUrl: string | null = null
let contextSelection: { start: number; end: number } | null = null
let pendingContextSelection: { start: number; end: number } | null = null
let lastNonEmptySelection: { start: number; end: number } | null = null

let markdown = SAMPLE
let currentFile: string | null = null
let busy = false

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
      if (saved.currentFile) {
        currentFile = saved.currentFile
        fileLabel.textContent = currentFile
      }
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

// ---------- 外观设置 ----------

const MAX_BACKGROUND_BYTES = 100 * 1024 * 1024

function applyAppearance(settings: AppearanceSettings) {
  const root = document.documentElement
  const panelOpacity = settings.panelOpacity / 100
  root.style.setProperty('--bg', settings.backgroundColor)
  root.style.setProperty('--background-opacity', String(settings.backgroundOpacity / 100))
  root.style.setProperty('--panel-opacity', String(panelOpacity))
  root.style.setProperty('--panel-highlight-opacity', String(panelOpacity * 0.28))
  root.style.setProperty('--panel-sheen-opacity', String(panelOpacity * 0.36))
  root.style.setProperty('--panel-reflection-opacity', String(panelOpacity * 0.19))
  root.style.setProperty('--panel-soft-opacity', String(panelOpacity * 0.06))
  root.style.setProperty('--panel-header-opacity', String(panelOpacity * 0.4))
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
  root.style.setProperty('--panel-blur', settings.panelBlurEnabled ? '18px' : '0px')
  root.style.setProperty('--panel-header-blur', settings.panelBlurEnabled ? '12px' : '0px')
  root.style.setProperty('--editor-text', settings.editorColor)
  root.style.setProperty('--preview-text', settings.previewColor)

  backgroundColorInput.value = settings.backgroundColor
  backgroundOpacityInput.value = String(settings.backgroundOpacity)
  backgroundOpacityValue.value = `${settings.backgroundOpacity}%`
  panelOpacityInput.value = String(settings.panelOpacity)
  panelOpacityValue.value = `${settings.panelOpacity}%`
  panelBlurToggle.setAttribute('aria-checked', String(settings.panelBlurEnabled))
  panelBlurValue.textContent = settings.panelBlurEnabled ? '开启' : '关闭'
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

function renderPreview(value: string) {
  preview.innerHTML = renderMarkdown(value)
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
  } catch {
    showToast('JSON 格式无效，无法格式化', 'error')
  }
}

// ---------- 文件操作 ----------

async function openMarkdown() {
  const picked = await pickOpenFile([{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }], 'text')
  if (!picked) return
  currentFile = picked.filePath
  fileLabel.textContent = currentFile
  setMarkdown(picked.text)
  setStatus(`已打开 ${currentFile}`)
  showToast('已打开文件', 'success')
}

async function saveMarkdown() {
  const target = currentFile ?? await pickSavePath('文档.md', [{ name: 'Markdown', extensions: ['md'] }])
  if (!target) return
  try {
    await writeTextFile(target, markdown)
    currentFile = target
    fileLabel.textContent = currentFile
    setStatus(`已保存到 ${target}`)
    showToast('已保存', 'success')
  } catch (err) {
    setStatus(`保存失败：${errMsg(err)}`)
    showToast(`保存失败：${errMsg(err)}`, 'error')
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
    currentFile = target
    fileLabel.textContent = target
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
    const html = buildHtmlDocument(picked.text, 'ExchangeMD 导出文档')
    await writeTextFile(target, html)
    setMarkdown(picked.text)
    currentFile = picked.filePath
    fileLabel.textContent = picked.filePath
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
    currentFile = picked.filePath
    fileLabel.textContent = picked.filePath
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
    if (type === 'open-md') return openMarkdown()
    if (type === 'save-md') return saveMarkdown()
    if (type === 'docx-to-md') return convertOfficeToMarkdown('docx')
    if (type === 'xlsx-to-md') return convertOfficeToMarkdown('xlsx')
    if (type === 'md-to-docx') return exportDocx()
    if (type === 'export-html') return exportHtml()
  })
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
  // Tab 不带 Ctrl/Meta，必须单独、优先处理，否则会被默认行为（跳走焦点）吃掉
  if (e.key === 'Tab') {
    e.preventDefault()
    if (e.shiftKey) outdentSelection()
    else indentOrInsert()
    return
  }
  if (!(e.ctrlKey || e.metaKey)) return
  const key = e.key.toLowerCase()
  if (key === 'b') { e.preventDefault(); wrapSelection('**') }
  else if (key === 'i') { e.preventDefault(); wrapSelection('*') }
})

document.addEventListener('keydown', (e) => {
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
panelBlurToggle.addEventListener('click', () => {
  updateAppearance({ panelBlurEnabled: !appearanceSettings.panelBlurEnabled })
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
document.addEventListener('click', () => toggleSettingsMenu(false))
// ESC 收起
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isMenuOpen()) {
    toggleSettingsMenu(false)
    settingsBtn.focus()
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
        showToast('已加入右键「打开方式」', 'success')
        setStatus('已注册到 .md 打开方式列表')
      } else if (action === 'default-app') {
        await registerMdHandler()
        await openDefaultAppsSettings()
        showToast('已打开系统设置，请在 .md 中选择 ExchangeMD', 'info')
        setStatus('请在系统「默认应用」里把 .md 设为 ExchangeMD')
      }
    } catch (err) {
      showToast(`操作失败：${errMsg(err)}`, 'error')
      setStatus(`操作失败：${errMsg(err)}`)
    } finally {
      setBusy(false)
    }
  })
})

// ---------- 复制按钮 ----------

document.querySelector<HTMLElement>('#copy-btn')!.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(editor.value)
    showToast('已复制 Markdown 源码', 'success')
  } catch (err) {
    showToast(`复制失败：${errMsg(err)}`, 'error')
  }
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
const workspace = document.querySelector<HTMLElement>('#workspace')!
const editorToggleBtn = document.querySelector<HTMLButtonElement>('#editor-toggle-btn')!
const editorToggleLabel = document.querySelector<HTMLElement>('#editor-toggle-label')!
const SPLIT_KEY = 'exchangemd:split'

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

const savedSplit = parseFloat(localStorage.getItem(SPLIT_KEY) || '')
if (!isNaN(savedSplit)) applySplit(savedSplit)

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
// 键盘可达：左右方向键微调（可访问性）
splitter.addEventListener('keydown', (e) => {
  const cur = parseFloat(workspace.style.getPropertyValue('--split')) || 54
  if (e.key === 'ArrowLeft') { e.preventDefault(); localStorage.setItem(SPLIT_KEY, applySplit(cur - 2) + '%') }
  else if (e.key === 'ArrowRight') { e.preventDefault(); localStorage.setItem(SPLIT_KEY, applySplit(cur + 2) + '%') }
})

// ---------- 启动初始化 ----------

async function init() {
  try {
    const launchFile = await getLaunchFile()
    if (launchFile) {
      const text = await readTextFile(launchFile)
      currentFile = launchFile
      fileLabel.textContent = currentFile
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
void restoreBackground()
init()
