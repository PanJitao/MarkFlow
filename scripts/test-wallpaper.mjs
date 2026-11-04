import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

const bundle = await build({ entryPoints: ['src/lib/wallpaper.ts'], bundle: true, write: false, format: 'iife', globalName: 'wallpaper',
  plugins: [{ name: 'wallpaper-io', setup(builder) {
    builder.onResolve({ filter: /^\.\/io$/ }, () => ({ path: 'io', namespace: 'mock' }))
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `
      export async function pickOpenFolder() { return '/manual-library' }
      export async function scanWallpapers(root) { return window.scan(root) }
      export function wallpaperPreviewUrl(path) { return path }
      export async function getWallpaperProject(path) { return window.project(path) }
    ` }))
  } }],
})
const dom = new JSDOM(await readFile('index.html', 'utf8'), { url: 'http://localhost/', runScripts: 'outside-only' })
const w = dom.window
w.HTMLDialogElement.prototype.showModal = function () { this.open = true }
w.HTMLDialogElement.prototype.close = function () { this.open = false }
const roots = []
const applied = []
w.scan = async (root) => {
  roots.push(root)
  return { roots: ['/Steam/431960'], unsupported: 3, invalid: 1, truncated: false, items: [
    { name: '海边视频', path: '/sea.mp4', kind: 'video', preview: null },
    { name: '山间图片', path: '/mountain.jpg', kind: 'image', preview: '/preview.jpg' },
  ] }
}
w.project = async () => ({ general: { properties: {
  enabled: { type: 'bool', text: '显示粒子', value: true, order: 1 },
  speed: { type: 'slider', text: '<b>速度</b>', value: 2, min: 0, max: 10, step: 0.5, order: 2, condition: 'enabled.value' },
  color: { type: 'color', text: '颜色', value: '1 0 0', order: 3 },
  mode: { type: 'combo', text: '模式', value: 0, options: [{ label: 'A', value: 0 }, { label: 'B', value: 1 }], order: 4 },
  text: { type: 'textinput', text: '文字', value: '原文', order: 5 },
} } })
w.eval(bundle.outputFiles[0].text + '\nwindow.wallpaper = wallpaper')
let failApply = false
let active = null
let pendingApply = null
const updates = []
w.wallpaper.setupWallpaperLibrary(async (asset) => {
  if (failApply) throw new Error('文件已移动')
  if (pendingApply) await pendingApply
  applied.push(asset)
  active = asset
}, (path, values) => updates.push({ path, values }), () => active)
const $ = (s) => w.document.querySelector(s)
const settle = () => new Promise((r) => setTimeout(r, 10))
$('#wallpaper-library-btn').click(); await settle()
assert.equal(roots[0], null)
assert.equal(w.document.querySelectorAll('.wallpaper-card').length, 2)
assert.match($('#wallpaper-status').textContent, /暂不支持 3 项/)
$('#wallpaper-filter').value = 'image'; $('#wallpaper-filter').dispatchEvent(new w.Event('change'))
assert.equal(w.document.querySelectorAll('.wallpaper-card').length, 1)
$('.wallpaper-card').click(); await settle()
assert.deepEqual(JSON.parse(JSON.stringify(applied[0])), { path: '/mountain.jpg', name: '山间图片', type: 'image/wallpaper' })
assert.equal($('.wallpaper-card').getAttribute('aria-pressed'), 'true')
failApply = true
$('.wallpaper-card').click(); await settle()
assert.match($('#wallpaper-status').textContent, /应用失败.*文件已移动/)
assert.equal($('.wallpaper-card').disabled, false)
$('#wallpaper-search').value = '不存在'; $('#wallpaper-search').dispatchEvent(new w.Event('input'))
assert.match($('.wallpaper-empty').textContent, /没有匹配/)
$('[data-wallpaper-scan="choose"]').click(); await settle()
assert.equal(roots.at(-1), '/manual-library')
assert.equal(w.localStorage.getItem('markflow:wallpaperRoot'), '/manual-library')
w.scan = async () => { throw new Error('目录不可读取') }
$('[data-wallpaper-scan="refresh"]').click(); await settle()
assert.match($('#wallpaper-status').textContent, /目录不可读取/)
assert.equal($('[data-wallpaper-scan="choose"]').disabled, false)

failApply = false
w.scan = async () => ({ roots: ['/Steam/431960'], unsupported: 1, invalid: 0, truncated: false, items: [
  { name: '粒子场景', path: '/scene/project.json', projectPath: '/scene/project.json', kind: 'scene', available: true },
  { name: '应用程序', path: '/app/project.json', kind: 'application', available: false, reason: '不能运行应用程序' },
] })
$('#wallpaper-search').value = ''; $('#wallpaper-filter').value = ''
$('[data-wallpaper-scan="refresh"]').click(); await settle()
assert.equal(w.document.querySelectorAll('.wallpaper-card').length, 2)
$('.wallpaper-card').click(); await settle()
assert.equal($('#wallpaper-property-title').textContent, '粒子场景')
const prop = key => $(`[data-property-key="${key}"]`)
assert.equal(prop('speed').querySelector('label').textContent, '速度')
prop('enabled').querySelector('input').click()
assert.equal(prop('speed').hidden, true)
prop('enabled').querySelector('input').click()
const range = prop('speed').querySelector('input[type="range"]')
range.value = '4.5'; range.dispatchEvent(new w.Event('input'))
assert.equal(updates.at(-1).values.speed, 4.5)
const select = prop('mode').querySelector('select')
select.value = '1'; select.dispatchEvent(new w.Event('change'))
assert.equal(updates.at(-1).values.mode, 1)
const hex = prop('color').querySelector('input[type="text"]')
hex.value = '#00ff00'; hex.dispatchEvent(new w.Event('change'))
assert.equal(updates.at(-1).values.color, '0.000000 1.000000 0.000000')
assert.equal(prop('color').querySelector('input[type="color"]').value, '#00ff00')
hex.value = '#wrong'; hex.dispatchEvent(new w.Event('change'))
assert.equal(hex.value, '#00ff00')
assert.equal(JSON.parse(w.localStorage.getItem('markflow:wallpaperProperties'))['/scene/project.json'].speed, 4.5)
$('#wallpaper-properties-reset').click()
assert.equal(updates.at(-1).values.speed, 2)
const activeScene = active
active = { name: '本地上传.png', type: 'image/png', blob: new w.Blob(['upload']) }
$('#custom-background').dispatchEvent(new w.Event('background-change'))
assert.equal(w.document.querySelectorAll('.wallpaper-card[aria-pressed="true"]').length, 0)
assert.equal($('#wallpaper-properties-reset').disabled, true)
assert.equal(prop('enabled'), null, 'old wallpaper parameters disappear after local upload')
assert.match($('#wallpaper-status').textContent, /当前背景：本地上传.png/)
$('#wallpaper-close-btn').click(); $('#wallpaper-library-btn').click(); await settle()
assert.equal(w.document.querySelectorAll('.wallpaper-card[aria-pressed="true"]').length, 0)
active = activeScene
$('#wallpaper-close-btn').click(); $('#wallpaper-library-btn').click(); await settle()
assert.equal(prop('enabled').querySelector('input').disabled, false)
failApply = true
$('.wallpaper-card').click(); await settle()
assert.equal(prop('enabled').querySelector('input').disabled, true)
assert.match($('#wallpaper-property-note').textContent, /原背景仍保留/)
failApply = false
let cancelApply
pendingApply = new Promise((resolve, reject) => { cancelApply = reject })
$('.wallpaper-card').click(); await settle()
active = { name: '后选择的本地图片.png', type: 'image/png' }
$('#custom-background').dispatchEvent(new w.Event('background-change'))
cancelApply(new w.DOMException('已被新选择替代', 'AbortError')); await settle()
pendingApply = null
assert.match($('#wallpaper-status').textContent, /当前背景：后选择的本地图片.png/)
assert.equal($('#wallpaper-properties-reset').disabled, true)
assert.equal(prop('enabled'), null)
const count = applied.length
w.document.querySelectorAll('.wallpaper-card')[1].click(); await settle()
assert.equal(applied.length, count)
assert.match($('#wallpaper-status').textContent, /不能运行/)
dom.window.close()
console.log('✓ Wallpaper library: scan, filtering, apply, errors, per-wallpaper controls, conditions, numeric options, persistence, reset and unavailable projects')
