import { markdownToHtml } from './markdown.ts'

export interface SourceRange { start: number; end: number }
export type TextFormat = 'bold' | 'italic' | 'underline' | 'strike' | 'color' | 'highlight' | 'size'

export function formatSource(source: string, ranges: SourceRange[], format: TextFormat, value = '') {
  const tags = { bold: 'strong', italic: 'em', underline: 'u', strike: 's' }
  let open: string
  let close: string
  if (format === 'color' || format === 'highlight') {
    if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error('请选择有效的颜色')
    open = `<span style="${format === 'color' ? 'color' : 'background-color'}: ${value}">`
    close = '</span>'
  } else if (format === 'size') {
    if (!/^(12|14|16|18|20|24|28|32)$/.test(value)) throw new Error('请选择有效的字号')
    open = `<span style="font-size: ${value}px">`
    close = '</span>'
  } else {
    open = `<${tags[format]}>`
    close = `</${tags[format]}>`
  }
  // Apply from the end so earlier offsets remain valid. Each text run is wrapped
  // separately, preserving existing Markdown emphasis, links and block structure.
  for (const { start, end } of [...ranges].sort((a, b) => b.start - a.start)) {
    source = source.slice(0, start) + open + source.slice(start, end) + close + source.slice(end)
  }
  return source
}

function renderedText(source: string) {
  const root = document.createElement('div')
  root.innerHTML = markdownToHtml(source)
  return root.textContent || ''
}

// Validate boundary positions against the renderer itself. This avoids guessing
// offsets by stripping Markdown (which confuses repeated words, links and entities).
function sourceBoundary(source: string, text: string, offset: number, end: boolean) {
  const marker = '\uE000'
  if (source.includes(marker)) throw new Error('此段文字请在源码区修改样式')
  const positions: number[] = []
  for (let i = 0; i <= source.length; i++) {
    if (end ? source[i - 1] === text[offset - 1] || source[i - 1] === ';'
      : source[i] === text[offset] || source[i] === '&' || source[i] === '\\') positions.push(i)
  }
  if (!end) positions.reverse()
  for (const i of positions) {
    const result = renderedText(source.slice(0, i) + marker + source.slice(i))
    if (result.indexOf(marker) === offset && result.replace(marker, '') === text) return i
  }
  throw new Error('无法准确定位这段文字，请在源码区选择后修改样式')
}

export function previewSelectionRanges(root: HTMLElement, range: Range, source: string): SourceRange[] {
  if (range.collapsed || !root.contains(range.commonAncestorContainer)) return []
  const lines = source.split('\n')
  const offsets = [0]
  for (const line of lines) offsets.push(offsets[offsets.length - 1] + line.length + 1)
  const walker = document.createTreeWalker(root, 4 /* SHOW_TEXT */)
  const ranges: SourceRange[] = []
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (!range.intersectsNode(node) || !node.textContent?.trim()) continue
    const start = node === range.startContainer ? range.startOffset : 0
    const end = node === range.endContainer ? range.endOffset : node.textContent.length
    if (start >= end) continue
    const parent = node.parentElement!
    if (parent.closest('pre, code, .mermaid, button, svg')) throw new Error('代码和图表请在源码区编辑')
    let block = parent.closest<HTMLElement>('[data-source-line][data-source-end]')
    let matched = false
    while (block && root.contains(block)) {
      const base = offsets[Number(block.dataset.sourceLine) - 1]
      const limit = offsets[Number(block.dataset.sourceEnd)] ?? source.length
      const fragment = source.slice(base, limit)
      if (fragment.length > 12000) throw new Error('选区较大，请分段设置样式或在源码区操作')
      const text = renderedText(fragment)
      const blockText = block.textContent || ''
      const prefix = text.indexOf(blockText)
      if (blockText && prefix >= 0 && text.indexOf(blockText, prefix + 1) < 0) {
        const before = document.createRange()
        before.selectNodeContents(block)
        before.setEnd(node, start)
        const from = prefix + before.toString().length
        ranges.push({
          start: base + sourceBoundary(fragment, text, from, false),
          end: base + sourceBoundary(fragment, text, from + end - start, true),
        })
        matched = true
        break
      }
      block = block.parentElement?.closest('[data-source-line][data-source-end]') ?? null
    }
    if (!matched) throw new Error('此处没有可编辑的文字映射，请在源码区操作')
  }
  return ranges
}
