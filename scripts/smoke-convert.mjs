// 转换逻辑冒烟测试：Markdown 端能力（md→HTML、md→docx、Base64 图片外置化）。
// 办公文档导入（Word/Excel/PPT/PDF → Markdown）已迁移到 Rust 端 anydoc 引擎，
// 由 `cargo test`（src-tauri）覆盖，这里不再重复。
import './jsdom-env.mjs'
import { markdownToDocxBlob } from '../src/lib/convert.ts'
import { externalizeMarkdownDataImages } from '../src/lib/externalize-image.ts'
import { buildHtmlDocument, markdownToHtml } from '../src/lib/markdown.ts'
import zlib from 'node:zlib'

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.error('  ✗', name) }
}

/** 从 zip 中按名字取出解压后的内容（支持 stored 与 deflate） */
function zipEntryBytes(buffer, name) {
  let eocd = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('未找到 zip 目录')
  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('损坏的 zip 目录')
    const method = buffer.readUInt16LE(offset + 10)
    const compSize = buffer.readUInt32LE(offset + 20)
    const nameLen = buffer.readUInt16LE(offset + 28)
    const extraLen = buffer.readUInt16LE(offset + 30)
    const commentLen = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const entryName = buffer.toString('utf8', offset + 46, offset + 46 + nameLen)
    if (entryName === name) {
      const localNameLen = buffer.readUInt16LE(localOffset + 26)
      const localExtraLen = buffer.readUInt16LE(localOffset + 28)
      const dataStart = localOffset + 30 + localNameLen + localExtraLen
      const comp = buffer.subarray(dataStart, dataStart + compSize)
      if (method === 0) return comp
      if (method === 8) return zlib.inflateRawSync(comp)
      throw new Error('不支持的压缩方式 ' + method)
    }
    offset += 46 + nameLen + extraLen + commentLen
  }
  return null
}

// 1) Markdown → HTML 文档
console.log('测试：Markdown → HTML')
const html = buildHtmlDocument('# 标题\n\n正文 **加粗**。', '测试')
check('包含 <h1>', html.includes('<h1>标题</h1>'))
check('lang=zh-CN', html.includes('<html lang="zh-CN">'))
check('加粗渲染', html.includes('<strong>加粗</strong>'))

const xssHtml = buildHtmlDocument('<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>', 'xss')
check('导出过滤 script 标签', !xssHtml.includes('<script'))
check('导出过滤 onerror 属性', !xssHtml.includes('onerror'))

// 2) Markdown → docx：结构与内容
console.log('测试：Markdown → Word（docx）')
const md = [
  '# 文档标题', '',
  '含 [示例链接](https://example.com)，以及 **加粗**、***粗斜体***、`行内代码`。', '',
  '- 第一项', '- 第二项', '',
  '> 这是一段引用', '',
  '| 列名 | 数值 |', '| --- | --- |', '| 苹果 | 5 |', '',
].join('\n')
const blob = await markdownToDocxBlob(md)
const buffer = Buffer.from(await blob.arrayBuffer())
check('生成 docx Blob (非空)', buffer.byteLength > 0)
const documentXml = zipEntryBytes(buffer, 'word/document.xml')
check('包含 word/document.xml', documentXml !== null)
const xml = documentXml.toString('utf8')
check('标题保留', xml.includes('文档标题'))
check('列表项保留', xml.includes('第一项') && xml.includes('第二项'))
check('表格内容保留', xml.includes('苹果') && xml.includes('<w:tbl>'))
const relsXml = zipEntryBytes(buffer, 'word/_rels/document.xml.rels').toString('utf8')
check('超链接保留（rels 目标）', relsXml.includes('https://example.com'))
check('嵌套粗斜体保留', xml.includes('粗斜体'))
check('行内代码保留', xml.includes('行内代码'))
check('引用保留', xml.includes('这是一段引用'))

// 3) md→docx：表格内转义竖线 \| 不能错列
console.log('测试：md→Word 表格转义竖线（\\| 不错列）')
const pipeMd = ['| 名字 | 值 |', '| --- | --- |', '| a\\|b | c |'].join('\n')
const pipeBlob = await markdownToDocxBlob(pipeMd)
const pipeXml = zipEntryBytes(Buffer.from(await pipeBlob.arrayBuffer()), 'word/document.xml').toString('utf8')
check('转义竖线还原为 |', pipeXml.includes('a|b'))
check('同行另一列 c 未丢失', pipeXml.includes('>c<'))
check('表格单元格数量正确', (pipeXml.match(/<w:tc>/g) || []).length >= 4)

// 3b) 加粗闭合恢复：**数据库：**MySQL 这类模式要渲染成加粗而不是保留 **
console.log('测试：加粗闭合恢复（标点结尾 + 紧跟文字）')
const recovered = markdownToHtml('- ** 编程与数据：** Java、Python。' + '\n' + '- **数据库与大数据：**MySQL、Access、Hadoop。' + '\n' + '- **企业系统：**CRM功能开发。')
check('恢复为加粗（第 1 项）', recovered.includes('<strong> 编程与数据：</strong>'))
check('恢复为加粗（第 2 项）', recovered.includes('<strong>数据库与大数据：</strong>'))
check('恢复为加粗（第 3 项）', recovered.includes('<strong>企业系统：</strong>'))
check('列表标记保留', (recovered.match(/<li>/g) || []).length === 3)
check('正常加粗不受影响', markdownToHtml('**正常加粗**文字').includes('<strong>正常加粗</strong>'))
check('代码段内不误改', markdownToHtml('看 `**foo：**bar` 代码').includes('<code>**foo：**bar</code>'))

// 3c) 加粗闭合恢复后的 md→docx 导出：Word 里应是加粗而不是字面星号
console.log('测试：恢复后的加粗在 md→Word 导出中保持加粗')
const boldMd = '**数据库与大数据：**MySQL、Access、Hadoop。'
const boldBlob = await markdownToDocxBlob(boldMd)
const boldXml = zipEntryBytes(Buffer.from(await boldBlob.arrayBuffer()), 'word/document.xml').toString('utf8')
check('Word 导出包含加粗属性 <w:b/>', boldXml.includes('<w:b/>') || boldXml.includes('<w:b '))
check('Word 导出不含字面星号', !boldXml.includes('**') && boldXml.includes('数据库与大数据：'))

// 4) 旧版 Base64 图片 Markdown 外置化
console.log('测试：旧版 Base64 图片 Markdown 外置化')
const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X+3NAAAAAElFTkSuQmCC'
const inlineImageMd = `![示例](data:image/png;base64,${tinyPng})

![重复](data:image/png;base64,${tinyPng})`
let storedInlineImages = 0
const externalized = await externalizeMarkdownDataImages(inlineImageMd, async (image) => {
  storedInlineImages += 1
  return `sample.assets/image-${image.number}-${image.hash.slice(0, 8)}.png`
})
check('Base64 图片引用已移除', !externalized.markdown.includes('data:image/'))
check('两个图片引用均保留', externalized.imageCount === 2)
check('重复图片只保存一次', storedInlineImages === 1)
check('两个引用复用同一路径', new Set([...externalized.markdown.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1])).size === 1)
// 5) 超大内嵌图片：超过上限时跳过外置、保留原样并计数
console.log('测试：超大内嵌图片跳过外置')
const oversizedMd = '![big](data:image/png;base64,' + 'A'.repeat(2560) + ')'
const oversized = await externalizeMarkdownDataImages(oversizedMd, async () => 'never.png', 512)
check('超大图片跳过外置', oversized.imageCount === 0 && oversized.skippedImages === 1)
check('跳过时保留原 data URI', oversized.markdown.includes('data:image/png;base64'))
check('跳过时不调用存储', storedInlineImages === 1)

console.log(`
结果：${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
