const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const MODE = process.argv[2] || 'phase3'
const DEBUG = 'http://127.0.0.1:9222/json/list'
async function listPages() { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 4000); try { const r = await fetch(DEBUG, { signal: ac.signal }); return await r.json() } finally { clearTimeout(t) } }
function makeClient() {
  let ws = null, seq = 0; const pending = new Map()
  return {
    async connect(url) { ws = new WebSocket(url); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')) }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } } },
    async evalJs(expression, timeoutMs = 6000) { const id = ++seq; return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout')) }, timeoutMs); pending.set(id, (m) => { clearTimeout(timer); resolve(m) }); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })) }) },
    close() { try { ws && ws.close() } catch {} },
  }
}
async function waitPages(min, timeoutMs = 30000) { const t0 = Date.now(); while (Date.now() - t0 < timeoutMs) { try { const p = (await listPages()).filter((x) => x.type === 'page' && x.url.includes('tauri')); if (p.length >= min) return p } catch {} await sleep(500) } throw new Error('waitPages timeout') }
async function mainEval(client, expr) { const r = await client.evalJs(expr); if (r.exceptionDetails) throw new Error('eval exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 200)); return r.result?.result?.value }

if (MODE === 'phase3') {
  const pages = await waitPages(1)
  const main = makeClient()
  await main.connect(pages[0].webSocketDebuggerUrl)
  await sleep(2500)
  const dirs = await mainEval(main, "[...document.querySelectorAll('.file-tree-row[data-kind=directory]')].map((r) => r.dataset.path)")
  console.log('目录行数 =', dirs.length, JSON.stringify(dirs).slice(0, 120))
  if (dirs.length) {
    await mainEval(main, `document.querySelector('.file-tree-row[data-kind="directory"]').click(), 'expanded'`)
    await sleep(1000)
    console.log('展开后 aria-expanded=true 数 =', await mainEval(main, "[...document.querySelectorAll('.file-tree-row[aria-expanded=true]')].length"))
    console.log('展开记录已写入 =', (await mainEval(main, "localStorage.getItem('markflow:expandedTreeDirs')")).indexOf('\\') >= 0 || (await mainEval(main, "localStorage.getItem('markflow:expandedTreeDirs')")).length > 10)
    await mainEval(main, "document.querySelector('#window-close-btn').click(), 'closing'")
  } else {
    console.log('没有子目录可展开，跳过关闭')
  }
  await sleep(2500)
  main.close()
  console.log('PHASE3_DONE')
  process.exit(0)
}
if (MODE === 'phase4') {
  const pages = await waitPages(1)
  const main = makeClient()
  await main.connect(pages[0].webSocketDebuggerUrl)
  await sleep(2500)
  console.log('重启后 展开目录数 =', await mainEval(main, "[...document.querySelectorAll('.file-tree-row[aria-expanded=true]')].length"))
  main.close()
  console.log('PHASE4_DONE')
  process.exit(0)
}