import { builtInPet, defaultPetSettings, type PetClip, type PetDefinition, type PetSettings } from './pet-types'

export type PetMotion = string
type Frame = { node: HTMLElement; source: HTMLImageElement | HTMLVideoElement; url: string }
const persistent = new Set(['idle', 'drag', 'remind', 'sleep'])
export function prefersImageAnimation(platform = navigator.platform, userAgent = navigator.userAgent): boolean {
  return /iPhone|iPad|iPod/i.test(userAgent) || (/Mac/i.test(platform) && !/Chrome|Chromium|Edg|Firefox/i.test(userAgent))
}
export class PetAnimator {
  private pet = builtInPet
  private settings = defaultPetSettings()
  private loader = async (file: string) => {
    const response = await fetch(`./pets/dsh-blue/${file}`)
    if (!response.ok) throw new Error(`Pet asset: ${response.status}`)
    return response.blob()
  }
  private motion = 'idle'
  private clip = ''
  private generation = 0
  private configuration = 0
  private current: Frame | null = null
  private posterUrl: string | null = null
  private cancelPending: (() => void) | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private cache = new Map<string, Promise<Blob>>()
  private disposed = false
  private reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  private onPreferenceChange = () => this.setMotion(this.motion, true)
  constructor(private stage: HTMLElement, private poster: HTMLImageElement, private onComplete: (motion: PetMotion) => void, private onError = (message: string) => console.warn(message)) {
    this.reduced?.addEventListener('change', this.onPreferenceChange)
  }
  async configure(pet: PetDefinition, settings: PetSettings, loader: (file: string) => Promise<Blob>) {
    const configuration = ++this.configuration
    if (pet.id === this.pet.id) {
      this.settings = settings
      if (this.current?.source instanceof HTMLVideoElement) this.current.source.playbackRate = settings.speed
      return
    }
    const url = URL.createObjectURL(await loader(pet.poster))
    if (configuration !== this.configuration || this.disposed) { URL.revokeObjectURL(url); return }
    this.stop(); this.cache.clear()
    if (this.posterUrl) URL.revokeObjectURL(this.posterUrl)
    this.posterUrl = url; this.poster.src = url; this.poster.hidden = false
    this.pet = pet; this.settings = settings; this.loader = loader
    this.setMotion(this.motion, true)
  }
  setMotion(motion: PetMotion, force = false) {
    if (this.disposed || (!force && motion === this.motion && persistent.has(motion) && this.generation)) return
    this.motion = motion
    if (this.reduced?.matches) { this.stop(); this.poster.hidden = false; return }
    const action = motion === 'sleep' && this.pet.actions.sleepStart ? 'sleepStart' : motion
    const choices = this.pet.actions[action] || this.pet.actions.idle
    const clip = motion === 'idle' ? choices[0] : choices[Math.floor(Math.random() * choices.length)]
    void this.play(clip)
  }
  private next() {
    if (this.motion === 'idle') {
      const pool = this.pet.actions.idle
      this.repeat(this.clip === pool[0] ? pool[Math.floor(Math.random() * pool.length)] : pool[0])
    } else if (this.motion === 'sleep' || this.motion === 'drag') {
      this.repeat((this.pet.actions[this.motion] || this.pet.actions.idle)[0])
    } else if (this.motion === 'remind') this.repeat(this.pet.actions.idle[0])
    else this.onComplete(this.motion)
  }
  private repeat(id: string) {
    if (id === this.clip && this.current?.source instanceof HTMLImageElement && !this.pet.clips[id].sprite) {
      // Let GIF/WebP finish their own loops, even when their length is unknown on import.
      const generation = this.generation
      this.timer = setTimeout(() => { if (generation === this.generation && !this.disposed) this.next() }, this.pet.clips[id].durationMs)
    } else void this.play(id)
  }
  private asset(file: string) {
    let loading = this.cache.get(file)
    if (!loading) { loading = this.loader(file).catch(error => { this.cache.delete(file); throw error }); this.cache.set(file, loading) }
    return loading
  }
  private async play(id: string, fallback = false) {
    const generation = ++this.generation, clip = this.pet.clips[id]
    clearTimeout(this.timer); this.cancelPending?.(); this.cancelPending = null
    const useFallback = !!clip.fallback && (fallback || prefersImageAnimation())
    const file = useFallback ? clip.fallback! : clip.file
    const video = /\.(webm|mp4)$/i.test(file), sprite = !useFallback ? clip.sprite : undefined
    let candidate: Frame | null = null
    try {
      const blob = await this.asset(file)
      if (generation !== this.generation || this.disposed) return
      const source = document.createElement(video ? 'video' : 'img'), url = URL.createObjectURL(blob)
      const node = sprite ? document.createElement('div') : source
      candidate = { node, source, url }; node.className = 'pet-animation-frame'; node.style.visibility = 'hidden'; node.setAttribute('aria-hidden', 'true')
      if (source instanceof HTMLVideoElement) { source.muted = true; source.playsInline = true; source.preload = 'auto'; source.playbackRate = this.settings.speed }
      else { source.alt = ''; source.draggable = false }
      if (sprite) {
        node.classList.add('pet-sprite'); node.append(source)
        source.style.width = `${sprite.columns * 100}%`; source.style.height = `${sprite.rows * 100}%`
      }
      this.stage.append(node)
      await new Promise<void>((resolve, reject) => {
        const ready = video ? 'loadeddata' : 'load'
        const cleanup = () => { clearTimeout(timeout); source.removeEventListener(ready, loaded); source.removeEventListener('error', failed) }
        const loaded = () => { cleanup(); resolve() }
        const failed = () => { cleanup(); reject(new Error('宠物素材无法解码，请检查格式或提供兼容的 fallback')) }
        const timeout = setTimeout(failed, 10000)
        this.cancelPending = () => { cleanup(); reject(new Error('Superseded')) }
        source.addEventListener(ready, loaded, { once: true }); source.addEventListener('error', failed, { once: true }); source.src = url
      })
      if (source instanceof HTMLVideoElement) await source.play()
      if (generation !== this.generation || this.disposed) { this.release(candidate); return }
      this.cancelPending = null; this.release(this.current); this.current = candidate; this.clip = id
      node.style.visibility = 'visible'; this.poster.hidden = true
      this.stage.dataset.clip = id; this.stage.dataset.format = sprite ? 'sprite' : file.split('.').pop()!; delete this.stage.dataset.error
      const ended = () => { if (generation === this.generation && !this.disposed) this.next() }
      if (source instanceof HTMLVideoElement) source.onended = ended
      else if (sprite) this.animateSprite(source as HTMLImageElement, clip, generation, ended)
      else this.timer = setTimeout(ended, clip.durationMs)
    } catch (error) {
      this.release(candidate)
      if (generation !== this.generation || this.disposed) return
      this.cancelPending = null
      if (!useFallback && clip.fallback) { void this.play(id, true); return }
      this.poster.hidden = !!this.current; this.stage.dataset.error = String(error); this.onError(String(error))
    }
  }
  private animateSprite(source: HTMLImageElement, clip: PetClip, generation: number, ended: () => void) {
    const sprite = clip.sprite!; let frame = 0
    const advance = () => {
      if (generation !== this.generation || this.disposed) return
      source.style.transform = `translate(${-100 * (frame % sprite.columns) / sprite.columns}%, ${-100 * Math.floor(frame / sprite.columns) / sprite.rows}%)`
      this.timer = setTimeout(() => { frame++; if (frame >= sprite.frames) ended(); else advance() }, 1000 / sprite.fps / this.settings.speed)
    }
    advance()
  }
  private release(frame: Frame | null) {
    if (!frame) return
    if (frame.source instanceof HTMLVideoElement) { frame.source.onended = null; frame.source.pause() }
    frame.source.removeAttribute('src'); frame.node.remove(); URL.revokeObjectURL(frame.url)
  }
  private stop() { this.generation++; clearTimeout(this.timer); this.cancelPending?.(); this.cancelPending = null; this.release(this.current); this.current = null }
  dispose() {
    this.disposed = true; this.configuration++; this.stop(); this.cache.clear()
    if (this.posterUrl) URL.revokeObjectURL(this.posterUrl)
    this.reduced?.removeEventListener('change', this.onPreferenceChange)
  }
}
