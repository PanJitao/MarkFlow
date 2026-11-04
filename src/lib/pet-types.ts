import builtIn from '../../public/pets/dsh-blue/pet.json'

export interface PetClip { file: string; fallback?: string; durationMs: number; sprite?: { columns: number; rows: number; frames: number; fps: number } }
export interface PetDefinition {
  version: number; id: string; name: string; description?: string; author?: string; license?: string
  canvas: { width: number; height: number }; hitBox: { x: number; y: number; width: number; height: number }
  poster: string; clips: Record<string, PetClip>; actions: Record<string, string[]>
  phrases?: { greeting?: string; tap?: string[]; idle?: string[] }
}
export interface PetSettings { scale: number; opacity: number; speed: number; flip: boolean; bubbleColor: string; idleChat: boolean; greeting: string }
export interface PetCommand { id: string; action?: string; text?: string; expiresAt: number }
export interface PetRuntime { revision: number; pet: PetDefinition; settings: PetSettings; command: PetCommand | null; warning?: string }
export interface PetLibrary { pets: PetDefinition[]; activeId: string; profiles: Record<string, PetSettings>; allowMcp: boolean; warnings: string[]; mcpConfig: unknown; tools: { name: string; description: string }[] }
export const builtInPet: PetDefinition = builtIn
export const defaultPetSettings = (): PetSettings => ({ scale: 1, opacity: 1, speed: 1, flip: false, bubbleColor: '#fcfdff', idleChat: true, greeting: '' })
export function petLayout(pet: PetDefinition, settings: PetSettings) {
  const ratio = pet.canvas.width / pet.canvas.height
  const width = Math.round(Math.min(420, 240 * ratio) * settings.scale), height = Math.round(width / ratio)
  return { width, height, windowWidth: Math.max(360, width + 24), windowHeight: Math.max(360, height + 214) }
}
