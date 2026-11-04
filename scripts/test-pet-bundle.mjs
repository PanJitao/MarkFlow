// Verify actual build output, not just the source manifest.
import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'

const directory = resolve(process.argv[2] || 'dist')
const platform = process.argv[3] || process.env.TAURI_ENV_PLATFORM || process.platform
const windows = ['windows', 'win32'].includes(platform), mac = platform === 'darwin'
const source = JSON.parse(await readFile('public/pets/dsh-blue/pet.json', 'utf8'))
const petDirectory = join(directory, 'pets/dsh-blue')
const pet = JSON.parse(await readFile(join(petDirectory, 'pet.json'), 'utf8'))
assert.deepEqual(pet.actions, source.actions, 'all actions remain available')
assert.deepEqual(pet.canvas, source.canvas)
assert.deepEqual(pet.hitBox, source.hitBox)
assert.equal(Object.keys(pet.clips).length, 15)
const expected = new Set(['pet.json', pet.poster, 'LICENSE.txt', 'NOTICE.txt'])
for (const [id, clip] of Object.entries(pet.clips)) {
  assert.equal(clip.durationMs, source.clips[id].durationMs)
  if (windows) { assert.equal(clip.file, source.clips[id].file); assert.equal(clip.fallback, pet.poster) }
  if (mac) { assert.equal(clip.file, source.clips[id].fallback); assert.equal(clip.fallback, undefined) }
  expected.add(clip.file); if (clip.fallback) expected.add(clip.fallback)
}
assert.deepEqual(new Set(await readdir(petDirectory)), expected, 'no missing media or unused files in pet bundle')
let total = 0
for (const file of expected) {
  total += (await stat(join(petDirectory, file))).size
  if (file !== 'pet.json') {
    const digest = bytes => createHash('sha256').update(bytes).digest('hex')
    assert.equal(digest(await readFile(join(petDirectory, file))), digest(await readFile(join('public/pets/dsh-blue', file))), `${file}: original quality and notices preserved`)
  }
}
assert.ok(total < (windows ? 7_000_000 : mac ? 61_000_000 : 67_000_000), 'builtin media exceeds its package budget')
for (const file of ['pet-api/schema.json', 'pet-api/protocol.json', 'pet.html', 'pet-settings.html', 'notes.html', 'index.html']) assert.ok((await stat(join(directory, file))).size > 0)
console.log(`Pet bundle (${platform}): 15 unchanged animations, complete references, licenses and MCP assets; ${(total / 1e6).toFixed(2)} MB`)
