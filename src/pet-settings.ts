import './desktop-notes.css'
import './pet-settings.css'
import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { listen } from '@tauri-apps/api/event'
import { PetAnimator } from './lib/pet-animation'
import { petRequest, petAsset, stylePet } from './lib/pet-client'
import { defaultPetSettings, petLayout, type PetLibrary, type PetSettings } from './lib/pet-types'
import protocol from '../public/pet-api/protocol.json'

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!
let library: PetLibrary, dirty = false, busy = false, previewGeneration = 0
const select = $<HTMLSelectElement>('#pet-library'), stage = $('#settings-pet-stage'), status = $('#pet-settings-status')
const input = (id: string) => $<HTMLInputElement>(`#pet-${id}`)
const animator = new PetAnimator(stage, $<HTMLImageElement>('#settings-pet-poster'), () => animator.setMotion('idle'), message => report(message, true))
const names: Record<string, string> = { idle:'待机', react:'点击互动', wave:'挥手', drag:'拖动', remind:'提醒', celebrate:'庆祝', sleepStart:'入睡', sleep:'睡眠', wake:'醒来', stretch:'伸懒腰', play:'玩耍' }
function report(message: string, error = false) { status.textContent = message; status.classList.toggle('error', error) }
function currentPet() { return library.pets.find(pet => pet.id === select.value)! }
function settings(): PetSettings { return { scale: +input('scale').value, opacity: +input('opacity').value, speed: +input('speed').value, flip: input('flip').checked, bubbleColor: input('bubble').value, idleChat: input('chat').checked, greeting: input('greeting').value } }
function fillSettings(value: PetSettings) {
  for (const key of ['scale','opacity','speed'] as const) input(key).value = String(value[key])
  input('flip').checked = value.flip; input('bubble').value = value.bubbleColor; input('chat').checked = value.idleChat; input('greeting').value = value.greeting
}
async function preview() {
  const pet = currentPet(), value = settings(), generation = ++previewGeneration
  $('#scale-value').textContent = `${Math.round(value.scale * 100)}%`; $('#opacity-value').textContent = `${Math.round(value.opacity * 100)}%`; $('#speed-value').textContent = `${value.speed.toFixed(1)}×`
  const layout = stylePet(stage, pet, value), base = petLayout(pet, { ...value, scale: 1 })
  const fit = Math.min(1, 200 / base.width, 105 / base.height)
  stage.style.width = `${layout.width * fit}px`; stage.style.height = `${layout.height * fit}px`
  await animator.configure(pet, value, file => petAsset(pet, file))
  if (generation === previewGeneration) animator.setMotion('idle')
}
async function selectPet() {
  const pet = currentPet(); if (!pet) return
  dirty = false; fillSettings(library.profiles[pet.id] || defaultPetSettings())
  $('#pet-description').textContent = pet.description || '自定义宠物'
  $('#pet-attribution').textContent = [pet.id === 'dsh-blue' ? '来源项目：dsh-pet' : '', pet.author ? `作者：${pet.author}` : '', pet.license ? `许可：${pet.license}` : ''].filter(Boolean).join(' · ')
  $('#active-pet-label').textContent = library.activeId === pet.id ? '当前使用' : '预览中'
  $<HTMLButtonElement>('#remove-pet').disabled = pet.id === 'dsh-blue'
  $<HTMLSelectElement>('#preview-action').replaceChildren(...Object.keys(pet.actions).map(action => new Option(names[action] || action, action)))
  $<HTMLSelectElement>('#preview-action').value = 'idle'
  await preview()
}
async function refresh(id = select.value) {
  library = await petRequest<PetLibrary>('list')
  select.replaceChildren(...library.pets.map(pet => new Option(pet.name, pet.id)))
  select.value = library.pets.some(pet => pet.id === id) ? id : library.activeId
  if (!select.value) select.value = 'dsh-blue'
  $<HTMLInputElement>('#allow-mcp').checked = library.allowMcp
  $<HTMLTextAreaElement>('#mcp-config').value = JSON.stringify(library.mcpConfig, null, 2)
  $('#library-warnings').hidden = !library.warnings.length; $('#library-warnings').textContent = library.warnings.join('\n')
  $('#mcp-tools').replaceChildren(...library.tools.map(tool => { const li = document.createElement('li'); li.textContent = tool.name; li.title = tool.description; return li }))
  await selectPet()
}
async function work(action: () => Promise<void>) {
  if (busy) return
  busy = true
  const controls = [...document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input,button,select')]
  const disabled = controls.map(control => control.disabled); controls.forEach(control => control.disabled = true)
  try { await action() } catch (error) { report(String(error), true) }
  finally { controls.forEach((control, i) => control.disabled = disabled[i]); busy = false; if (library) $<HTMLButtonElement>('#remove-pet').disabled = select.value === 'dsh-blue' }
}
select.addEventListener('change', () => void selectPet().catch(error => report(String(error),true)))
$('#pet-parameters').addEventListener('input', () => { dirty = true; void preview().catch(error => report(String(error),true)) })
$('#play-preview').addEventListener('click', () => animator.setMotion($<HTMLSelectElement>('#preview-action').value))
$('#reset-pet').addEventListener('click', () => { fillSettings(defaultPetSettings()); dirty = true; void preview().catch(error => report(String(error),true)) })
$('#refresh-library').addEventListener('click', () => void work(async () => { await refresh(); report('宠物库已刷新') }))
$('#pet-parameters').addEventListener('submit', event => {
  event.preventDefault(); void work(async () => { await petRequest('configure', { id:select.value, settings:settings(), activate:true }); await petRequest('show'); await refresh(); report('已应用到桌面；参数会随这只宠物保存') })
})
$('#import-pet').addEventListener('click', () => void work(async () => {
  const path = await open({ multiple:false, filters:[{name:'宠物包或图片',extensions:['json','png','webp','gif','jpg','jpeg']}] })
  if (typeof path !== 'string') return
  const pack = /\.json$/i.test(path)
  const args = pack ? {path} : {path,name:path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/,'').slice(0,80)}
  const result = await petRequest<{id:string;warnings:string[]}>(pack ? 'install' : 'from_image',args)
  await refresh(result.id); report(`已导入，预览后点击「应用到桌面」${result.warnings.length ? '。' + result.warnings.join('；') : ''}`)
}))
$('#remove-pet').addEventListener('click', () => void work(async () => { await petRequest('remove',{id:select.value}); await refresh(); report('已移到系统回收站') }))
$('#allow-mcp').addEventListener('change', () => void work(async () => {
  const enabled = $<HTMLInputElement>('#allow-mcp').checked
  try { await petRequest('allow_mcp',{enabled}); library.allowMcp = enabled; report(enabled ? '已允许 AI 通过 MCP 管理宠物' : '已关闭 MCP 控制') }
  catch (error) { $<HTMLInputElement>('#allow-mcp').checked = library.allowMcp; throw error }
}))
async function copy(text: string) { await navigator.clipboard.writeText(text) }
$('#copy-mcp').addEventListener('click', () => void work(async () => { await copy(JSON.stringify(library.mcpConfig,null,2)); report('连接配置已复制，粘贴到 AI 客户端的 MCP 设置中') }))
const generationPrompt = '请通过 markflow-pet MCP 为我制作一只自定义宠物：先调用 pet_prepare_generation 获取规范，再调用你自己的绘图或动画生成工具，保存素材到本机。通过 pet_create_from_image 或 pet_validate_pack / pet_install_pack 安装，最后用 pet_configure 和 pet_show 应用到桌面。开始前先问我想要的角色外观；不要把生成规范当作已经生成了图片。'
$('#copy-generation').addEventListener('click', () => void work(async () => { await copy(generationPrompt); report('生成指令已复制，发给已连接 MCP 的 AI 即可') }))
async function saveJson(defaultPath: string, content: unknown) { const path = await save({defaultPath,filters:[{name:'JSON',extensions:['json']}]}); if (path) { await invoke('write_text_file',{path,content:JSON.stringify(content,null,2)+'\n'}); report('文件已保存') } }
$('#save-mcp').addEventListener('click', () => void work(() => saveJson('markflow-pet.mcp.json',library.mcpConfig)))
$('#export-template').addEventListener('click', () => void work(() => saveJson('pet.json',protocol.template)))
window.addEventListener('unload', () => animator.dispose())
void (async () => {
  await listen('pet-library-changed', () => { if (busy) return; if (dirty) {report('宠物库已更新，当前预览参数保留；可刷新读取最新设置');return} void refresh().catch(error => report(String(error),true)) })
  await listen<{tool:string;at:number}>('pet-mcp-activity', event => { $('#mcp-activity').textContent = `最近调用：${event.payload.tool} · ${new Date(event.payload.at).toLocaleTimeString()}` })
  await refresh(); report('参数先在此预览，点击「应用到桌面」保存')
})().catch(error => report(String(error),true))
