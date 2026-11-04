export const isMacOS = /Macintosh|Mac OS X/.test(navigator.userAgent) || navigator.platform.includes('Mac')
export const isWindows = /Win/.test(navigator.platform)

export function primaryModifier(event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey'>) {
  return isMacOS ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}

export function shortcutLabel(key: string) {
  return isMacOS ? `⌘${key.replace('Shift+', '⇧').replace('Alt+', '⌥')}` : `Ctrl+${key}`
}

export function normalizeComparablePath(path: string) {
  const normalized = path.replace(/\\/g, '/').replace(/\/$/, '')
  // macOS can use case-sensitive APFS volumes. Preserve the names returned by the filesystem.
  return isWindows ? normalized.toLowerCase() : normalized
}
