// 文档格式互转：办公文档导入（Word/Excel/PPT/PDF 等 → Markdown）由 Rust 端 anydoc 引擎完成，
// 这里保留 Markdown 端的能力：Base64 图片外置化 与 Markdown → Word 导出。
import MarkdownIt from 'markdown-it'
import { recoverBrokenBold } from './markdown.ts'
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ExternalHyperlink,
  BorderStyle,
  AlignmentType,
} from 'docx'

// 行内格式解析器（用于 md→docx，正确处理链接 / 嵌套加粗斜体 / 代码）
// 开启 html 以解析加粗闭合恢复产生的 <strong>/<em> 标签（见 inlineTokensToRuns 的处理）
const inlineMd = new MarkdownIt({ html: true })

async function bytesHash(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}



export type InlineMarkdownImage = {
  contentType: string
  bytes: Uint8Array
  number: number
  hash: string
}

/** 把旧 Markdown 的 Base64 图片替换成外部引用；相同图片只写一次。 */
export async function externalizeMarkdownDataImages(
  source: string,
  storeImage: (image: InlineMarkdownImage) => Promise<string>,
): Promise<{ markdown: string; imageCount: number }> {
  const pattern = /!\[([^\]]*)\]\((?:<)?data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)(?:>)?\)/gi
  const parts: string[] = []
  const storedByHash = new Map<string, string>()
  let previousEnd = 0
  let imageCount = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(source)) !== null) {
    imageCount += 1
    parts.push(source.slice(previousEnd, match.index))
    const bytes = Uint8Array.from(atob(match[3]), (character) => character.charCodeAt(0))
    const hash = await bytesHash(bytes)
    let reference = storedByHash.get(hash)
    if (!reference) {
      reference = await storeImage({ contentType: match[2], bytes, number: storedByHash.size + 1, hash })
      storedByHash.set(hash, reference)
    }
    parts.push(`![${match[1]}](${reference})`)
    previousEnd = pattern.lastIndex
  }

  if (!imageCount) return { markdown: source, imageCount: 0 }
  parts.push(source.slice(previousEnd))
  return { markdown: parts.join(''), imageCount }
}

export async function markdownToDocxBlob(markdown: string): Promise<Blob> {
  const children: any[] = []
  const lines = markdown.split(/\r?\n/)
  let i = 0

  while (i < lines.length) {
    const line = lines[i].replace(/\s+$/g, '')
    const stripped = line.trim()

    if (!stripped) {
      i += 1
      continue
    }

    // 标题：# / ## / ###
    const headingMatch = stripped.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 6)
      children.push(
        new Paragraph({
          children: parseInlineRuns(headingMatch[2]),
          heading: headingLevel(level),
        }),
      )
      i += 1
      continue
    }

    // 代码块：``` 开始
    const fenceMatch = stripped.match(/^```(.*)$/)
    if (fenceMatch) {
      const codeLines: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1 // 跳过结束的 ```
      children.push(buildCodeBlock(codeLines))
      continue
    }

    // 水平分隔线：--- / *** / ___
    if (/^(?:-|\*|_){3,}$/.test(stripped)) {
      children.push(new Paragraph({
        border: { bottom: { color: '999999', space: 1, style: BorderStyle.SINGLE, size: 6 } },
        spacing: { before: 80, after: 80 },
      }))
      i += 1
      continue
    }

    // 引用：>
    if (stripped.startsWith('> ')) {
      children.push(
        new Paragraph({
          children: parseInlineRuns(stripped.slice(2)),
          indent: { left: 360 },
        }),
      )
      i += 1
      continue
    }

    // 无序列表：- / *
    if (/^[-*]\s+/.test(stripped)) {
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const text = lines[i].replace(/^\s*[-*]\s+/, '')
        children.push(
          new Paragraph({
            children: parseInlineRuns(text),
            bullet: { level: 0 },
          }),
        )
        i += 1
      }
      continue
    }

    // 有序列表：1. / 2.
    if (/^\d+[.)]\s+/.test(stripped)) {
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        const text = lines[i].replace(/^\s*\d+[.)]\s+/, '')
        children.push(
          new Paragraph({
            children: parseInlineRuns(text),
            numbering: { reference: 'ordered-list', level: 0 },
          }),
        )
        i += 1
      }
      continue
    }

    // 表格：| ... |
    if (isMarkdownTableHeader(lines, i)) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i].trim())
        i += 1
      }
      children.push(buildDocxTable(tableLines))
      continue
    }

    // 普通段落
    children.push(new Paragraph({ children: parseInlineRuns(stripped) }))
    i += 1
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'ordered-list',
          levels: [
            { level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START },
          ],
        },
      ],
    },
    sections: [{ children }],
  })

  return Packer.toBlob(doc)
}

/** 构建等宽字体 + 灰底的代码块段落 */
function buildCodeBlock(codeLines: string[]): Paragraph {
  const runs: TextRun[] = []
  codeLines.forEach((cl, idx) => {
    if (idx > 0) runs.push(new TextRun({ text: cl, font: 'Consolas', break: 1 }))
    else runs.push(new TextRun({ text: cl, font: 'Consolas' }))
  })
  return new Paragraph({
    children: runs.length ? runs : [new TextRun({ text: '', font: 'Consolas' })],
    shading: { fill: 'F4F4F4' },
    spacing: { before: 80, after: 80 },
  })
}

// ---------- 内部辅助函数 ----------

function isMarkdownTableHeader(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length) return false
  const current = lines[index].trim()
  const separator = lines[index + 1].trim()
  return current.startsWith('|') && separator.startsWith('|') && separator.includes('---')
}

function parseMarkdownRow(line: string): string[] {
  // 去掉首尾可选的 |
  const s = line.trim().replace(/^\s*\|/, '').replace(/\|\s*$/, '')
  // 按未转义的 | 切分；同时把 \| 反转义回 |（与 Word/Excel→MD 的转义对应）
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|'
      i += 1
    } else if (ch === '|') {
      cells.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur.trim())
  return cells
}

function buildDocxTable(tableLines: string[]): Table {
  const rows = tableLines.map(parseMarkdownRow).filter((_, idx) => idx !== 1) // 丢掉分隔行
  const header = rows[0] ?? []
  const bodyRows = rows.slice(1)

  const tableRows: TableRow[] = []
  if (header.length) {
    tableRows.push(
      new TableRow({
        tableHeader: true,
        children: header.map(
          (cell) =>
            new TableCell({
              children: [new Paragraph({ children: parseInlineRuns(cell) })],
              shading: { fill: 'F5F2EE' },
            }),
        ),
      }),
    )
  }

  bodyRows.forEach((row) => {
    const cells = header.length
      ? Array.from({ length: header.length }, (_, idx) => row[idx] ?? '')
      : row
    tableRows.push(
      new TableRow({
        children: cells.map(
          (cell) => new TableCell({ children: [new Paragraph({ children: parseInlineRuns(cell) })] }),
        ),
      }),
    )
  })

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: tableRows,
  })
}

// 行内解析：用 markdown-it 的 token 流，正确处理链接 / 嵌套加粗斜体 / 代码 / 删除线
function parseInlineRuns(text: string): (TextRun | ExternalHyperlink)[] {
  // 先做加粗闭合恢复（parseInline 不经过 core 规则），保证「**数据库：**MySQL」也能导出为加粗
  const recovered = recoverBrokenBold(text)
  if (!recovered.includes('<strong') && !recovered.includes('<em')) {
    return parseInlineRunsPlain(recovered, {})
  }
  // 恢复产生的 <strong>/<em> 会被 markdown-it 拆成独立标签 token，
  // 这里按标签切段分别解析，再把样式叠加到各段上
  const runs: (TextRun | ExternalHyperlink)[] = []
  const stack: string[] = []
  let previous = 0
  const pattern = /<(\/?)(strong|em)>/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(recovered)) !== null) {
    const segment = recovered.slice(previous, match.index)
    previous = pattern.lastIndex
    if (segment) runs.push(...parseInlineRunsPlain(segment, styleFromTagStack(stack)))
    if (match[1]) {
      const index = stack.lastIndexOf(match[2])
      if (index !== -1) stack.splice(index, 1)
    } else {
      stack.push(match[2])
    }
  }
  const tail = recovered.slice(previous)
  if (tail) runs.push(...parseInlineRunsPlain(tail, styleFromTagStack(stack)))
  return runs.length ? runs : [new TextRun(text)]
}

function styleFromTagStack(stack: string[]): Record<string, boolean> {
  const style: Record<string, boolean> = {}
  if (stack.includes('strong')) style.bold = true
  if (stack.includes('em')) style.italics = true
  return style
}

function parseInlineRunsPlain(text: string, baseStyle: Record<string, boolean>): (TextRun | ExternalHyperlink)[] {
  const tokens = inlineMd.parseInline(text, {})
  const children = tokens[0]?.children
  if (!children || !children.length) return [new TextRun({ text, ...baseStyle })]
  const runs: (TextRun | ExternalHyperlink)[] = []
  inlineTokensToRuns(children, baseStyle, runs)
  return runs.length ? runs : [new TextRun({ text, ...baseStyle })]
}

/** 递归把 markdown-it 行内 token 转成 docx TextRun / 超链接 */
function inlineTokensToRuns(tokens: any[], style: Record<string, any>, runs: (TextRun | ExternalHyperlink)[]): void {
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    switch (t.type) {
      case 'text':
      case 'text_special':
        runs.push(new TextRun({ text: t.content, ...style }))
        break
      case 'code_inline':
        runs.push(new TextRun({ text: t.content, font: 'Consolas', ...style }))
        break
      case 'softbreak':
      case 'hardbreak':
        runs.push(new TextRun({ text: '', break: 1, ...style }))
        break
      case 'image': {
        const alt = t.content || ''
        runs.push(new TextRun({ text: alt ? `[图片：${alt}]` : '[图片]', italics: true, color: '888888', ...style }))
        break
      }
      case 'strong_open':
      case 'em_open':
      case 's_open': {
        const next = { ...style }
        if (t.type === 'strong_open') next.bold = true
        else if (t.type === 'em_open') next.italics = true
        else next.strike = true
        const closeType = t.type.replace('_open', '_close')
        const inner = sliceUntilClose(tokens, i, t.type, closeType)
        inlineTokensToRuns(inner, next, runs)
        i += inner.length + 2 // 跳过内部 token + open/close
        continue
      }
      case 'html_inline': {
        // 加粗闭合恢复产生的 <strong>/<em>：还原为对应样式，而不是把标签当文字
        const strongMatch = /^<strong>([\s\S]*)<\/strong>$/.exec(t.content)
        if (strongMatch) {
          const inner = inlineMd.parseInline(strongMatch[1], {})
          const children = inner[0]?.children
          if (children && children.length) inlineTokensToRuns(children, { ...style, bold: true }, runs)
          break
        }
        const emMatch = /^<em>([\s\S]*)<\/em>$/.exec(t.content)
        if (emMatch) {
          const inner = inlineMd.parseInline(emMatch[1], {})
          const children = inner[0]?.children
          if (children && children.length) inlineTokensToRuns(children, { ...style, italics: true }, runs)
          break
        }
        if (t.content) runs.push(new TextRun({ text: t.content, ...style }))
        break
      }
      case 'link_open': {
        const href = (t.attrGet && t.attrGet('href')) || ''
        const inner = sliceUntilClose(tokens, i, 'link_open', 'link_close')
        const subRuns: (TextRun | ExternalHyperlink)[] = []
        inlineTokensToRuns(inner, { ...style, color: '1155CC' }, subRuns)
        runs.push(new ExternalHyperlink({ link: href, children: subRuns }))
        i += inner.length + 2
        continue
      }
      default:
        if (t.content) runs.push(new TextRun({ text: t.content, ...style }))
    }
    i += 1
  }
}

/** 取出 open/close 之间的 token（含嵌套），返回内部 token 数组 */
function sliceUntilClose(tokens: any[], openIdx: number, openType: string, closeType: string): any[] {
  const inner: any[] = []
  let depth = 1
  let j = openIdx + 1
  while (j < tokens.length && depth > 0) {
    const tj = tokens[j]
    if (tj.type === openType) depth++
    else if (tj.type === closeType) {
      depth--
      if (depth === 0) break
    }
    inner.push(tj)
    j++
  }
  return inner
}

function headingLevel(level: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  const map = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
  ]
  return map[level - 1] ?? HeadingLevel.HEADING_6
}
