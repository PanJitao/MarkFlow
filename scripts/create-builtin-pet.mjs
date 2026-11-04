import { readFile, writeFile } from 'node:fs/promises'
const source = JSON.parse(await readFile('public/pets/dsh-blue/manifest.json', 'utf8'))
const pet = {
  version: 1, id: 'dsh-blue', name: '蓝发小伙伴', description: 'dsh-pet 原版透明角色与日常动作', author: 'PC2005-cloud', license: 'MIT',
  canvas: { width: 640, height: 360 }, hitBox: { x: .3125, y: .139, width: .375, height: .792 }, poster: 'poster.png',
  clips: Object.fromEntries(Object.entries(source.clips).map(([id, clip]) => [id, { file: `${id}.webm`, fallback: `${id}.webp`, durationMs: clip.durationMs }])),
  actions: { idle: ['idle', 'idle', 'idle', 'look', 'stretch', 'cube', 'hum'], react: ['happy', 'shy', 'tickle', 'wave'], wave: ['wave'], drag: ['drag'], remind: ['remind'], celebrate: ['celebrate'], stretch: ['stretch'], play: ['cube'], sleepStart: ['sleepStart'], sleep: ['sleep'], wake: ['wake'] },
  phrases: { greeting: '我来啦。点我互动，双击或点下方便签记事。', tap: ['我在呢。今天想先做哪件事？', '点下面的便签，就能把事情记下来。', '一件一件来，我陪着你。'] },
}
await writeFile('public/pets/dsh-blue/pet.json', JSON.stringify(pet, null, 2) + '\n')
