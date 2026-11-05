// Real background handlers and IndexedDB records; only native I/O and decoding are simulated.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { JSDOM, VirtualConsole } from 'jsdom'
import { IDBFactory, IDBDatabase } from 'fake-indexeddb'

const source = await readFile('src/main.ts', 'utf8')
const ioSource = await readFile('src/lib/io.ts', 'utf8')
const ioNames = [...new Set([...ioSource.matchAll(/export (?:async )?function (\w+)/g)].map(match => match[1]))]
const bundle = await build({
  stdin: { contents: source + '\nwindow.backgroundTest = { applyWallpaper, restoreBackground };', resolveDir: process.cwd() + '/src', loader: 'ts' },
  bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' }, logLevel: 'silent',
  plugins: [{ name: 'test-native', setup(builder) {
    builder.onResolve({ filter: /^(\.\/lib\/|\.\/)(io|mermaid)$/ }, args => ({ path: args.path, namespace: 'test' }))
    builder.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: args.path.endsWith('/io')
      ? ioNames.map(name => `export async function ${name}(...args) { return window.testIO('${name}', args) }`).join('\n')
      : 'export async function renderMermaidContainers() {} export async function rerenderMermaidContainers() {}' }))
  } }],
})
const storageBundle = await build({ entryPoints: ['src/lib/appearance.ts'], bundle: true, write: false, format: 'iife', globalName: 'assetStorage' })
const html = await readFile('index.html', 'utf8')
const database = new IDBFactory()
const doms = []
const tick = () => new Promise(resolve => setTimeout(resolve, 15))
const image = name => ({ blob: new Blob(['image'], { type: 'image/png' }), name, type: 'image/png' })
const video = { path: '/library/video.mp4', projectPath: '/library/project.json', name: '视频壁纸', type: 'video/wallpaper' }
const scene = { path: '/scene/project.json', projectPath: '/scene/project.json', name: '场景壁纸', type: 'scene/wallpaper' }

async function start(savedAppearance) {
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() })
  doms.push(dom)
  const w = dom.window
  if (savedAppearance) w.localStorage.setItem('exchangemd:appearance', savedAppearance)
  w.indexedDB = database; w.Blob = Blob; w.structuredClone = structuredClone
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder
  w.matchMedia = () => ({ matches: false, addEventListener() {} })
  w.ResizeObserver = class { observe() {} disconnect() {} }
  w.IntersectionObserver = class { observe() {} disconnect() {} }
  w.HTMLElement.prototype.scrollIntoView = function () {}
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  w.HTMLDialogElement.prototype.close = function () { this.open = false }
  w.HTMLMediaElement.prototype.play = async function () { this.dataset.playback = 'playing' }
  w.HTMLMediaElement.prototype.pause = function () { this.dataset.playback = 'paused' }
  w.HTMLMediaElement.prototype.load = function () {}
  const revoked = []; let serial = 0
  w.URL.createObjectURL = () => `blob:upload-${++serial}`
  w.URL.revokeObjectURL = url => revoked.push(url)
  for (const [prototype, event] of [[w.HTMLImageElement.prototype, 'load'], [w.HTMLMediaElement.prototype, 'loadeddata']]) {
    Object.defineProperty(prototype, 'src', {
      get() { return this.getAttribute('src') || '' },
      set(value) {
        this.setAttribute('src', value)
        if (value.includes('slow')) return
        setTimeout(() => this.dispatchEvent(new w.Event(value.includes('broken') ? 'error' : event)), 1)
      },
    })
  }
  const closed = []; let token = 0
  w.testIO = async (name, args) => {
    if (name === 'wallpaperMediaUrl') return `http://assets.localhost${args[0]}`
    if (name === 'openWallpaperPlayer') return { token: String(++token), url: `http://wallpaper.localhost/${token}/${args[0].includes('slow') ? 'slow' : 'player'}.html` }
    if (name === 'closeWallpaperPlayer') closed.push(args[0])
    if (name === 'directoryExists' || name === 'pathExists') return true
    if (name === 'readDirectory') return []
    return null
  }
  new w.MutationObserver(records => {
    for (const record of records) for (const frame of record.addedNodes) {
      if (frame.tagName !== 'IFRAME' || frame.src.includes('slow')) continue
      setTimeout(() => w.dispatchEvent(new w.MessageEvent('message', { source: frame.contentWindow,
        data: { channel: 'markflow-wallpaper', type: 'ready' } })), 1)
    }
  }).observe(w.document.querySelector('#custom-background'), { childList: true })
  w.eval(storageBundle.outputFiles[0].text + '\nwindow.assetStorage = assetStorage;')
  w.eval(bundle.outputFiles[0].text)
  await tick()
  return { w, $: selector => w.document.querySelector(selector), api: w.backgroundTest, store: w.assetStorage, revoked, closed }
}

try {
  const app = await start()
  const { api, store, $, revoked, closed, w } = app
  await api.applyWallpaper(image('本地上传.png'))
  const uploadedUrl = $('#background-image').src
  assert.ok((await store.loadBackgroundAsset()).blob instanceof Blob)
  await api.applyWallpaper(video)
  assert.equal((await store.loadBackgroundAsset()).path, video.path)
  let focused = true, hidden = false
  w.document.hasFocus = () => focused
  Object.defineProperty(w.document, 'hidden', { get: () => hidden })
  const selectPolicy = (id, value) => { $(id).value = value; $(id).dispatchEvent(new w.Event('change')) }
  focused = false; w.dispatchEvent(new w.Event('blur'))
  assert.equal($('#background-video').dataset.playback, 'paused', 'legacy setting pauses on blur')
  selectPolicy('#wallpaper-pause-on-blur', 'continue')
  assert.equal($('#background-video').dataset.playback, 'playing', 'continue-on-blur applies immediately')
  hidden = true; w.document.dispatchEvent(new w.Event('visibilitychange'))
  assert.equal($('#background-video').dataset.playback, 'paused', 'minimized windows pause by default')
  selectPolicy('#wallpaper-pause-when-hidden', 'continue')
  selectPolicy('#wallpaper-pause-on-blur', 'pause')
  assert.equal($('#background-video').dataset.playback, 'playing', 'hidden playback uses its own policy')
  $('#wallpaper-play-btn').click()
  assert.equal($('#background-video').dataset.playback, 'paused', 'manual pause overrides all automatic policies')
  $('#wallpaper-play-btn').click()
  assert.equal($('#background-video').dataset.playback, 'playing')
  const settings = w.localStorage.getItem('exchangemd:appearance')
  const restoredPolicy = await start(settings)
  assert.equal(restoredPolicy.$('#wallpaper-pause-on-blur').value, 'pause')
  assert.equal(restoredPolicy.$('#wallpaper-pause-when-hidden').value, 'continue', 'playback preferences survive reopening')
  restoredPolicy.w.close()
  hidden = false; focused = true; w.dispatchEvent(new w.Event('focus'))
  assert.equal((await store.loadBackgroundAsset()).blob, undefined, 'WE selection removes the uploaded Blob from storage')
  assert.ok(revoked.includes(uploadedUrl), `old upload object URL is released: ${uploadedUrl} / ${revoked.join(', ')}`)
  assert.equal($('#background-image').getAttribute('src'), null)
  assert.equal($('#background-file-input').value, '')
  await api.applyWallpaper(scene)
  assert.equal($('#background-video').getAttribute('src'), null)
  assert.equal(w.document.querySelectorAll('.wallpaper-live-frame').length, 1)
  const playerMessages = []
  $('.wallpaper-live-frame').contentWindow.postMessage = data => playerMessages.push(data)
  focused = false; w.dispatchEvent(new w.Event('blur'))
  assert.equal(playerMessages.at(-1).value, true, 'scene renderer receives blur pause')
  selectPolicy('#wallpaper-pause-on-blur', 'continue')
  assert.equal(playerMessages.at(-1).value, false, 'scene renderer receives background playback')
  hidden = true; w.document.dispatchEvent(new w.Event('visibilitychange'))
  assert.equal(playerMessages.at(-1).value, false, 'scene and video share the same hidden policy')
  hidden = false; focused = true; w.dispatchEvent(new w.Event('focus'))
  await api.applyWallpaper(image('新的上传.png'))
  assert.equal(w.document.querySelectorAll('.wallpaper-live-frame').length, 0)
  assert.equal(closed.length, 1, 'local upload destroys the old scene player')
  assert.equal((await store.loadBackgroundAsset()).projectPath, undefined)

  const previousUrl = $('#background-image').src
  await assert.rejects(api.applyWallpaper({ path: '/broken.png', name: '损坏图片', type: 'image/png' }))
  assert.equal($('#background-image').src, previousUrl, 'incompatible media must not replace the current wallpaper')
  assert.equal((await store.loadBackgroundAsset()).name, '新的上传.png')

  const transaction = IDBDatabase.prototype.transaction
  IDBDatabase.prototype.transaction = function (stores, mode, ...args) {
    if (mode === 'readwrite') throw new Error('模拟保存失败')
    return transaction.call(this, stores, mode, ...args)
  }
  try { await assert.rejects(api.applyWallpaper(video)) } finally { IDBDatabase.prototype.transaction = transaction }
  assert.equal($('#background-image').src, previousUrl, 'failed persistence keeps display and stored background consistent')
  assert.equal((await store.loadBackgroundAsset()).name, '新的上传.png')

  const slow = api.applyWallpaper({ ...scene, path: '/slow/project.json' }).then(() => 'applied', () => 'cancelled')
  await tick()
  await api.applyWallpaper(video)
  assert.equal(await slow, 'cancelled', 'latest selection cancels a previous scene still loading')
  assert.equal(w.document.querySelectorAll('.wallpaper-live-frame').length, 0)
  assert.equal((await store.loadBackgroundAsset()).path, video.path)

  const restarted = await start()
  // IndexedDB restoration is asynchronous and may exceed one timer tick during builds.
  for (let attempt = 0; attempt < 100 && !restarted.$('#background-video').src.endsWith(video.path); attempt++) await tick()
  assert.ok(restarted.$('#background-video').src.endsWith(video.path), 'restart restores only the last successful choice')
  const clearing = api.applyWallpaper({ ...scene, path: '/slow/clear/project.json' }).catch(() => {})
  await tick()
  $('#clear-background-btn').click()
  await clearing; await tick()
  assert.equal(await store.loadBackgroundAsset(), null)
  assert.equal(w.document.querySelectorAll('.wallpaper-live-frame').length, 0)
  assert.equal($('#background-file-name').textContent, '未选择')
  assert.equal((await start()).$('#background-image').getAttribute('src'), null)
  console.log('✓ Background replacement: upload ↔ WE, blob/player cleanup, incompatible media, storage failure, overlapping selection, clear and restart')
} finally { for (const dom of doms) dom.window.close() }
