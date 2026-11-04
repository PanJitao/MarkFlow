import './desktop-notes.css'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { PhysicalPosition } from '@tauri-apps/api/dpi'
import { cursorPosition, getCurrentWindow } from '@tauri-apps/api/window'
import { alertLabel, desktopAction, emptyDesktopData, getDesktopData, type DesktopData } from './lib/desktop-notes'
import { PetAnimator, type PetMotion } from './lib/pet-animation'
import { builtInPet, defaultPetSettings, type PetCommand, type PetRuntime } from './lib/pet-types'
import { petRequest, petAsset, stylePet } from './lib/pet-client'

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!
const pet = $('#pet'), speech = $('#speech'), menu = $('#pet-menu')
const caption = $('#speech-caption'), text = $('#speech-text'), time = $('#speech-time'), actions = $('#speech-actions')
const currentWindow = getCurrentWindow()
let state = emptyDesktopData(), alertIndex = 0, lastAlert = '', lastInteraction = Date.now()
let bubbleTimer: ReturnType<typeof setTimeout>
let ignore = false, polling = false, dragging = false, suppressClick = false, sleeping = false
const stage = $('#pet-stage')
let definition = builtInPet, preferences = defaultPetSettings(), runtimeRevision = -1, runtimeGeneration = 0, lastSize = ''
let pendingCommand: PetCommand | null = null
const receivedCommands = new Set<string>()
const animator = new PetAnimator(stage, $<HTMLImageElement>('#pet-poster'), () => { if (!runPendingCommand()) action(baseMotion()) }, showPetError)
function baseMotion(): PetMotion { return state.alerts.length ? 'remind' : sleeping ? 'sleep' : 'idle' }
function setSleeping(value: boolean) { sleeping = value; $('[data-pet-action=sleep]').textContent = value ? '唤醒' : '打个盹' }
function showPetError(message: string) {
  if (state.alerts.length) return
  caption.textContent = '宠物素材'; text.textContent = message; time.textContent = '可在宠物样式中切回内置角色。'; actions.hidden = true; speech.hidden = false
}
async function applyRuntime(runtime: PetRuntime) {
  if (runtime.revision < runtimeRevision) return
  runtimeRevision = runtime.revision; const generation = ++runtimeGeneration
  const next = runtime.pet, settings = runtime.settings
  await animator.configure(next, settings, file => petAsset(next, file))
  if (generation !== runtimeGeneration) return
  definition = next; preferences = settings
  const layout = stylePet(stage, next, settings), hit = next.hitBox
  pet.style.width = `${layout.width}px`
  const target = $('#pet-open')
  target.style.left = `${100 * (settings.flip ? 1 - hit.x - hit.width : hit.x)}%`; target.style.top = `${hit.y * layout.height}px`
  target.style.width = `${hit.width * 100}%`; target.style.height = `${hit.height * layout.height}px`
  speech.style.bottom = `${layout.height + 34}px`
  document.documentElement.style.setProperty('--pet-bubble-color', settings.bubbleColor)
  const rgb = [1, 3, 5].map(offset => parseInt(settings.bubbleColor.slice(offset, offset + 2), 16))
  const darkBubble = rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 < 150
  document.documentElement.style.setProperty('--pet-bubble-text', darkBubble ? '#f5f7fa' : '#283343')
  document.documentElement.style.setProperty('--pet-bubble-muted', darkBubble ? '#d1dae5' : '#66778c')
  $('#pet-credit').textContent = [next.name, next.author, next.license].filter(Boolean).join(' · ')
  for (const name of ['wave', 'stretch', 'play', 'sleep']) $<HTMLButtonElement>(`[data-pet-action=${name}]`).disabled = !next.actions[name]
  const extras = Object.keys(next.actions).filter(key => !['idle', 'react', 'wave', 'drag', 'remind', 'celebrate', 'sleepStart', 'sleep', 'wake', 'stretch', 'play'].includes(key))
  const extraSelect = $<HTMLSelectElement>('#pet-extra-action'); extraSelect.replaceChildren(...extras.map(key => new Option(key, key)))
  $('#pet-extra-controls').hidden = !extras.length
  const size = `${layout.windowWidth}:${layout.windowHeight}`
  if (lastSize !== size) { await invoke('pet_resize', { width: layout.windowWidth, height: layout.windowHeight }); lastSize = size }
  if (runtime.command) acceptCommand(runtime.command)
  if (runtime.warning) showPetError(runtime.warning)
}
function acceptCommand(command: PetCommand) {
  if (receivedCommands.has(command.id) || command.expiresAt <= Date.now()) return
  receivedCommands.add(command.id); if (receivedCommands.size > 100) receivedCommands.delete(receivedCommands.values().next().value!)
  pendingCommand = command; runPendingCommand()
}
function runPendingCommand(): boolean {
  if (!pendingCommand || state.alerts.length || dragging) return false
  const command = pendingCommand; pendingCommand = null
  if (command.expiresAt <= Date.now()) return false
  setSleeping(command.action === 'sleep')
  if (command.text) say(command.text, command.action || 'wave')
  else action(command.action || 'idle')
  return true
}

function action(name: PetMotion) {
  pet.dataset.action = name; animator.setMotion(name)
}
function setMenu(open: boolean) {
  menu.hidden = !open; $('#pet-menu-toggle').setAttribute('aria-expanded', String(open))
  if (open) speech.hidden = true
  else if (state.alerts.length) renderAlert()
}
function say(message: string, name: PetMotion = 'wave', preview = false) {
  if (state.alerts.length) { renderAlert(); return }
  clearTimeout(bubbleTimer); setMenu(false)
  caption.textContent = preview ? '提醒气泡预览' : definition.name
  text.textContent = message; time.textContent = preview ? '待办到时间时，我会这样冒泡提醒你。' : ''
  actions.hidden = true; speech.hidden = false; action(name)
  bubbleTimer = setTimeout(() => { if (!state.alerts.length) { speech.hidden = true; if (preview) action(baseMotion()) } }, 8000)
}
function renderAlert() {
  if (!state.alerts.length) {
    if (lastAlert) { speech.hidden = true; lastAlert = ''; action(baseMotion()) }
    return
  }
  alertIndex %= state.alerts.length
  const alert = state.alerts[alertIndex]
  clearTimeout(bubbleTimer); menu.hidden = true; $('#pet-menu-toggle').setAttribute('aria-expanded', 'false')
  caption.textContent = `待办提醒${state.alerts.length > 1 ? ` · ${alertIndex + 1}/${state.alerts.length}` : ''}`
  text.textContent = alert.title; time.textContent = alertLabel(alert)
  actions.hidden = false; speech.hidden = false; $('#alert-next').hidden = state.alerts.length < 2
  if (lastAlert !== alert.id) { lastAlert = alert.id; action('remind') }
}
function receive(data: DesktopData) {
  if (data.revision < state.revision) return
  state = data; $('#pet-count').textContent = `便签 · ${state.todos.filter(t => !t.done).length} 待办`
  if (state.alerts.length) setSleeping(false)
  renderAlert()
  if (!state.alerts.length && pendingCommand) setTimeout(runPendingCommand, 100)
}
async function resolveAlert(kind: string) {
  const alert = state.alerts[alertIndex]
  if (!alert) return
  const buttons = [...actions.querySelectorAll('button')]; buttons.forEach(b => b.disabled = true)
  try {
    receive(await invoke<DesktopData>('desktop_resolve_alert', { id: alert.id, action: kind }))
    if (kind === 'done' && !state.alerts.length && !pendingCommand) say('又完成了一件事，做得不错。', 'celebrate')
  } catch (error) { time.textContent = `操作失败：${String(error)}` }
  finally { buttons.forEach(b => b.disabled = false) }
}
$('#alert-done').addEventListener('click', () => void resolveAlert('done'))
$('#alert-snooze').addEventListener('click', () => void resolveAlert('snooze'))
$('#alert-dismiss').addEventListener('click', () => void resolveAlert('dismiss'))
$('#alert-next').addEventListener('click', () => { alertIndex++; renderAlert() })
$('#speech-close').addEventListener('click', () => { if (state.alerts.length) void resolveAlert('dismiss'); else speech.hidden = true })
$('#pet-menu-toggle').addEventListener('click', () => setMenu(menu.hidden))
async function openNotes() { try { await desktopAction('notes') } catch (error) { say(String(error)) } }
$('#pet-count').addEventListener('click', () => void openNotes())
$('#pet-open').addEventListener('click', event => {
  if (suppressClick || event.detail > 1) return
  if (sleeping) { setSleeping(false); say('我醒啦。清单里的事都还记着。', 'wake'); return }
  stage.classList.remove('is-tapped'); void stage.offsetWidth; stage.classList.add('is-tapped')
  const greetings = definition.phrases?.tap?.length ? definition.phrases.tap : ['我在呢。今天想先做哪件事？']
  say(greetings[Math.floor(Math.random() * greetings.length)], 'react')
})
$('#pet-open').addEventListener('dblclick', () => { if (!suppressClick) void openNotes() })
stage.addEventListener('animationend', () => stage.classList.remove('is-tapped'))
$('#pet-open').addEventListener('contextmenu', event => { event.preventDefault(); setMenu(menu.hidden) })
document.addEventListener('pointerdown', () => { lastInteraction = Date.now() })
let down: { x: number; y: number; scale: number; origin: Promise<PhysicalPosition> } | null = null
$('#pet-open').addEventListener('pointerdown', event => {
  if (event.button === 0) {
    down = { x: event.screenX, y: event.screenY, scale: window.devicePixelRatio, origin: currentWindow.outerPosition() }
    suppressClick = false; $('#pet-open').setPointerCapture(event.pointerId)
  }
})
document.addEventListener('pointermove', async event => {
  const start = down
  if (!start) return
  const dx = event.screenX - start.x, dy = event.screenY - start.y
  if (!dragging && Math.hypot(dx, dy) < 5) return
  if (!dragging) { dragging = true; suppressClick = true; action('drag') }
  try {
    const origin = await start.origin
    await currentWindow.setPosition(new PhysicalPosition(Math.round(origin.x + dx * start.scale), Math.round(origin.y + dy * start.scale)))
  } catch (error) { say(`无法移动：${String(error)}`) }
})
function endDrag() {
  down = null
  if (dragging) { dragging = false; if (!runPendingCommand()) action(baseMotion()); setTimeout(() => { suppressClick = false }, 200) }
}
document.addEventListener('pointerup', endDrag)
document.addEventListener('pointercancel', endDrag)
$('#pet-extra-play').addEventListener('click', () => {
  setMenu(false); if (state.alerts.length) return
  setSleeping(false); action($<HTMLSelectElement>('#pet-extra-action').value)
})
menu.querySelectorAll<HTMLButtonElement>('[data-pet-action]').forEach(button => button.addEventListener('click', async () => {
  const name = button.dataset.petAction!
  setMenu(false)
  if (state.alerts.length && ['wave', 'stretch', 'play', 'sleep'].includes(name)) { renderAlert(); return }
  if (name === 'wave') { say('一件一件来，我会帮你记着。'); return }
  if (name === 'stretch') { say('坐久了，一起伸个懒腰吧。', 'stretch'); return }
  if (name === 'play') { say('让我试试把这面拼好。', 'play'); return }
  if (name === 'sleep') { setSleeping(!sleeping); say(sleeping ? '我眯一会儿，有待办提醒会醒来。' : '休息好了，我们继续吧。', sleeping ? 'sleep' : 'wake'); return }
  if (name === 'demo') { say('该准备下一件事啦。', 'remind', true); return }
  try { await desktopAction(name) } catch (error) { say(String(error)) }
}))
document.addEventListener('keydown', event => { if (event.key === 'Escape') setMenu(false) })

// The transparent area is click-through. Polling lets the pet become interactive
// again when the pointer returns, even while the OS is ignoring this window.
setInterval(async () => {
  if (polling || dragging || down) return
  polling = true
  try {
    const [cursor, origin, scale] = await Promise.all([cursorPosition(), currentWindow.outerPosition(), currentWindow.scaleFactor()])
    const x = (cursor.x - origin.x) / scale, y = (cursor.y - origin.y) / scale
    const hit = [...document.querySelectorAll<HTMLElement>('[data-interactive]')].some(element => {
      if (element.hidden) return false
      const r = element.getBoundingClientRect()
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
    })
    if (ignore === hit) { await currentWindow.setIgnoreCursorEvents(!hit); ignore = !hit }
  } catch { /* Keep normal hit testing if this platform cannot pass through clicks. */ }
  finally { polling = false }
}, 150)
let moveTimer: ReturnType<typeof setTimeout>
void currentWindow.onMoved(({ payload }) => {
  clearTimeout(moveTimer)
  moveTimer = setTimeout(() => void invoke('desktop_save_position', { x: payload.x, y: payload.y }).catch(() => {}), 400)
})
setInterval(() => {
  if (state.alerts.length) { time.textContent = alertLabel(state.alerts[alertIndex % state.alerts.length]); return }
  if (!preferences.idleChat || !menu.hidden || sleeping || Date.now() - lastInteraction < 180000) return
  lastInteraction = Date.now()
  const count = state.todos.filter(t => !t.done).length
  const phrases = definition.phrases?.idle
  say(phrases?.length ? phrases[Math.floor(Math.random() * phrases.length)] : count ? `还有 ${count} 件事在清单里，需要时打开便签就好。` : '现在没有待办，记得给自己一点休息时间。')
}, 60000)
action('idle')
window.addEventListener('unload', () => animator.dispose())
void (async () => {
  await listen<DesktopData>('desktop-data', event => receive(event.payload))
  receive(await getDesktopData())
  await listen<PetRuntime>('pet-updated', event => void applyRuntime(event.payload).catch(error => showPetError(String(error))))
  await listen<PetCommand>('pet-command', event => acceptCommand(event.payload))
  const runtime = await petRequest<PetRuntime>('current')
  await applyRuntime(runtime)
  if (!state.alerts.length && !runtime.command) say(preferences.greeting || definition.phrases?.greeting || '我来啦。点我互动，双击打开便签。')
})().catch(error => say(`便签暂不可用：${String(error)}`))
