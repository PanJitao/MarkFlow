import type { WallpaperValues } from './wallpaper-runtime'

export interface WallpaperProperty {
  key: string; type: string; text: string; value: boolean | number | string
  min?: number; max?: number; step?: number; precision?: number; order?: number
  condition?: string; options?: { label: string; value: boolean | number | string }[]
}
const STORAGE_KEY = 'markflow:wallpaperProperties'
export function propertyLabel(value: unknown): string {
  return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}
export function propertyDefinitions(raw: Record<string, unknown> = {}): WallpaperProperty[] {
  return Object.entries(raw).filter(([, value]) => value && typeof value === 'object').map(([key, value]) => {
    const prop = value as Partial<WallpaperProperty>
    return { ...prop, key, type: prop.type || 'text', text: key === 'schemecolor' ? '壁纸主题色' : propertyLabel(prop.text || key), value: prop.value ?? '' }
  }).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}
export function savedWallpaperValues(path: string): WallpaperValues {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')[path] || {} } catch { return {} }
}
export function saveWallpaperValues(path: string, values: WallpaperValues) {
  let all: Record<string, WallpaperValues> = {}
  try { all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { /* Recover invalid preferences. */ }
  all[path] = values
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
}
export function wallpaperValues(properties: WallpaperProperty[], saved: WallpaperValues): WallpaperValues {
  return Object.fromEntries(properties.filter(p => !['group', 'text'].includes(p.type)).map(p => [p.key, saved[p.key] ?? p.value]))
}

// WE conditions are expressions, not JavaScript. Never eval project content.
export function propertyVisible(condition: string | undefined, values: WallpaperValues): boolean {
  if (!condition) return true
  try {
    const tokens = condition.match(/\s+|===|!==|==|!=|>=|<=|&&|\|\||[()!<>]|-?\d+(?:\.\d+)?|'[^']*'|"[^"]*"|[\w.]+/g) || []
    if (tokens.join('') !== condition) return true
    const list = tokens.filter(t => t.trim())
    let cursor = 0
    const primary = (): boolean | number | string => {
      const token = list[cursor++]
      if (token === '!') return !primary()
      if (token === '(') { const result = expression(0); if (list[cursor++] !== ')') throw new Error(); return result }
      if (token === 'true' || token === 'false') return token === 'true'
      if (/^-?\d/.test(token)) return Number(token)
      if (/^['"]/.test(token)) return token.slice(1, -1)
      if (!token || !/^[\w.]+$/.test(token)) throw new Error()
      return values[token.replace(/\.value$/, '')] ?? false
    }
    const precedence: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '===': 3, '!=': 3, '!==': 3, '>': 4, '<': 4, '>=': 4, '<=': 4 }
    const expression = (minimum: number): boolean | number | string => {
      let left = primary()
      while ((precedence[list[cursor]] || 0) > minimum) {
        const op = list[cursor++]; const right = expression(precedence[op])
        if (op === '&&') left = Boolean(left && right)
        else if (op === '||') left = Boolean(left || right)
        else if (op === '==' || op === '===') left = String(left) === String(right)
        else if (op === '!=' || op === '!==') left = String(left) !== String(right)
        else if (op === '>') left = Number(left) > Number(right)
        else if (op === '<') left = Number(left) < Number(right)
        else if (op === '>=') left = Number(left) >= Number(right)
        else left = Number(left) <= Number(right)
      }
      return left
    }
    const result = expression(0)
    return cursor === list.length ? Boolean(result) : true
  } catch { return true }
}
export function weColorToHex(value: unknown): string {
  const rgb = String(value).split(/\s+/).slice(0, 3).map(n => Math.round(Math.max(0, Math.min(1, Number(n) || 0)) * 255))
  return rgb.length === 3 ? `#${rgb.map(n => n.toString(16).padStart(2, '0')).join('')}` : '#000000'
}
export function hexToWeColor(value: string): string { return [1, 3, 5].map(i => (parseInt(value.slice(i, i + 2), 16) / 255).toFixed(6)).join(' ') }
