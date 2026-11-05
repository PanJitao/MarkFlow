// Prepare the licensed DSH character for WebView2 and WKWebView, without running the reference project.
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const reference = resolve(process.argv[2] || 'output/dsh-pet-reference')
const destination = resolve('public/pets/dsh-blue')
const selected = {
  idle: '待机呼吸休闲', look: '东张西望', wave: '点击回应-元气挥手',
  happy: '点击回应-开心跃动', shy: '点击回应-害羞惊讶', tickle: '点击回应-挠痒咯咯笑',
  drag: '被鼠标拖拽悬空反馈', stretch: '超大伸懒腰', cube: '原地专心玩魔方', hum: '悠闲哼歌',
  remind: '原地敲击桌面互动', celebrate: '工作状态-雀跃庆祝',
  sleepStart: '睡觉-开始', sleep: '睡觉-循环', wake: '睡觉-起来',
}
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(result.error?.message || result.stderr)
  return result.stdout.trim()
}
await mkdir(destination, { recursive: true })
const manifest = {
  source: 'https://github.com/PC2005-cloud/dsh-pet',
  commit: run('git', ['rev-parse', 'HEAD'], reference),
  license: '形象 CC BY-NC-SA 4.0；动画素材仅非商业使用', copyright: 'Copyright (c) 2026 PC2005-cloud',
  clips: {},
}
for (const [id, name] of Object.entries(selected)) {
  const input = join(reference, 'dsh-pet/assets/webm', `${name}.webm`)
  const metadata = JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height:stream_tags=alpha_mode:format=duration', '-of', 'json', input]))
  if (metadata.streams[0]?.tags?.ALPHA_MODE !== '1') throw new Error(`${name}: missing alpha channel`)
  await copyFile(input, join(destination, `${id}.webm`))
  // macOS WKWebView may decode VP9 while discarding alpha. Animated WebP keeps transparency.
  run('ffmpeg', ['-v', 'error', '-c:v', 'libvpx-vp9', '-i', input, '-an', '-c:v', 'libwebp_anim', '-q:v', '82', '-compression_level', '4', '-loop', '1', '-y', join(destination, `${id}.webp`)])
  manifest.clips[id] = {
    name, durationMs: Math.round(Number(metadata.format.duration) * 1000),
    width: metadata.streams[0].width, height: metadata.streams[0].height,
    sourceSha256: createHash('sha256').update(await readFile(input)).digest('hex'),
  }
  console.log(`Prepared ${id} (${manifest.clips[id].durationMs} ms)`)
}
run('ffmpeg', ['-v', 'error', '-c:v', 'libvpx-vp9', '-i', join(destination, 'idle.webm'), '-frames:v', '1', '-y', join(destination, 'poster.png')])
await copyFile(join(reference, 'LICENSE'), join(destination, 'LICENSE.txt'))
await writeFile(join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
await writeFile(join(destination, 'NOTICE.txt'), `Blue Fish character animation assets from dsh-pet.\n${manifest.source}\nCommit: ${manifest.commit}\n${manifest.copyright}\nThe upstream code is MIT licensed (the original LICENSE.txt is retained).\nAccording to the upstream README, animation, prompt and source-video materials are for non-commercial use; the character is under CC BY-NC-SA 4.0.\nUpstream license and attribution: ${manifest.source}#许可\nCharacter prototype Mingyue: 上善无形 https://space.bilibili.com/4456176\nDeepSeek adaptation design: ZipZipPipe https://space.bilibili.com/4168597\nCharacter license: https://creativecommons.org/licenses/by-nc-sa/4.0/\nOriginal VP9-alpha WebM files are unchanged; WebP and PNG variants are format conversions made for MarkFlow.\n`)
await import('./create-builtin-pet.mjs')
