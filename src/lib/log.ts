// 会话日志：环形缓冲 + 全局错误捕获，可导出为文本用于排查。
export type LogLevel = 'info' | 'warn' | 'error'
export type LogEntry = {
  time: string
  level: LogLevel
  scope: string
  message: string
}

const MAX_LOG_ENTRIES = 600
const entries: LogEntry[] = []

export function log(level: LogLevel, scope: string, message: string): void {
  const entry: LogEntry = { time: new Date().toISOString(), level, scope, message }
  entries.push(entry)
  if (entries.length > MAX_LOG_ENTRIES) entries.shift()
  const line = `[${level.toUpperCase()}] ${scope}: ${message}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export function getLogEntries(): readonly LogEntry[] {
  return entries
}

/** 把页面级未捕获错误写进日志，避免丢失可疑内存/渲染异常。 */
export function attachLogErrorHandlers(): void {
  window.addEventListener('error', (event) => {
    log('error', 'window', event.message || '未知页面错误')
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    log('error', 'unhandledrejection', reason instanceof Error ? reason.message : String(reason))
  })
}

/** 生成可写盘/可分享的日志文本，头部带运行环境信息。 */
export function formatLogExport(): string {
  const now = new Date().toISOString()
  const memoryInfo = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory
  const memory = memoryInfo
    ? `，JS 堆 ${Math.round((memoryInfo.usedJSHeapSize / 1024 / 1024) * 10) / 10} MiB / ${Math.round(memoryInfo.jsHeapSizeLimit / 1024 / 1024)} MiB`
    : ''
  const body = entries.map((entry) => `${entry.time} [${entry.level.toUpperCase()}] ${entry.scope}: ${entry.message}`)
  return [`MarkFlow 诊断日志·导出时间 ${now}`, `平台 ${navigator.userAgent}${memory}`, '', ...body].join('\n') + '\n'
}
