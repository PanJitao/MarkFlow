// 把 Markdown 内的 Base64 图片外置为文件引用（不依赖 docx 等重型导出库）。

async function bytesHash(bytes: Uint8Array<ArrayBuffer>) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

export type InlineMarkdownImage = {
  contentType: string
  bytes: Uint8Array<ArrayBuffer>
  number: number
  hash: string
}

export const MAX_DATA_IMAGE_BYTES = 20 * 1024 * 1024

/** 把旧 Markdown 的 Base64 图片替换成外部引用；相同图片只写一次。 */
export async function externalizeMarkdownDataImages(
  source: string,
  storeImage: (image: InlineMarkdownImage) => Promise<string>,
  maxBytes = MAX_DATA_IMAGE_BYTES,
): Promise<{ markdown: string; imageCount: number; skippedImages: number }> {
  const pattern = /!\[([^\]]*)\]\((?:<)?data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)(?:>)?\)/gi
  const parts: string[] = []
  const storedByHash = new Map<string, string>()
  let previousEnd = 0
  let imageCount = 0
  let skippedImages = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(source)) !== null) {
    const estimatedBytes = Math.floor((match[3].length * 3) / 4)
    if (estimatedBytes > maxBytes) {
      skippedImages += 1
      parts.push(source.slice(match.index, pattern.lastIndex))
      previousEnd = pattern.lastIndex
      continue
    }
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

  if (!imageCount && !skippedImages) return { markdown: source, imageCount: 0, skippedImages: 0 }
  parts.push(source.slice(previousEnd))
  return { markdown: parts.join(''), imageCount, skippedImages }
}
