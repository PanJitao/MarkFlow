// 冒烟脚本的 Node 环境没有 DOM，给 DOMPurify 提供 jsdom window。
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
globalThis.window = dom.window
globalThis.document = dom.window.document
