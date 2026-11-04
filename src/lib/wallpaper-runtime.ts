import { openWallpaperPlayer, closeWallpaperPlayer } from './io'

export type WallpaperValues = Record<string, boolean | string | number>
export interface WallpaperPlayer {
  frame: HTMLIFrameElement
  properties(values: WallpaperValues): void
  pause(paused: boolean): void
  destroy(): void
}

export async function mountWallpaperPlayer(path: string, container: HTMLElement, values: WallpaperValues, signal?: AbortSignal): Promise<WallpaperPlayer> {
  signal?.throwIfAborted()
  const { token, url } = await openWallpaperPlayer(path)
  if (signal?.aborted) { void closeWallpaperPlayer(token).catch(() => undefined); signal.throwIfAborted() }
  const frame = document.createElement('iframe')
  frame.className = 'wallpaper-live-frame'
  // Keep the current wallpaper in front until the replacement is committed.
  // visibility:hidden prevents scene first-frame callbacks in WebView2.
  frame.style.zIndex = '-1'
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.setAttribute('referrerpolicy', 'no-referrer')
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  const send = (type: string, value: unknown) => frame.contentWindow?.postMessage({ channel: 'markflow-wallpaper', type, value }, '*')
  let disposed = false
  let ready = false
  let timer: ReturnType<typeof setTimeout>
  let receive: (event: MessageEvent) => void
  let abort: () => void
  const destroy = () => {
    if (disposed) return
    disposed = true
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    window.removeEventListener('message', receive)
    frame.remove()
    void closeWallpaperPlayer(token).catch(() => undefined)
  }
  const loaded = new Promise<void>((resolve, reject) => {
    abort = () => { destroy(); reject(signal?.reason) }
    signal?.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => { destroy(); reject(new Error('壁纸加载超时，请尝试其他项目')) }, 60000)
    receive = (event) => {
      if (event.source !== frame.contentWindow || event.data?.channel !== 'markflow-wallpaper') return
      if (event.data.type === 'boot') send('start', values)
      else if (event.data.type === 'ready') { ready = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve() }
      else if (event.data.type === 'error') {
        const message = String(event.data.value).slice(0, 400)
        if (!ready) { destroy(); reject(new Error(message)) }
        else container.dispatchEvent(new CustomEvent('wallpaper-error', { detail: message }))
      }
    }
    window.addEventListener('message', receive)
  })
  frame.src = url
  container.append(frame)
  await loaded
  return { frame, properties: (props) => send('properties', props), pause: (paused) => send('paused', paused), destroy }
}
