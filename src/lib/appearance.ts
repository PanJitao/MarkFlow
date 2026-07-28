export interface AppearanceSettings {
  backgroundColor: string
  backgroundOpacity: number
  panelOpacity: number
  panelBlurEnabled: boolean
  editorColor: string
  previewColor: string
}

export interface StoredBackgroundAsset {
  blob: Blob
  name: string
  type: string
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  backgroundColor: '#efe4d6',
  backgroundOpacity: 100,
  panelOpacity: 94,
  panelBlurEnabled: true,
  editorColor: '#1f1b15',
  previewColor: '#282016',
}

const SETTINGS_KEY = 'exchangemd:appearance'
const DB_NAME = 'exchangemd-appearance'
const DB_VERSION = 1
const STORE_NAME = 'assets'
const BACKGROUND_KEY = 'background'

const isColor = (value: unknown): value is string => (
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
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
      backgroundColor: isColor(saved.backgroundColor) ? saved.backgroundColor : DEFAULT_APPEARANCE.backgroundColor,
      backgroundOpacity: clamp(saved.backgroundOpacity, 0, 100, DEFAULT_APPEARANCE.backgroundOpacity),
      panelOpacity: clamp(saved.panelOpacity, 5, 100, DEFAULT_APPEARANCE.panelOpacity),
      panelBlurEnabled: typeof saved.panelBlurEnabled === 'boolean'
        ? saved.panelBlurEnabled
        : DEFAULT_APPEARANCE.panelBlurEnabled,
      editorColor: isColor(saved.editorColor) ? saved.editorColor : DEFAULT_APPEARANCE.editorColor,
      previewColor: isColor(saved.previewColor) ? saved.previewColor : DEFAULT_APPEARANCE.previewColor,
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
