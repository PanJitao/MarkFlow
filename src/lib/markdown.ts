// Markdown 渲染：把 Markdown 源码转成可安全插入页面的 HTML
import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'

const renderer = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: true,
})

// markdown-it 默认拒绝 file:，但本地 Markdown 图片需要保留该协议，后续由桌面端读取为 Blob URL。
const defaultValidateLink = renderer.validateLink
renderer.validateLink = (url) => /^file:/i.test(url) || defaultValidateLink(url)

const defaultImageRenderer = renderer.renderer.rules.image
renderer.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index]
  const source = token.attrGet('src') || ''
  token.attrSet('loading', 'lazy')
  token.attrSet('decoding', 'async')
  if (env?.lazyImages && !/^(?:https?:)?\/\//i.test(source)) {
    token.attrSet('data-markflow-src', source)
    token.attrSet('class', `${token.attrGet('class') || ''} preview-lazy-image is-pending`.trim())
    token.attrSet('src', '')
  }
  return defaultImageRenderer
    ? defaultImageRenderer(tokens, index, options, env, self)
    : self.renderToken(tokens, index, options)
}

// 仅放行图片的本地 file: 地址；其他链接仍遵循 DOMPurify 默认协议白名单。
if (typeof DOMPurify.addHook === 'function') {
  DOMPurify.addHook('uponSanitizeAttribute', (node, hookEvent) => {
    if (node.nodeName === 'IMG'
      && hookEvent.attrName === 'src'
      && /^file:/i.test(hookEvent.attrValue)) {
      hookEvent.forceKeepAttr = true
    }
  })
}

renderer.core.ruler.push('preserve-extra-blank-lines', (state) => {
  const lines = state.src.split(/\r?\n/)
  const tokens = []
  let previousBlockEnd: number | null = null

  state.tokens.forEach((token) => {
    const isTopLevelBlockStart = token.level === 0 && token.map && token.nesting !== -1
    if (isTopLevelBlockStart) {
      let blankRun = 0
      for (let line = previousBlockEnd ?? token.map[0]; line < token.map[0]; line += 1) {
        if (!/^\s*$/.test(lines[line] || '')) {
          blankRun = 0
          continue
        }
        blankRun += 1
        if (blankRun === 1) continue

        const spacer = new state.Token('html_block', '', 0)
        spacer.block = true
        spacer.content = `<div class="markdown-blank-line" data-source-line="${line + 1}" aria-hidden="true"></div>\n`
        tokens.push(spacer)
      }
      previousBlockEnd = token.map[1]
    }
    tokens.push(token)
  })

  state.tokens = tokens
})

renderer.core.ruler.push('source-line-attributes', (state) => {
  if (!state.env?.sourceMap) return
  state.tokens.forEach((token) => {
    if (!token.map || token.type === 'inline' || token.nesting === -1) return
    token.attrSet('data-source-line', String(token.map[0] + 1))
  })
})

/** 把 Markdown 渲染成预览用的 HTML（经过消毒，防 XSS） */
export function renderMarkdown(markdown: string): string {
  return DOMPurify.sanitize(renderer.render(markdown, { sourceMap: true, lazyImages: true }), {
    ADD_ATTR: ['style', 'target', 'data-source-line', 'data-markflow-src', 'loading', 'decoding'],
  })
}

/** 把 Markdown 渲染成纯 HTML 片段（不消毒，仅用于导出受信任内容） */
export function markdownToHtml(markdown: string): string {
  return renderer.render(markdown)
}

/** 生成一份完整的、可直接打开的 HTML 文档 */
export function buildHtmlDocument(markdown: string, title: string): string {
  const body = markdownToHtml(markdown)
  const safeTitle = escapeHtml(title)
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${safeTitle}</title>`,
    '  <style>',
    "    body { font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif; margin: 40px auto; max-width: 920px; line-height: 1.7; color: #1c1917; padding: 0 24px; }",
    '    h1, h2, h3 { color: #1f1a12; }',
    '    table { border-collapse: collapse; width: 100%; margin: 24px 0; }',
    '    th, td { border: 1px solid #d6d3d1; padding: 10px 12px; text-align: left; }',
    '    th { background: #f5f2ee; }',
    '    pre { background: #111827; color: #f9fafb; padding: 16px; overflow: auto; border-radius: 8px; }',
    "    code { font-family: 'Cascadia Code', Consolas, monospace; }",
    '    .markdown-blank-line { height: 1.7em; }',
    '    blockquote { border-left: 4px solid #c96f2d; margin: 0; padding: 4px 16px; color: #6a5c49; background: #faf6ef; }',
    '    img { max-width: 100%; }',
    '  </style>',
    '</head>',
    '<body>',
    body,
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
