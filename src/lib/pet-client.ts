import { invoke } from '@tauri-apps/api/core'
import { type PetDefinition, type PetSettings, petLayout } from './pet-types'
export const petRequest = <T>(operation: string, args: Record<string, unknown> = {}) => invoke<T>('pet_request', { operation, args })
export async function petAsset(pet: PetDefinition, file: string): Promise<Blob> {
  if (pet.id === 'dsh-blue') {
    const response = await fetch(`./pets/dsh-blue/${file}`)
    if (!response.ok) throw new Error('内置宠物素材加载失败')
    return response.blob()
  }
  const bytes = await invoke<ArrayBuffer>('pet_read_asset', { id: pet.id, file })
  const extension = file.split('.').pop()?.toLowerCase()
  const mime: Record<string, string> = { png: 'image/png', webp: 'image/webp', gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg', webm: 'video/webm', mp4: 'video/mp4' }
  return new Blob([bytes], { type: mime[extension || ''] || 'application/octet-stream' })
}
export function stylePet(stage: HTMLElement, pet: PetDefinition, settings: PetSettings) {
  const layout = petLayout(pet, settings)
  stage.style.width = `${layout.width}px`; stage.style.height = `${layout.height}px`
  stage.style.opacity = String(settings.opacity); stage.style.transform = settings.flip ? 'scaleX(-1)' : ''
  stage.style.setProperty('--pet-flip', settings.flip ? '-1' : '1')
  return layout
}
