import { invoke } from '@tauri-apps/api/core'

export interface DesktopNote { id: string; text: string; color: string }
export interface DesktopTodo { id: string; title: string; dueAt: number | null; remindBefore: number[]; done: boolean; snoozeUntil: number | null }
export interface DesktopAlert { id: string; todoId: string; title: string; dueAt: number; triggerAt: number }
export interface DesktopData { revision: number; enabled: boolean; petHidden: boolean; notes: DesktopNote[]; todos: DesktopTodo[]; alerts: DesktopAlert[] }
export const emptyDesktopData = (): DesktopData => ({ revision: 0, enabled: false, petHidden: false, notes: [], todos: [], alerts: [] })
export const desktopAction = (action: string) => invoke<void>('desktop_action', { action })
export const getDesktopData = () => invoke<DesktopData>('desktop_get')
export function localDateInput(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
export function todoInput(id: string | null, title: string, localDue: string, offsets: number[]) {
  const dueAt = localDue ? new Date(localDue).getTime() : null
  if (!title.trim() || title.trim().length > 300) throw new Error('请输入 1–300 字的待办内容')
  if (dueAt !== null && (!Number.isFinite(dueAt) || localDateInput(dueAt) !== localDue)) throw new Error('请选择有效的本地日期和时间')
  if (offsets.some(n => !Number.isInteger(n) || n < 0 || n > 10080)) throw new Error('提前提醒请输入 0–10080 之间的整数分钟')
  if (dueAt === null && offsets.length) throw new Error('请先设置待办时间')
  return { id, title: title.trim(), dueAt, remindBefore: [...new Set(offsets)].sort((a, b) => a - b) }
}
export function dueLabel(time: number | null): string {
  return time === null ? '未设置时间' : new Date(time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}
export function alertLabel(alert: DesktopAlert, now = Date.now()): string {
  const minutes = Math.ceil((alert.dueAt - now) / 60000)
  return minutes > 0 ? `还有 ${minutes} 分钟 · ${dueLabel(alert.dueAt)}` : `已到时间 · ${dueLabel(alert.dueAt)}`
}
