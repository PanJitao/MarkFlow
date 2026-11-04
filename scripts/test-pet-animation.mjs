import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

const bundle = await build({ entryPoints: ['src/lib/pet-animation.ts'], bundle: true, write: false, format: 'iife', globalName: 'PetAnimation' })
const tick = () => new Promise(resolve => setTimeout(resolve, 10))
function setup(platform = 'Win32') {
  const dom = new JSDOM('<div id="stage"><img id="poster"></div>', { url: 'http://localhost/pet.html', runScripts: 'outside-only' })
  const w = dom.window, urls = new Map(), revoked = [], delayed = new Map(), failed = new Set(), completed = []
  Object.defineProperty(w.navigator, 'platform', { value: platform })
  Object.defineProperty(w.navigator, 'userAgent', { value: platform === 'Win32' ? 'Chrome/130' : 'AppleWebKit/605.1 Safari/605.1' })
  const reduced = { matches: false, addEventListener(_, callback) { this.callback = callback }, removeEventListener() {} }
  w.matchMedia = () => reduced
  w.fetch = async path => {
    if (delayed.has(path)) await delayed.get(path).promise
    return { ok: true, blob: async () => ({ path }) }
  }
  let serial = 0
  w.URL.createObjectURL = blob => { const url = `blob:test-${++serial}`; urls.set(url, blob.path); return url }
  w.URL.revokeObjectURL = url => revoked.push(url)
  w.HTMLMediaElement.prototype.play = async function () {}
  w.HTMLMediaElement.prototype.pause = function () {}
  for (const [prototype, event] of [[w.HTMLMediaElement.prototype, 'loadeddata'], [w.HTMLImageElement.prototype, 'load']]) {
    Object.defineProperty(prototype, 'src', { configurable: true, set(url) {
      this.setAttribute('src', url)
      const node = this
      queueMicrotask(() => node.dispatchEvent(new w.Event(failed.has(urls.get(url)) ? 'error' : event)))
    }, get() { return this.getAttribute('src') } })
  }
  w.eval(`${bundle.outputFiles[0].text}\nwindow.animationAPI = PetAnimation`)
  const stage = w.document.querySelector('#stage'), poster = w.document.querySelector('#poster')
  const animator = new w.animationAPI.PetAnimator(stage, poster, motion => completed.push(motion))
  const hold = path => { let release; const promise = new Promise(resolve => { release = resolve }); delayed.set(path, { promise }); return release }
  return { w, dom, stage, poster, animator, hold, failed, urls, revoked, completed, reduced }
}

const win = setup()
const lateIdle = win.hold('./pets/dsh-blue/idle.webm')
win.animator.setMotion('idle'); win.animator.setMotion('wave'); await tick()
assert.equal(win.stage.dataset.clip, 'wave')
lateIdle(); await tick()
assert.equal(win.stage.dataset.clip, 'wave', 'late idle load cannot replace a newer user action')
const previous = win.stage.querySelector('video'), staleEnded = previous.onended
const releaseReminder = win.hold('./pets/dsh-blue/remind.webm')
win.animator.setMotion('remind'); await tick()
assert.equal(previous.style.visibility, 'visible', 'previous frame stays visible until the replacement is ready')
releaseReminder(); await tick()
assert.equal(win.stage.dataset.clip, 'remind')
staleEnded(); await tick()
assert.equal(win.stage.dataset.clip, 'remind', 'old ended events cannot advance the current state')
win.stage.querySelector('video').dispatchEvent(new win.w.Event('ended')); await tick()
assert.equal(win.stage.dataset.clip, 'idle', 'pending reminder rests after the attention animation')
win.animator.setMotion('sleep'); await tick()
assert.equal(win.stage.dataset.clip, 'sleepStart')
win.stage.querySelector('video').dispatchEvent(new win.w.Event('ended')); await tick()
assert.equal(win.stage.dataset.clip, 'sleep')
win.animator.setMotion('celebrate'); await tick()
win.stage.querySelector('video').dispatchEvent(new win.w.Event('ended'))
assert.deepEqual(win.completed, ['celebrate'])
win.failed.add('./pets/dsh-blue/drag.webm')
win.animator.setMotion('drag'); await tick(); await tick()
assert.equal(win.stage.dataset.format, 'webp', 'decoder failure uses the alpha image fallback')
win.reduced.matches = true; win.reduced.callback(); await tick()
assert.equal(win.poster.hidden, false, 'reduced motion shows the character poster')
win.animator.dispose(); await tick()
assert.equal(new Set(win.revoked).size, win.urls.size, 'every object URL is released')
win.dom.window.close()

const mac = setup('MacIntel')
mac.animator.setMotion('wave'); await tick()
assert.equal(mac.stage.dataset.format, 'webp', 'Mac WebKit avoids VP9 alpha')
const first = mac.stage.querySelector('.pet-animation-frame').src
mac.animator.setMotion('wave'); await tick()
assert.notEqual(mac.stage.querySelector('.pet-animation-frame').src, first, 'a replay receives a fresh URL and starts from frame one')
const releaseLate = mac.hold('./pets/dsh-blue/cube.webp')
mac.animator.setMotion('play'); mac.animator.dispose(); releaseLate(); await tick()
assert.equal(mac.stage.querySelectorAll('.pet-animation-frame').length, 0)
assert.equal(new Set(mac.revoked).size, mac.urls.size)
mac.dom.window.close()

const custom = setup()
const customPet = {version:1,id:'sprite-test',name:'Sprite',canvas:{width:64,height:64},hitBox:{x:0,y:0,width:1,height:1},poster:'poster.png',clips:{idle:{file:'sheet.png',durationMs:100,sprite:{columns:2,rows:1,frames:2,fps:20}}},actions:{idle:['idle'],dance:['idle']}}
const customSettings = {scale:1,opacity:1,speed:1,flip:false,bubbleColor:'#fcfdff',idleChat:false,greeting:''}
await custom.animator.configure(customPet,customSettings,async path=>({path})); await tick()
assert.equal(custom.stage.dataset.format,'sprite')
const spriteImage=custom.stage.querySelector('.pet-sprite img')
await new Promise(resolve=>setTimeout(resolve,60))
assert.match(spriteImage.style.transform,/-50%/, 'sprite advances to the next cell')
custom.animator.setMotion('dance'); await new Promise(resolve=>setTimeout(resolve,130))
assert.deepEqual(custom.completed,['dance'], 'custom actions complete through the same state machine')
custom.animator.setMotion('wave'); await tick()
assert.equal(custom.stage.dataset.clip,'idle','missing standard actions fall back to idle')
custom.animator.dispose(); await tick()
assert.equal(new Set(custom.revoked).size,custom.urls.size,'custom posters and sprites release every URL')
custom.dom.window.close()

const animatedImage = setup()
await animatedImage.animator.configure({ ...customPet, id:'gif-test', clips:{idle:{file:'character.gif',durationMs:100}} },customSettings,async path=>({path}))
await tick()
const loopingImage = animatedImage.stage.querySelector('.pet-animation-frame')
await new Promise(resolve=>setTimeout(resolve,250))
assert.equal(animatedImage.stage.querySelector('.pet-animation-frame'),loopingImage,'idle GIF/WebP must not restart before their own animation completes')
animatedImage.animator.setMotion('dance'); await tick()
assert.notEqual(animatedImage.stage.querySelector('.pet-animation-frame'),loopingImage,'explicit actions can still replay animated images')
animatedImage.animator.dispose(); animatedImage.dom.window.close()

const manifest = JSON.parse(await readFile('public/pets/dsh-blue/manifest.json', 'utf8'))
assert.equal(Object.keys(manifest.clips).length, 15)
for (const [id, clip] of Object.entries(manifest.clips)) {
  assert.ok(clip.durationMs > 0 && clip.width === 640 && clip.height === 360)
  for (const extension of ['webm', 'webp']) assert.ok((await stat(`public/pets/dsh-blue/${id}.${extension}`)).size > 10000)
}
assert.match(await readFile('public/pets/dsh-blue/LICENSE.txt', 'utf8'), /Copyright \(c\) 2026 PC2005-cloud/)
console.log('Pet animation: seamless handoff, stale loads/events, sleep, fallback, reduced motion, replay, cleanup and 15 bundled assets passed.')
