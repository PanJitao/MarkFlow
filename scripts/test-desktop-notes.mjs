import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

const clone = value => JSON.parse(JSON.stringify(value))
const tick = () => new Promise(resolve => setTimeout(resolve, 10))
const empty = () => ({ revision: 0, enabled: true, notes: [], todos: [], alerts: [] })
async function setup(entry, initial = empty(), draft) {
  const bundle = await build({ entryPoints: [`src/${entry}.ts`], bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' }, plugins: [{
    name: 'native-test', setup(builder) {
      builder.onResolve({ filter: /^\.\/lib\/pet-animation$/ }, () => ({ path: 'pet-animation', namespace: 'animation-mock' }))
      builder.onLoad({ filter: /.*/, namespace: 'animation-mock' }, () => ({ contents: 'export class PetAnimator { setMotion(motion) {window.lastMotion = motion} async configure() {} dispose() {} }', loader: 'js' }))
      builder.onResolve({ filter: /^@tauri-apps\/api\// }, args => ({ path: args.path, namespace: 'mock' }))
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `
        export const invoke = (...args) => window.testInvoke(...args);
        export const listen = async (name, fn) => { if (name==='desktop-data') window.testReceive = fn; if(name==='pet-command') window.testPetCommand=fn; return () => {} };
        export const cursorPosition = async () => ({x:0,y:0});
        export class PhysicalPosition { constructor(x,y) { this.x=x; this.y=y } }
        export const getCurrentWindow = () => ({
          onCloseRequested: async fn => {window.testClose = fn}, onMoved: async () => {},
          close: async () => window.testClose({preventDefault(){}}), destroy: async () => {window.destroyed = true},
          setPosition: async pos => {window.lastPosition = pos}, outerPosition: async () => ({x:0,y:0}),
          scaleFactor: async () => 1, setIgnoreCursorEvents: async () => {}
        });`, loader: 'js' }))
    }
  }] })
  const dom = new JSDOM(await readFile(`${entry}.html`, 'utf8'), { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window, calls = []
  let state = clone(initial), hold = null
  w.testInvoke = async (command, args) => {
    calls.push({ command, args: clone(args ?? {}) })
    if (command === 'pet_request') return {revision:0,pet:JSON.parse(await readFile('public/pets/dsh-blue/pet.json','utf8')),settings:{scale:1,opacity:1,speed:1,flip:false,bubbleColor:'#fcfdff',idleChat:true,greeting:''},command:null}
    if (command === 'pet_resize') return
    if (command === 'desktop_save_note') {
      if (hold) await hold
      Object.assign(state.notes.find(n => n.id === args.noteId), { text: args.text, color: args.color })
    }
    if (command === 'desktop_save_todo') state.todos.push({ ...args.input, id: 'saved', done: false, snoozeUntil: null })
    if (command === 'desktop_resolve_alert') state.alerts = state.alerts.filter(a => a.id !== args.id)
    if (command !== 'desktop_get') state.revision++
    return clone(state)
  }
  if (draft) w.localStorage.setItem('markflow:todoDraft', JSON.stringify(draft))
  w.eval(bundle.outputFiles[0].text); await tick()
  const $ = selector => w.document.querySelector(selector)
  const input = (selector, value) => { const el = $(selector); el.value = value; el.dispatchEvent(new w.Event('input', { bubbles: true })) }
  return { dom, w, $, input, calls, data: () => state, hold: promise => { hold = promise }, receive: data => w.testReceive({ payload: data }) }
}

const draft = { id: null, title: '未提交的提醒', due: '2026-11-10T15:30', offsets: [15, 30], custom: true, minutes: '7' }
const notes = await setup('notes', { ...empty(), notes: [{ id: 'note-1', text: '原文', color: 'cream' }] }, draft)
assert.equal(notes.$('#todo-title').value, draft.title)
assert.deepEqual(JSON.parse(notes.w.localStorage.getItem('markflow:todoDraft')), draft, 'restoring does not overwrite the saved draft')
notes.$('#todo-form').dispatchEvent(new notes.w.Event('submit', { bubbles: true, cancelable: true })); await tick()
const submitted = notes.calls.find(call => call.command === 'desktop_save_todo').args.input
assert.deepEqual(submitted.remindBefore, [7, 15, 30], 'multiple lead times include custom offset')
assert.equal(new Date(submitted.dueAt).getHours(), 15, 'datetime-local retains local time')
assert.equal(notes.w.localStorage.getItem('markflow:todoDraft'), null)

notes.$('[data-tab=notes]').click()
let release
notes.hold(new Promise(resolve => { release = resolve }))
notes.input('textarea', '第一段')
await new Promise(resolve => setTimeout(resolve, 450))
notes.input('textarea', '第一段\n刚输入的第二段')
const closing = notes.w.testClose({ preventDefault() {} })
assert.equal(notes.w.destroyed, undefined, 'window stays alive while saving')
release(); await closing
assert.equal(notes.data().notes[0].text, '第一段\n刚输入的第二段', 'close flushes edits made during an in-flight save')
assert.equal(notes.w.destroyed, true)
notes.dom.window.close()

const quickClose = await setup('notes', { ...empty(), notes: [{ id: 'note-2', text: '', color: 'cream' }] })
quickClose.hold(new Promise(resolve => { release = resolve }))
quickClose.input('textarea', '开始关闭')
const finishing = quickClose.w.testClose({ preventDefault() {} })
quickClose.input('textarea', '关闭保存期间的最后输入')
release(); await finishing
assert.equal(quickClose.data().notes[0].text, '关闭保存期间的最后输入', 'close drains edits added during its first save')
quickClose.dom.window.close()

const alerts = [1, 2].map(n => ({ id: `alert-${n}`, todoId: `todo-${n}`, title: `<提醒 ${n}>`, dueAt: Date.now() + 900000, triggerAt: Date.now() }))
const pet = await setup('pet', { ...empty(), revision: 3, alerts })
assert.equal(pet.$('#speech-text').textContent, '<提醒 1>')
assert.equal(pet.$('#speech-text').children.length, 0, 'titles render as text')
pet.$('#alert-next').click(); assert.equal(pet.$('#speech-text').textContent, '<提醒 2>')
pet.$('#alert-snooze').click(); await tick()
assert.deepEqual(pet.calls.find(call => call.command === 'desktop_resolve_alert').args, { id: 'alert-2', action: 'snooze' })
assert.equal(pet.$('#speech-text').textContent, '<提醒 1>')
pet.receive({ ...empty(), revision: 1 }); assert.equal(pet.$('#speech').hidden, false, 'late snapshots cannot erase pending reminders')
pet.$('#alert-done').click(); await tick()
assert.equal(pet.$('#pet').dataset.action, 'celebrate')
assert.equal(pet.$('#speech-actions').hidden, true)
pet.$('[data-pet-action=sleep]').click(); await tick()
assert.equal(pet.$('#pet').dataset.action, 'sleep')
pet.receive({ ...empty(), revision: 20, alerts: [alerts[0]] })
assert.equal(pet.$('#pet').dataset.action, 'remind', 'due reminders wake the sleeping pet')
assert.equal(pet.$('[data-pet-action=sleep]').textContent, '打个盹')
pet.receive({ ...empty(), revision: 21 })
pet.$('#pet-open').click(); await tick()
assert.equal(pet.w.lastMotion, 'react', 'single click plays a character reaction')
assert.equal(pet.calls.some(call => call.command === 'desktop_action'), false)
pet.$('#pet-open').dispatchEvent(new pet.w.MouseEvent('dblclick', { bubbles: true })); await tick()
assert.equal(pet.calls.at(-1).args.action, 'notes', 'double click opens notes')
pet.$('#pet-open').setPointerCapture = () => {}
pet.$('#pet-open').dispatchEvent(new pet.w.MouseEvent('pointerdown', { bubbles: true, button: 0, screenX: 300, screenY: 300 }))
pet.w.document.dispatchEvent(new pet.w.MouseEvent('pointermove', { bubbles: true, screenX: 160, screenY: 180 }))
pet.w.document.dispatchEvent(new pet.w.MouseEvent('pointerup', { bubbles: true }))
await tick()
assert.deepEqual({ ...pet.w.lastPosition }, { x: -140, y: -120 }, 'a fast drag ending outside the robot still moves the window')
pet.receive({ ...empty(), revision: 30, alerts: [alerts[0]] })
pet.w.testPetCommand({ payload: { id:'ai-command',text:'AI 的问候',action:'wave',expiresAt:Date.now()+30000 } })
assert.equal(pet.$('#speech-text').textContent, '<提醒 1>', 'AI cannot replace a pending todo reminder')
pet.receive({ ...empty(), revision:31 }); await new Promise(resolve=>setTimeout(resolve,150))
assert.equal(pet.$('#speech-text').textContent, 'AI 的问候', 'queued AI speech runs after reminders are cleared')
pet.w.testPetCommand({payload:{id:'expired',text:'已过期',expiresAt:Date.now()-1}})
assert.equal(pet.$('#speech-text').textContent, 'AI 的问候')
pet.dom.window.close()
console.log('Desktop notes: draft recovery, custom reminders, save-on-close race, bubble queue and stale-event checks passed.')
