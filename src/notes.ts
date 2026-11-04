import './desktop-notes.css'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { desktopAction, dueLabel, emptyDesktopData, getDesktopData, localDateInput, todoInput, type DesktopData, type DesktopTodo } from './lib/desktop-notes'

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!
const status = $('#notes-status'), form = $<HTMLFormElement>('#todo-form')
const title = $<HTMLInputElement>('#todo-title'), due = $<HTMLInputElement>('#todo-due')
const reminders = $<HTMLFieldSetElement>('#reminders'), custom = $<HTMLInputElement>('#custom-remind'), minutes = $<HTMLInputElement>('#custom-minutes')
const currentWindow = getCurrentWindow()
let state = emptyDesktopData(), editingId: string | null = null
let saveTimer: ReturnType<typeof setTimeout>, saving: Promise<void> | null = null
const drafts = new Map<string, { text: string; color: string }>()
const trashIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/></svg>'
const editIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="m14 5 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14z"/></svg>'
function message(value: string, error = false) { status.textContent = value; status.classList.toggle('error', error); $('#retry-notes').hidden = !error || !drafts.size }
function receive(data: DesktopData) {
  if (data.revision < state.revision) return
  state = data; renderTodos(); renderNotes()
  $('#todo-count').textContent = String(data.todos.filter(t => !t.done).length); $('#note-count').textContent = String(data.notes.length)
}
async function mutate(command: string, args: Record<string, unknown>) {
  const data = await invoke<DesktopData>(command, args); receive(data); return data
}
function guarded(operation: () => Promise<unknown>) { void operation().catch(error => message(String(error), true)) }
function deleteButton(label: string, remove: () => Promise<unknown>) {
  const button = document.createElement('button'); button.innerHTML = trashIcon; button.title = label; button.setAttribute('aria-label', label)
  button.addEventListener('click', () => {
    if (button.dataset.confirm !== 'true') {
      button.dataset.confirm = 'true'; button.textContent = '确认删除'
      setTimeout(() => { button.dataset.confirm = ''; button.innerHTML = trashIcon }, 4000); return
    }
    button.disabled = true
    guarded(async () => { try { await remove(); message('已删除') } finally { button.disabled = false } })
  })
  return button
}
function renderTodos() {
  const showDone = $<HTMLInputElement>('#show-completed').checked
  const todos = state.todos.filter(t => showDone || !t.done).sort((a, b) => Number(a.done) - Number(b.done) || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))
  const fragment = document.createDocumentFragment()
  for (const todo of todos) {
    const item = document.createElement('article'); item.className = `todo-item${todo.done ? ' done' : ''}${!todo.done && todo.dueAt && todo.dueAt < Date.now() ? ' overdue' : ''}`
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = todo.done; check.setAttribute('aria-label', `完成：${todo.title}`)
    check.addEventListener('change', () => guarded(async () => { try { await mutate('desktop_set_done', { id: todo.id, done: check.checked }); message(check.checked ? '待办已完成' : '待办已重新打开') } catch (error) { check.checked = todo.done; throw error } }))
    const copy = document.createElement('div'), name = document.createElement('div'), meta = document.createElement('div')
    name.className = 'todo-title'; name.textContent = todo.title; meta.className = 'todo-meta'
    const date = document.createElement('span'); date.className = 'due'; date.textContent = dueLabel(todo.dueAt); meta.append(date)
    if (todo.remindBefore.length) {
      const reminder = document.createElement('span'); reminder.textContent = todo.remindBefore.map(m => m ? `提前 ${m} 分钟` : '准时').join(' / '); meta.append(reminder)
    }
    if (todo.snoozeUntil) { const snooze = document.createElement('span'); snooze.textContent = `稍后提醒 ${dueLabel(todo.snoozeUntil)}`; meta.append(snooze) }
    copy.append(name, meta)
    const controls = document.createElement('div'); controls.className = 'item-actions'
    const edit = document.createElement('button'); edit.innerHTML = editIcon; edit.title = '编辑待办'; edit.setAttribute('aria-label', `编辑：${todo.title}`); edit.addEventListener('click', () => editTodo(todo))
    controls.append(edit, deleteButton(`删除：${todo.title}`, () => mutate('desktop_delete_todo', { id: todo.id })))
    item.append(check, copy, controls); fragment.append(item)
  }
  $('#todo-list').replaceChildren(fragment); $('#todo-empty').hidden = todos.length > 0
}
function renderNotes() {
  const list = $('#note-list')
  for (const element of [...list.children] as HTMLElement[]) { if (!state.notes.some(n => n.id === element.dataset.noteId)) element.remove() }
  for (const note of state.notes) {
    let card = [...list.children].find(e => (e as HTMLElement).dataset.noteId === note.id) as HTMLElement | undefined
    if (!card) {
      card = document.createElement('article'); card.className = 'note-card'; card.dataset.noteId = note.id
      const input = document.createElement('textarea'); input.maxLength = 20000; input.placeholder = '写点什么…'; input.setAttribute('aria-label', '便签内容')
      const footer = document.createElement('div'); footer.className = 'note-footer'
      const color = document.createElement('select'); color.setAttribute('aria-label', '便签颜色')
      for (const [value, label] of [['cream', '米白'], ['mint', '薄荷'], ['rose', '淡粉'], ['lavender', '浅紫']]) { const option = document.createElement('option'); option.value = value; option.textContent = label; color.append(option) }
      const changed = () => {
        drafts.set(note.id, { text: input.value, color: color.value }); card!.dataset.color = color.value
        message('保存中…'); clearTimeout(saveTimer); saveTimer = setTimeout(() => guarded(flushNotes), 400)
      }
      input.addEventListener('input', changed); color.addEventListener('change', changed)
      footer.append(color, deleteButton('删除便签', async () => { await flushNotes(); return mutate('desktop_delete_note', { id: note.id }) }))
      card.append(input, footer); list.append(card)
    }
    const draft = drafts.get(note.id), input = card.querySelector('textarea')!, color = card.querySelector('select')!
    if (document.activeElement !== input) input.value = draft?.text ?? note.text
    color.value = draft?.color ?? note.color; card.dataset.color = color.value
  }
  $('#note-empty').hidden = state.notes.length > 0
}
function flushNotes(): Promise<void> {
  clearTimeout(saveTimer)
  if (saving) return saving.then(() => drafts.size ? flushNotes() : undefined)
  const entries = [...drafts]
  saving = (async () => {
    for (const [id, draft] of entries) {
      await mutate('desktop_save_note', { noteId: id, ...draft })
      if (drafts.get(id) === draft) drafts.delete(id)
    }
    message(drafts.size ? '保存中…' : '已保存')
  })().finally(() => { saving = null })
  return saving.then(() => drafts.size ? flushNotes() : undefined)
}
$('#retry-notes').addEventListener('click', () => guarded(flushNotes))
function syncReminderControls() { reminders.disabled = !due.value; minutes.disabled = !custom.checked; minutes.required = custom.checked && !!due.value }
function rememberDraft() {
  const offsets = [...form.querySelectorAll<HTMLInputElement>('[name=remind]:checked')].map(el => Number(el.value))
  localStorage.setItem('markflow:todoDraft', JSON.stringify({ id: editingId, title: title.value, due: due.value, offsets, custom: custom.checked, minutes: minutes.value }))
}
function editTodo(todo?: DesktopTodo) {
  editingId = todo?.id ?? null; form.reset(); title.value = todo?.title ?? ''; due.value = todo?.dueAt ? localDateInput(todo.dueAt) : ''
  const offsets = todo?.remindBefore ?? [0]
  form.querySelectorAll<HTMLInputElement>('[name=remind]').forEach(input => input.checked = offsets.includes(Number(input.value)))
  const extra = offsets.find(m => ![0, 15, 30, 60].includes(m)); custom.checked = extra !== undefined; minutes.value = String(extra ?? 10)
  form.hidden = false; syncReminderControls(); title.focus(); rememberDraft()
}
$('#add-todo').addEventListener('click', () => editTodo())
$('#cancel-todo').addEventListener('click', () => { form.hidden = true; localStorage.removeItem('markflow:todoDraft') })
form.addEventListener('input', () => { syncReminderControls(); rememberDraft() })
form.addEventListener('submit', event => {
  event.preventDefault()
  guarded(async () => {
    const offsets = due.value ? [...form.querySelectorAll<HTMLInputElement>('[name=remind]:checked')].map(input => Number(input.value)) : []
    if (due.value && custom.checked) offsets.push(Number(minutes.value))
    const input = todoInput(editingId, title.value, due.value, offsets)
    const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!; submit.disabled = true
    try { await mutate('desktop_save_todo', { input }); form.hidden = true; localStorage.removeItem('markflow:todoDraft'); message('待办已保存，宠物会按设置的时间提醒') }
    finally { submit.disabled = false }
  })
})
$('#show-completed').addEventListener('change', renderTodos)
$('#add-note').addEventListener('click', () => guarded(async () => {
  const data = await mutate('desktop_save_note', { noteId: null, text: '', color: 'cream' })
  const note = data.notes.at(-1)!
  const element = [...$('#note-list').children].find(e => (e as HTMLElement).dataset.noteId === note.id)
  element?.querySelector('textarea')?.focus(); message('便签已创建')
}))
document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => button.addEventListener('click', () => {
  const notes = button.dataset.tab === 'notes'
  $('#todos-panel').hidden = notes; $('#notes-panel').hidden = !notes
  document.querySelectorAll('[data-tab]').forEach(tab => tab.setAttribute('aria-selected', String(tab === button)))
}))
$('#back-editor').addEventListener('click', () => guarded(async () => { await flushNotes(); await desktopAction('editor') }))
$('#notes-close').addEventListener('click', () => guarded(() => currentWindow.close()))
let closing = false
void currentWindow.onCloseRequested(async event => {
  event.preventDefault(); if (closing) return; closing = true
  try { await flushNotes(); await currentWindow.destroy() }
  catch (error) { closing = false; message(`内容未能保存，窗口已保留：${String(error)}`, true) }
})
void (async () => {
  await listen<DesktopData>('desktop-data', event => receive(event.payload))
  receive(await getDesktopData()); message('已保存')
  try {
    const draft = JSON.parse(localStorage.getItem('markflow:todoDraft') || 'null')
    if (draft && (!draft.id || state.todos.some(todo => todo.id === draft.id))) {
      editTodo(draft.id ? state.todos.find(todo => todo.id === draft.id) : undefined)
      title.value = draft.title || ''; due.value = draft.due || ''; custom.checked = !!draft.custom; minutes.value = draft.minutes || '10'
      form.querySelectorAll<HTMLInputElement>('[name=remind]').forEach(input => input.checked = draft.offsets?.includes(Number(input.value)))
      syncReminderControls(); rememberDraft(); message('已恢复未提交的待办草稿')
    }
  } catch { /* Invalid drafts do not replace saved notes or tasks. */ }
})().catch(error => message(`读取失败：${String(error)}`, true))
