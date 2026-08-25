// Mermaid 图表渲染：把预览中的 .mermaid 容器（由 src/lib/markdown.ts 的 fence 规则生成）绘制成 SVG。
// - 懒加载：mermaid 库体积较大，按需动态 import，图表出现前不增加启动成本；
// - 安全：securityLevel 保持 strict，图表标签中的 HTML 会被转义，不执行用户内容；
// - 主题：跟随根节点 data-theme（dark / light），主题切换后可重渲染；
// - 代际令牌：用户继续输入触发新一轮渲染时，旧一轮的结果直接丢弃，
//   避免较慢的旧 SVG 回填覆盖新文档内容。

type MermaidModule = typeof import('mermaid').default

const MERMAID_FONT_FAMILY = "'Segoe UI', 'Microsoft YaHei', 'PingFang SC', sans-serif"

let modulePromise: Promise<MermaidModule> | null = null
let renderGeneration = 0
let renderIdSequence = 0
let configuredTheme: 'dark' | 'light' | null = null

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
    theme: theme === 'dark' ? 'dark' : 'default',
    fontFamily: MERMAID_FONT_FAMILY,
    themeVariables: { fontFamily: MERMAID_FONT_FAMILY },
    mindmap: { padding: 8, useMaxWidth: false },
  })
  configuredTheme = theme
}

/**
 * 把 root 内所有 .mermaid[data-mermaid-code] 容器渲染成 SVG。
 * 全部完成后调用 onSettled（用于图表插入后重新校准滚动锚点）。
 * 渲染失败时保留源码属性并把错误信息展示在容器内，主题切换后会再次尝试。
 */
export function renderMermaidContainers(root: HTMLElement, onSettled?: () => void): void {
  const containers = [...root.querySelectorAll<HTMLElement>('.mermaid[data-mermaid-code]')]
  if (!containers.length) {
    onSettled?.()
    return
  }
  const generation = ++renderGeneration
  void (async () => {
    const mermaid = await loadMermaid()
    if (generation !== renderGeneration) {
      onSettled?.()
      return
    }
    configure(mermaid)
    await Promise.all(containers.map(async (container) => {
      const source = container.getAttribute('data-mermaid-code') || ''
      if (!source.trim()) {
        container.textContent = ''
        return
      }
      try {
        const id = `markflow-mermaid-${++renderIdSequence}`
        const { svg } = await mermaid.render(id, source)
        if (generation !== renderGeneration || !container.isConnected) return
        container.innerHTML = svg
        container.classList.remove('mermaid-error')
        container.classList.add('mermaid-rendered')
      } catch (error) {
        if (generation !== renderGeneration || !container.isConnected) return
        container.classList.add('mermaid-error')
        container.textContent = `图表渲染失败：${error instanceof Error ? error.message : String(error)}`
      }
    }))
    if (generation === renderGeneration) onSettled?.()
  })()
}

/** 主题切换后重渲染当前预览中已出现的图表（源码保留在 data-mermaid-code 上）。 */
export function rerenderMermaidContainers(root: HTMLElement, onSettled?: () => void): void {
  if (!root.querySelector('.mermaid')) return
  renderMermaidContainers(root, onSettled)
}
