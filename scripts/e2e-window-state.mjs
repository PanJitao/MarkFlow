const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const MODE = process.argv[2] || 'phase1'
const DEBUG = 'http://127.0.0.1:9222/json/list'
async function listPages() {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 4000)
  try { const res = await fetch(DEBUG, { signal: ac.signal }); return await res.json() } finally { clearTimeout(timer) }
}
function makeClient() {
  let ws = null, seq = 0
  const pending = new Map()
  return {
    async connect(url) {
      ws = new WebSocket(url)
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')) })
      ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
    },
    async evalJs(expression, timeoutMs = 6000) {
      const id = ++seq
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout')) }, timeoutMs)
        pending.set(id, (m) => { clearTimeout(timer); resolve(m) })
        ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
      })
    },
    close() { try { ws && ws.close() } catch {} },
  }
}
async function waitPages(min, timeoutMs = 30000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try { const p = (await listPages()).filter((x) => x.type === 'page' && x.url.includes('tauri')); if (p.length >= min) return p } catch {}
    await sleep(500)
  }
  throw new Error('waitPages timeout')
}
async function waitPagesTitleGone(titlePrefix, timeoutMs = 10000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try { const p = (await listPages()).filter((x) => x.type === 'page' && x.url.includes('tauri')); if (p.every((x) => x.title !== titlePrefix)) return } catch {}
    await sleep(400)
  }
}
async function mainEval(client, expr) {
  const r = await client.evalJs(expr)
  if (r.exceptionDetails) throw new Error('eval exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 200))
  return r.result?.result?.value
}
if (MODE === 'phase1') {
  const pages = await waitPages(1)
  const main = makeClient()
  await main.connect(pages[0].webSocketDebuggerUrl)
  await sleep(2500)
  console.log('主窗口 label =', await mainEval(main, 'window.__TAURI_INTERNALS__ ? window.__TAURI_INTERNALS__.metadata.currentWindow.label : null'))
  await mainEval(main, "document.querySelector('#editor-toggle-btn').click(), 'ok'")
  await sleep(300)
  console.log('editorHidden class =', await mainEval(main, "document.querySelector('#workspace').classList.contains('editor-hidden')"))
  console.log('localStorage editorHidden =', await mainEval(main, "localStorage.getItem('markflow:editorHidden')"))
  const exprMove = "(async () => { const i = window.__TAURI_INTERNALS__; const l = i.metadata.currentWindow.label; await i.invoke('plugin:window|set_position', { label: l, value: { Physical: { x: 120, y: 80 } } }); await i.invoke('plugin:window|set_size', { label: l, value: { Physical: { width: 1100, height: 700 } } }); return 'ok'; })()";
  console.log('move/resize =', await mainEval(main, exprMove))
  await sleep(1200)
  console.log('localStorage windowBounds =', await mainEval(main, "localStorage.getItem('markflow:windowBounds')"))
  const stateA = await mainEval(main, "localStorage.getItem('exchangemd:lastState')")
  const editorA = await mainEval(main, "document.querySelector('#editor').value")
  console.log('主会话基线: stateLen=' + (stateA || '').length + ' editorLen=' + (editorA || '').length)
  await mainEval(main, "document.querySelector('[data-file=new-window]').click(), 'clicked'")
  await sleep(2500)
  const pages2 = await waitPages(2)
  const pages0 = pages[0].webSocketDebuggerUrl
  const blank = pages2.find((p) => p.webSocketDebuggerUrl !== pages0) || pages2[1]
  const bk = makeClient()
  await bk.connect(blank.webSocketDebuggerUrl)
  await sleep(1500)
  console.log('空白窗口标题 =', blank.title)
  console.log('空白窗口 editor 内容长度 =', (await mainEval(bk, "document.querySelector('#editor').value"))?.length)
  console.log('空白窗口 空文件树 =', await mainEval(bk, "!!document.querySelector('.file-tree-empty') || !document.querySelector('.file-tree-row')"))
  console.log('空白窗口 文件标签 =', await mainEval(bk, "document.querySelector('#file-label') ? document.querySelector('#file-label').textContent : 'n/a'"))
  await mainEval(bk, "document.querySelector('#editor').value = 'BLANK_TEST_MARKER'; document.querySelector('#editor').dispatchEvent(new Event('input')); 'typed'")
  await sleep(900)
  console.log('空白窗口输入后 主会话未变 =', (await mainEval(main, "localStorage.getItem('exchangemd:lastState')")) === stateA)
  await mainEval(bk, "document.querySelector('#window-close-btn').click(), 'closed'")
  await waitPagesTitleGone(blank.title, 8000)
  console.log('空白窗口已关闭')
  await sleep(1000)
  console.log('关闭空白后 主会话未变 =', (await mainEval(main, "localStorage.getItem('exchangemd:lastState')")) === stateA)
  console.log('主窗口 editor 未变 =', (await mainEval(main, "document.querySelector('#editor').value")) === editorA)
  // 收尾前把编辑区状态对齐为「隐藏」，供 phase2 验证跨重启恢复
  const needClick = !(await mainEval(main, "document.querySelector('#workspace').classList.contains('editor-hidden')"))
  if (needClick) {
    await mainEval(main, "document.querySelector('#editor-toggle-btn').click(), 'ok'")
    await sleep(300)
  }
  console.log('收尾 editorHidden class =', await mainEval(main, "document.querySelector('#workspace').classList.contains('editor-hidden')"), 'storage =', await mainEval(main, "localStorage.getItem('markflow:editorHidden')"))
  await mainEval(main, "document.querySelector('#window-close-btn').click(), 'closing'")
  await sleep(2500)
  main.close(); bk.close()
  console.log('PHASE1_DONE')
  process.exit(0)
}
if (MODE === 'phase2') {
  const pages = await waitPages(1)
  const main = makeClient()
  await main.connect(pages[0].webSocketDebuggerUrl)
  await sleep(2000)
  const exprPos = "(async () => await window.__TAURI_INTERNALS__.invoke('plugin:window|outer_position', { label: window.__TAURI_INTERNALS__.metadata.currentWindow.label }))()";
  const exprSize = "(async () => await window.__TAURI_INTERNALS__.invoke('plugin:window|outer_size', { label: window.__TAURI_INTERNALS__.metadata.currentWindow.label }))()";
  console.log('重启后 outer_position =', JSON.stringify(await mainEval(main, exprPos)), ' outer_size =', JSON.stringify(await mainEval(main, exprSize)))
  console.log('重启后 editor-hidden 恢复 =', await mainEval(main, "document.querySelector('#workspace').classList.contains('editor-hidden')"))
  console.log('重启后 主会话内容长度 =', (await mainEval(main, "document.querySelector('#editor').value"))?.length)
  console.log('重启后 文件树行数 =', await mainEval(main, "document.querySelectorAll('.file-tree-row').length"))
  console.log('重启后 展开目录数 =', await mainEval(main, "[...document.querySelectorAll('.file-tree-row[aria-expanded=true]')].length"))
  main.close()
  console.log('PHASE2_DONE')
  process.exit(0)
}