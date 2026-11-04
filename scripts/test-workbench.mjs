// Exercise real application handlers with isolated DOM/storage and in-memory file I/O.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { JSDOM, VirtualConsole } from 'jsdom'

const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
const ioImports = source.match(/import \{([^}]+)\} from '\.\/lib\/io'/)[1]
  .split(',').map((name) => name.trim().split(' as ')[0]).filter((name) => name && !name.startsWith('type '))
const bundled = await build({
  entryPoints: ['src/main.ts'], bundle: true, write: false, format: 'iife',
  loader: { '.css': 'empty' }, logLevel: 'silent',
  plugins: [{ name: 'test-io', setup(builder) {
    builder.onResolve({ filter: /^\.\/lib\/(io|mermaid)$/ }, (args) => ({ path: args.path, namespace: 'test' }))
    builder.onLoad({ filter: /.*/, namespace: 'test' }, (args) => ({ contents: args.path.endsWith('/io')
      ? ioImports.map((name) => `export async function ${name}(...args) { return window.testIO('${name}', args) }`).join('\n')
      : 'export async function renderMermaidContainers() {} export async function rerenderMermaidContainers() {}', loader: 'js' }))
  } }],
})
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
const platformBundle = await build({ entryPoints: ['src/lib/platform.ts'], bundle: true, write: false, format: 'iife', globalName: 'platformAPI' })
let assertions = 0
function check(value, message) { assert.ok(value, message); assertions++; }

for (const platform of ['Win32', 'MacIntel']) {
  const errors = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', (error) => errors.push(error.message))
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole })
  const w = dom.window
  Object.defineProperty(w.navigator, 'platform', { value: platform })
  w.eval(`${platformBundle.outputFiles[0].text}\nwindow.platformAPI = platformAPI`)
  check(w.platformAPI.normalizeComparablePath('/Docs/A.md') === (platform === 'Win32' ? '/docs/a.md' : '/Docs/A.md'), `${platform}: filesystem case handling`)
  check(w.platformAPI.shortcutLabel('Shift+P') === (platform === 'Win32' ? 'Ctrl+Shift+P' : '⌘⇧P'), `${platform}: shortcut labels`)
  w.matchMedia = () => ({ matches: false, addEventListener() {} })
  w.ResizeObserver = class { observe() {} disconnect() {} }
  w.IntersectionObserver = class { observe() {} disconnect() {} }
  w.HTMLElement.prototype.scrollIntoView = function () {}
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new w.Event('close')) }
  w.TextEncoder = TextEncoder
  w.TextDecoder = TextDecoder
  const writes = []
  let launch = null
  w.testIO = async (name, args) => {
    if (name === 'getLaunchFile') return launch
    if (name === 'pickOpenFile') return { filePath: '/docs/second.md', text: 'second document' }
    if (name === 'pickSavePath') return '/docs/saved.md'
    if (name === 'writeTextFile' || name === 'writeExistingTextFile') writes.push(args)
    if (name === 'directoryExists' || name === 'pathExists') return true
    if (name === 'readDirectory') return []
    return null
  }
  w.eval(bundled.outputFiles[0].text)
  await new Promise((resolve) => setTimeout(resolve, 30))
  const $ = (selector) => w.document.querySelector(selector)
  const editor = $('#editor')
  const modifier = platform === 'MacIntel' ? { metaKey: true } : { ctrlKey: true }
  function key(target, key, extra = {}) {
    return target.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifier, ...extra }))
  }
  function input(target, value) {
    target.dispatchEvent(new w.InputEvent('beforeinput', { inputType: 'insertText', bubbles: true, cancelable: true }))
    target.value = value
    target.dispatchEvent(new w.Event('input', { bubbles: true }))
  }
  input(editor, 'alpha beta ALPHA\n中文输入')
  key(editor, 'z')
  check(!editor.value.startsWith('alpha'), `${platform}: undo restores original`)
  key(editor, 'z', { shiftKey: true })
  check(editor.value === 'alpha beta ALPHA\n中文输入', `${platform}: redo restores edited value`)
  key(editor, 'z')
  input(editor, 'new branch')
  key(editor, 'z', { shiftKey: true })
  check(editor.value === 'new branch', `${platform}: new edit clears redo`)

  input(editor, '- 中文')
  editor.setSelectionRange(editor.value.length, editor.value.length)
  key(editor, 'Enter', { ctrlKey: false, metaKey: false, isComposing: true })
  check(editor.value === '- 中文', `${platform}: IME Enter does not continue list`)
  key(editor, 'Enter', { ctrlKey: false, metaKey: false })
  check(editor.value === '- 中文\n- ', `${platform}: normal Enter continues list`)
  const beforeComposition = editor.value
  editor.dispatchEvent(new w.CompositionEvent('compositionstart'))
  input(editor, `${beforeComposition}zhong`)
  input(editor, `${beforeComposition}中文`)
  editor.dispatchEvent(new w.CompositionEvent('compositionend'))
  key(editor, 'z')
  check(editor.value === beforeComposition, `${platform}: IME composition is one undo step`)

  input(editor, 'alpha beta ALPHA\n中文输入')
  editor.setSelectionRange(0, 0)
  key(editor, 'f')
  input($('#find-input'), 'alpha')
  check($('#find-count').textContent === '1 / 2', `${platform}: case-insensitive find`)
  $('#find-next').click()
  check(editor.selectionStart === 11 && editor.selectionEnd === 16, `${platform}: next match selects exact offsets`)
  $('#find-case').click()
  check($('#find-count').textContent === '1 / 1', `${platform}: match case`)
  $('#find-case').click()
  $('#find-toggle-replace').click()
  $('#replace-input').value = '$&中文'
  $('#replace-all').click()
  check(editor.value === '$&中文 beta $&中文\n中文输入', `${platform}: replace-all treats replacement literally`)
  $('#find-close').click()
  key(editor, 'z')
  check(editor.value === 'alpha beta ALPHA\n中文输入', `${platform}: replace-all is one undo step`)
  key(editor, 'z', { shiftKey: true })
  check(editor.value === '$&中文 beta $&中文\n中文输入', `${platform}: replacement redo`)
  editor.dispatchEvent(new w.InputEvent('beforeinput', { inputType: 'historyUndo', cancelable: true }))
  check(editor.value === 'alpha beta ALPHA\n中文输入', `${platform}: native Edit menu undo`)
  editor.dispatchEvent(new w.InputEvent('beforeinput', { inputType: 'historyRedo', cancelable: true }))
  check(editor.value === '$&中文 beta $&中文\n中文输入', `${platform}: native Edit menu redo`)
  editor.setSelectionRange(0, 0)
  key(editor, 'f')
  input($('#find-input'), '$&')
  check($('#find-count').textContent === '1 / 2', `${platform}: search escapes regex characters`)
  input($('#find-input'), '')
  check($('#find-count').textContent === '', `${platform}: empty query has no matches`)
  $('#find-close').click()

  key(editor, 'p', { shiftKey: true })
  check($('#command-palette').open, `${platform}: command palette shortcut`)
  input($('#command-input'), '资源管理器')
  check($('#command-list').children.length === 1, `${platform}: command filtering`)
  key($('#command-input'), 'Enter', { ctrlKey: false, metaKey: false })
  check($('#workspace').classList.contains('file-tree-hidden'), `${platform}: execute command`)
  key(editor, ',')
  check($('#appearance-dialog').open, `${platform}: settings shortcut`)
  const before = editor.value
  key($('#background-color-input'), 'z')
  check(editor.value === before, `${platform}: settings undo never edits document`)
  $('#appearance-dialog').close()
  if (platform === 'MacIntel') {
    key(editor, 'b', { metaKey: false, ctrlKey: true })
    check($('#workspace').classList.contains('file-tree-hidden'), 'Mac: Control is not Command')
  }
  key(editor, 's', { shiftKey: true })
  await new Promise((resolve) => setTimeout(resolve, 20))
  check(writes.length === 1 && writes[0][1] === editor.value, `${platform}: save-as writes current text`)
  key(editor, 'z')
  key(editor, 'o')
  await new Promise((resolve) => setTimeout(resolve, 30))
  check(editor.value === 'second document', `${platform}: open file`)
  key(editor, 'z', { shiftKey: true })
  check(editor.value === 'second document', `${platform}: opening file clears redo history`)
  input(editor, '开头 重复 **重复** 结尾')
  editor.setSelectionRange(0, 2)
  editor.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  $('[data-text-format="underline"]').click()
  check(editor.value.startsWith('<u>开头</u>'), `${platform}: source selection style`)
  key(editor, 'z')
  check(editor.value === '开头 重复 **重复** 结尾', `${platform}: style undo is one step`)
  const textNode = $('#preview strong').firstChild
  const range = w.document.createRange()
  range.setStart(textNode, 0); range.setEnd(textNode, 2)
  w.getSelection().removeAllRanges(); w.getSelection().addRange(range)
  $('#preview').dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  check($('#editor-context-menu').dataset.origin === 'preview', `${platform}: preview menu opens`)
  $('[data-text-format="custom"]').click()
  $('#selection-color').value = '#d92222'
  $('[data-apply-style="color"]').click()
  check(editor.value === '开头 重复 **<span style="color: #d92222">重复</span>** 结尾', `${platform}: exact repeated preview text changed, Markdown preserved`)
  check($('#preview strong span').style.color === 'rgb(217, 34, 34)', `${platform}: preview color visible`)
  key(editor, 'z')
  check(editor.value === '开头 重复 **重复** 结尾', `${platform}: preview style undo`)
  const fontSize = $('[data-typography="previewFontSize"]')
  fontSize.value = '22'; fontSize.dispatchEvent(new w.Event('change'))
  check(w.document.documentElement.style.getPropertyValue('--preview-font-size') === '22px', `${platform}: typography applied`)
  check(JSON.parse(w.localStorage.getItem('exchangemd:appearance')).previewFontSize === 22, `${platform}: typography saved`)
  input(editor, '# 未保存导出\n\n<span style="color: #d92222">中文颜色</span>')
  const snapshot = editor.value
  $('[data-file="export-html"]').click()
  await new Promise((resolve) => setTimeout(resolve, 60))
  check(writes.at(-1)[1].includes('中文颜色') && writes.at(-1)[1].includes('22px'), `${platform}: HTML exports current unsaved text with typography`)
  check(editor.value === snapshot, `${platform}: export preserves document`)
  let printed = ''
  w.print = () => { printed = $('#preview').textContent }
  input(editor, '# 最新打印内容')
  $('[data-file="export-pdf"]').click()
  await new Promise((resolve) => setTimeout(resolve, 60))
  check(printed.includes('最新打印内容'), `${platform}: PDF prints latest preview`)
  check(errors.length === 0, `${platform}: no application exceptions: ${errors.join('; ')}`)
  dom.window.close()
  console.log(`✓ ${platform} editing, search, commands, IME, history, save/open`)
}
console.log(`${assertions} assertions passed`)
