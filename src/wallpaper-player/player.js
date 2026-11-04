/* Runs only in the isolated wallpaper frame, never in the editor document. */
const base = location.href.replace(/player\.html.*$/, 'files/').replace('wallpaper.localhost', 'wallpaper-media.localhost').replace(/^wallpaper:/, 'wallpaper-media:');
let player;
let started = false;
// CacheStorage's getter throws in an opaque-origin frame. Disable the optional
// persistent bake cache instead of granting wallpaper scripts a same-origin context.
try { void window.caches; } catch { Object.defineProperty(window, 'caches', { value: undefined }); }
const send = (type, value) => parent.postMessage({ channel: 'markflow-wallpaper', type, value }, '*');
addEventListener('error', event => send('error', event.message || '壁纸脚本运行失败'));
addEventListener('unhandledrejection', event => send('error', String(event.reason?.message || event.reason)));
addEventListener('message', async (event) => {
  if (event.source !== parent || event.data?.channel !== 'markflow-wallpaper') return;
  const { type, value } = event.data;
  try {
    if (type === 'start' && !started) {
      started = true;
      player = WebWallGL.createScene(document.querySelector('#wallpaper'), {
        fit: 'cover', fps: 30, renderDpr: 1, volume: 0, audio: null, media: null, bake: false,
        properties: value || {}, onError: (error) => send('error', String(error?.message || error)),
      });
      await player.load(WebWallGL.httpSource(base));
      send('ready', player.getProperties());
    } else if (type === 'properties') { player?.setProperties(value); send('properties', player?.getProperties()); }
    else if (type === 'paused') { if (value) player?.pause(); else player?.resume(); }
    else if (type === 'pointer') { player?.pushPointer(value.x, value.y, 0); }
  } catch (error) { send('error', String(error?.message || error)); }
});
send('boot');
