// 文档格式互转：办公文档导入（Word/Excel/PPT/PDF 等 → Markdown）由 Rust 端 anydoc 引擎完成，
// 这里保留 Markdown 端的能力：Markdown → Word 导出（Base64 图片外置化见 externalize-image.ts）。
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
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


export async function markdownToDocxBlob(markdown: string): Promise<Blob> {
  const children: any[] = []
  const lines = markdown.split(/\r?\n/)
  let i = 0
  // 每个独立的有序列表块使用不同的 numbering instance，保证编号从 1 重新开始
  let orderedListInstance = 0

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
      orderedListInstance += 1
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        const text = lines[i].replace(/^\s*\d+[.)]\s+/, '')
        children.push(
          new Paragraph({
            children: parseInlineRuns(text),
            numbering: { reference: 'ordered-list', level: 0, instance: orderedListInstance },
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
  const root = document.createElement('div')
  root.innerHTML = DOMPurify.sanitize(inlineMd.renderInline(recoverBrokenBold(text)))
  return domInlineRuns(root, {})
}

function wordColor(value: string): string | undefined {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.slice(1)
  const rgb = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/.exec(value)
  if (rgb) return rgb.slice(1).map((part) => Number(part).toString(16).padStart(2, '0')).join('')
  return undefined
}

function domInlineRuns(root: Node, inherited: Record<string, any>): (TextRun | ExternalHyperlink)[] {
  const runs: (TextRun | ExternalHyperlink)[] = []
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === 3) {
      runs.push(new TextRun({ text: child.textContent || '', ...inherited }))
      continue
    }
    if (child.nodeType !== 1) continue
    const element = child as HTMLElement
    const tag = element.tagName.toLowerCase()
    const style = { ...inherited }
    if (tag === 'strong' || tag === 'b') style.bold = true
    if (tag === 'em' || tag === 'i') style.italics = true
    if (tag === 'u') style.underline = {}
    if (tag === 's' || tag === 'del') style.strike = true
    if (tag === 'code') style.font = 'Consolas'
    if (tag === 'sup') style.superScript = true
    if (tag === 'sub') style.subScript = true
    const css = element.style
    const color = wordColor(css.color)
    const fill = wordColor(css.backgroundColor)
    if (color) style.color = color
    if (fill) style.shading = { fill }
    if (/^\d+(?:\.\d+)?px$/.test(css.fontSize)) style.size = Math.round(parseFloat(css.fontSize) * 1.5)
    if (css.fontWeight === 'bold' || Number(css.fontWeight) >= 600) style.bold = true
    if (css.fontStyle === 'italic') style.italics = true
    if (css.textDecoration.includes('underline')) style.underline = {}
    if (css.textDecoration.includes('line-through')) style.strike = true
    if (tag === 'br') runs.push(new TextRun({ text: '', break: 1, ...style }))
    else if (tag === 'img') runs.push(new TextRun({ text: `[图片：${element.getAttribute('alt') || '图片'}]`, ...style }))
    else if (tag === 'a') runs.push(new ExternalHyperlink({
      link: element.getAttribute('href') || '',
      children: domInlineRuns(element, { color: '1155CC', ...style }),
    }))
    else runs.push(...domInlineRuns(element, style))
  }
  return runs
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
