export type ThemeMode = 'light' | 'dark' | 'system'

export interface AppearanceSettings {
  themeMode: ThemeMode
  backgroundColor: string
  backgroundOpacity: number
  panelOpacity: number
  codeBlockColor: string
  codeBlockOpacity: number
  autoSaveIntervalSeconds: number
  autoSaveOnWindowBlur: boolean
  autoSaveOnFileSwitch: boolean
  panelBlurEnabled: boolean
  topbarBlurEnabled: boolean
  statusbarBlurEnabled: boolean
  buttonTextColor: string
  editorColor: string
  editorColorCustom: boolean
  previewColor: string
  previewColorCustom: boolean
}

export interface StoredBackgroundAsset {
  blob: Blob
  name: string
  type: string
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  themeMode: 'system',
  backgroundColor: '#e7e7e7',
  backgroundOpacity: 100,
  panelOpacity: 94,
  codeBlockColor: '#0f172a',
  codeBlockOpacity: 36,
  autoSaveIntervalSeconds: 5,
  autoSaveOnWindowBlur: true,
  autoSaveOnFileSwitch: true,
  panelBlurEnabled: true,
  topbarBlurEnabled: true,
  statusbarBlurEnabled: true,
  buttonTextColor: '#555555',
  editorColor: '#1a1a1a',
  editorColorCustom: false,
  previewColor: '#1a1a1a',
  previewColorCustom: false,
}

const LEGACY_DEFAULT_COLORS = {
  backgroundColor: new Set(['#eaf0ed', '#efe4d6']),
  buttonTextColor: new Set(['#53646b', '#20262e']),
  editorColor: new Set(['#17232b', '#1f1b15']),
  previewColor: new Set(['#17232b', '#282016']),
}

const SETTINGS_KEY = 'exchangemd:appearance'
const DB_NAME = 'exchangemd-appearance'
const DB_VERSION = 1
const STORE_NAME = 'assets'
const BACKGROUND_KEY = 'background'

const isColor = (value: unknown): value is string => (
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
)

const loadColor = (value: unknown, legacy: Set<string>, fallback: string) => {
  if (!isColor(value) || legacy.has(value.toLowerCase())) return fallback
  return value
}

const colorWasCustomized = (value: unknown, legacy: Set<string>, defaultColor: string) => (
  isColor(value) && !legacy.has(value.toLowerCase()) && value.toLowerCase() !== defaultColor.toLowerCase()
)

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

export function loadAppearanceSettings(): AppearanceSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null') as Partial<AppearanceSettings> | null
    if (!saved) return { ...DEFAULT_APPEARANCE }
    return {
      themeMode: saved.themeMode === 'light' || saved.themeMode === 'dark' || saved.themeMode === 'system'
        ? saved.themeMode
        : DEFAULT_APPEARANCE.themeMode,
      backgroundColor: loadColor(saved.backgroundColor, LEGACY_DEFAULT_COLORS.backgroundColor, DEFAULT_APPEARANCE.backgroundColor),
      backgroundOpacity: clamp(saved.backgroundOpacity, 0, 100, DEFAULT_APPEARANCE.backgroundOpacity),
      panelOpacity: clamp(saved.panelOpacity, 5, 100, DEFAULT_APPEARANCE.panelOpacity),
      codeBlockColor: isColor(saved.codeBlockColor) ? saved.codeBlockColor : DEFAULT_APPEARANCE.codeBlockColor,
      codeBlockOpacity: clamp(saved.codeBlockOpacity, 0, 100, DEFAULT_APPEARANCE.codeBlockOpacity),
      autoSaveIntervalSeconds: clamp(saved.autoSaveIntervalSeconds, 3, 10, DEFAULT_APPEARANCE.autoSaveIntervalSeconds),
      autoSaveOnWindowBlur: typeof saved.autoSaveOnWindowBlur === 'boolean'
        ? saved.autoSaveOnWindowBlur
        : DEFAULT_APPEARANCE.autoSaveOnWindowBlur,
      autoSaveOnFileSwitch: typeof saved.autoSaveOnFileSwitch === 'boolean'
        ? saved.autoSaveOnFileSwitch
        : DEFAULT_APPEARANCE.autoSaveOnFileSwitch,
      panelBlurEnabled: typeof saved.panelBlurEnabled === 'boolean'
        ? saved.panelBlurEnabled
        : DEFAULT_APPEARANCE.panelBlurEnabled,
      topbarBlurEnabled: typeof saved.topbarBlurEnabled === 'boolean'
        ? saved.topbarBlurEnabled
        : DEFAULT_APPEARANCE.topbarBlurEnabled,
      statusbarBlurEnabled: typeof saved.statusbarBlurEnabled === 'boolean'
        ? saved.statusbarBlurEnabled
        : DEFAULT_APPEARANCE.statusbarBlurEnabled,
      buttonTextColor: loadColor(saved.buttonTextColor, LEGACY_DEFAULT_COLORS.buttonTextColor, DEFAULT_APPEARANCE.buttonTextColor),
      editorColor: loadColor(saved.editorColor, LEGACY_DEFAULT_COLORS.editorColor, DEFAULT_APPEARANCE.editorColor),
      editorColorCustom: typeof saved.editorColorCustom === 'boolean'
        ? saved.editorColorCustom
        : colorWasCustomized(saved.editorColor, LEGACY_DEFAULT_COLORS.editorColor, DEFAULT_APPEARANCE.editorColor),
      previewColor: loadColor(saved.previewColor, LEGACY_DEFAULT_COLORS.previewColor, DEFAULT_APPEARANCE.previewColor),
      previewColorCustom: typeof saved.previewColorCustom === 'boolean'
        ? saved.previewColorCustom
        : colorWasCustomized(saved.previewColor, LEGACY_DEFAULT_COLORS.previewColor, DEFAULT_APPEARANCE.previewColor),
    }
  } catch {
    return { ...DEFAULT_APPEARANCE }
  }
}

export function saveAppearanceSettings(settings: AppearanceSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

function openAssetDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('无法打开外观素材存储'))
  })
}

export async function loadBackgroundAsset(): Promise<StoredBackgroundAsset | null> {
  const database = await openAssetDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(BACKGROUND_KEY)
      request.onsuccess = () => {
        const value = request.result as StoredBackgroundAsset | undefined
        resolve(value?.blob instanceof Blob ? value : null)
      }
      request.onerror = () => reject(request.error || new Error('无法读取背景素材'))
    })
  } finally {
    database.close()
  }
}

export async function saveBackgroundAsset(asset: StoredBackgroundAsset): Promise<void> {
  const database = await openAssetDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put(asset, BACKGROUND_KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error || new Error('无法保存背景素材'))
      transaction.onabort = () => reject(transaction.error || new Error('背景素材保存已取消'))
    })
  } finally {
    database.close()
  }
}

export async function clearBackgroundAsset(): Promise<void> {
  const database = await openAssetDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).delete(BACKGROUND_KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error || new Error('无法清除背景素材'))
      transaction.onabort = () => reject(transaction.error || new Error('清除背景素材已取消'))
    })
  } finally {
    database.close()
  }
}
