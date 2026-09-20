// Mermaid 图表渲染：把预览中的 .mermaid 容器（由 src/lib/markdown.ts 的 fence 规则生成）绘制成 SVG。
// - 懒加载：mermaid 库体积较大，按需动态 import，图表出现前不增加启动成本；
// - 安全：securityLevel 保持 strict，图表标签中的 HTML 会被转义，不执行用户内容；
// - 主题：跟随根节点 data-theme（dark / light），主题切换后可重渲染；
// - 代际令牌：用户继续输入触发新一轮渲染时，旧一轮的结果直接丢弃，
//   避免较慢的旧 SVG 回填覆盖新文档内容。
// - 源码载体：图表源码来自容器的文本内容，不经过 HTML 属性。DOMPurify 的
//   SAFE_FOR_XML 防护会丢弃含 `-->` / `--!>` / `]>` 的属性值，而这些是
//   flowchart、stateDiagram、sequenceDiagram 的常用箭头。渲染成 SVG 后源码
//   记在 sourceCache 里，供主题切换重绘复用。
// - 临时节点：mermaid 渲染时会在 body 下建一个 `div#d<id>` 暂存 SVG。语法出错时
//   它内部会先画错误图再抛出，跳过自己的清理逻辑，导致节点永久残留；预览是边打字
//   边渲染的，每个错误字符都会留下一个。suppressErrorRendering 让 mermaid 在抛错
//   前自行清理，sweepTempNodes 再兜一道，避免 DOM 无界增长。

type MermaidModule = typeof import('mermaid').default

const MERMAID_FONT_FAMILY = "'Segoe UI', 'Microsoft YaHei', 'PingFang SC', sans-serif"

let modulePromise: Promise<MermaidModule> | null = null
let renderGeneration = 0
let renderIdSequence = 0
let configuredTheme: 'dark' | 'light' | null = null
/** 已成图容器 -> 图表源码；容器被替换后条目随之回收 */
const sourceCache = new WeakMap<HTMLElement, string>()

/**
 * 取容器的图表源码。
 * 已渲染过的容器（成图或报错）文本已经不是纯源码，只认 sourceCache；
 * 未渲染过的容器文本就是 fence 里的原始源码。
 */
function readSource(container: HTMLElement): string {
  const cached = sourceCache.get(container)
  if (cached !== undefined) return cached
  if (container.classList.contains('mermaid-error') || container.classList.contains('mermaid-rendered')) return ''
  return container.textContent || ''
}

function currentTheme(): 'dark' | 'light' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

function loadMermaid(): Promise<MermaidModule> {
  if (!modulePromise) {
    modulePromise = import('mermaid').then((module) => module.default as MermaidModule)
  }
  return modulePromise
}

function configure(mermaid: MermaidModule) {
  const theme = currentTheme()
  if (configuredTheme === theme) return
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    // 我们自己在容器里展示错误文案，不需要 mermaid 画错误图（并顺带避免临时节点残留）
    suppressErrorRendering: true,
    theme: theme === 'dark' ? 'dark' : 'default',
    fontFamily: MERMAID_FONT_FAMILY,
    themeVariables: { fontFamily: MERMAID_FONT_FAMILY },
    mindmap: { padding: 8, useMaxWidth: false },
  })
  configuredTheme = theme
}

/** 清掉 mermaid 遗留在 body 上的渲染暂存节点（id 形如 `dmarkflow-mermaid-*`）。 */
function sweepTempNodes() {
  document.querySelectorAll('body > div[id^="dmarkflow-mermaid-"]').forEach((node) => node.remove())
}

/**
 * 把 root 内所有 .mermaid[data-mermaid] 容器渲染成 SVG。
 * 全部完成后调用 onSettled（用于图表插入后重新校准滚动锚点）。
 * 渲染失败时把错误信息展示在容器内，并缓存源码，主题切换后会再次尝试。
 */
export function renderMermaidContainers(root: HTMLElement, onSettled?: () => void): void {
  const containers = [...root.querySelectorAll<HTMLElement>('.mermaid[data-mermaid]')]
  if (!containers.length) {
    onSettled?.()
    return
  }
  const generation = ++renderGeneration
  // 源码在替换 innerHTML 之前先读出来：成图后容器文本会变成 SVG 内容
  const jobs = containers.map((container) => ({ container, source: readSource(container) }))
  void (async () => {
    const mermaid = await loadMermaid()
    if (generation !== renderGeneration) {
      onSettled?.()
      return
    }
    configure(mermaid)
    await Promise.all(jobs.map(async ({ container, source }) => {
      if (!source.trim()) {
        container.textContent = ''
        return
      }
      try {
        const id = `markflow-mermaid-${++renderIdSequence}`
        const { svg } = await mermaid.render(id, source)
        if (generation !== renderGeneration || !container.isConnected) return
        container.innerHTML = svg
        sourceCache.set(container, source)
        container.classList.remove('mermaid-error')
        container.classList.add('mermaid-rendered')
      } catch (error) {
        if (generation !== renderGeneration || !container.isConnected) return
        sourceCache.set(container, source)
        container.classList.add('mermaid-error')
        // 保留源码可见，另起一行显示原因：容器文本仍是源码，重渲染与用户排错都不受影响
        const reason = error instanceof Error ? error.message : String(error)
        container.textContent = source
        const notice = document.createElement('p')
        notice.className = 'mermaid-error-reason'
        notice.textContent = `图表渲染失败：${reason}`
        container.prepend(notice)
      }
    }))
    sweepTempNodes()
    if (generation === renderGeneration) onSettled?.()
  })()
}

/** 主题切换后重渲染当前预览中已出现的图表（源码取自 sourceCache）。 */
export function rerenderMermaidContainers(root: HTMLElement, onSettled?: () => void): void {
  if (!root.querySelector('.mermaid')) return
  renderMermaidContainers(root, onSettled)
}
