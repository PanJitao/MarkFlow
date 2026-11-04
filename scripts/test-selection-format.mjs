import './jsdom-env.mjs'
import assert from 'node:assert/strict'
import { renderMarkdown, markdownToHtml } from '../src/lib/markdown.ts'
import { previewSelectionRanges, formatSource } from '../src/lib/selection-format.ts'

const cases = [
  ['重复 **重复** 重复', 'strong', 0, 2, '**<u>重复</u>**'],
  ['# 中文标题', 'h1', 1, 3, '# 中<u>文标</u>题'],
  ['这是 [链接文字](https://example.com) 后文', 'a', 0, 2, '[<u>链接</u>文字](https://example.com)'],
  ['- 列表内容', 'li', 0, 2, '- <u>列表</u>内容'],
  ['甲 &amp; 乙', 'p', 2, 3, '<u>&amp;</u>'],
  ['**粗体 *斜体* 后文**', 'em', 0, 2, '*<u>斜体</u>*'],
  ['| 项目 | 数值 |\n| --- | --- |\n| 中文 | 12 |', 'td', 0, 2, '| <u>中文</u> | 12 |'],
]
for (const [source, selector, start, end, expected] of cases) {
  const root = document.createElement('div')
  root.innerHTML = renderMarkdown(source)
  const walker = document.createTreeWalker(root.querySelector(selector), 4)
  const text = walker.nextNode()
  const range = document.createRange()
  range.setStart(text, start); range.setEnd(text, end)
  const changed = formatSource(source, previewSelectionRanges(root, range, source), 'underline')
  assert.ok(changed.includes(expected), `${source} => ${changed}`)
  const clean = (value) => { const el = document.createElement('div'); el.innerHTML = markdownToHtml(value); return el.textContent }
  assert.equal(clean(changed), clean(source), 'formatting must never change visible text')
}
const source = '前文 **粗体** 后文\n\n第二段'
const root = document.createElement('div')
root.innerHTML = renderMarkdown(source)
const range = document.createRange()
range.setStart(root.querySelector('p').firstChild, 1)
range.setEnd(root.querySelectorAll('p')[1].firstChild, 2)
const changed = formatSource(source, previewSelectionRanges(root, range, source), 'color', '#2563eb')
assert.ok(changed.includes('**<span style="color: #2563eb">粗体</span>**'))
assert.ok(changed.includes('\n\n<span style="color: #2563eb">第二</span>段'))
console.log(`✓ ${cases.length + 1} preview selections preserve text, links, lists, tables and Markdown structure`)
