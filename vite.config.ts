import { defineConfig, normalizePath } from 'vite'
import { readFileSync } from 'node:fs'
import { cp, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'

const platform = process.env.TAURI_ENV_PLATFORM || process.platform
const petPath = resolve('public/pets/dsh-blue/pet.json')
const pet = JSON.parse(readFileSync(petPath, 'utf8'))
for (const clip of Object.values(pet.clips) as { file: string; fallback?: string }[]) {
  if (platform === 'windows' || platform === 'win32') clip.fallback = pet.poster
  else if (platform === 'darwin') { clip.file = clip.fallback!; delete clip.fallback }
}
const petFiles = new Set<string>(['pet.json', pet.poster, 'LICENSE.txt', 'NOTICE.txt'])
for (const clip of Object.values(pet.clips) as { file: string; fallback?: string }[]) {
  petFiles.add(clip.file); if (clip.fallback) petFiles.add(clip.fallback)
}
let outputDirectory: string

// Tauri 期望前端 dev server 跑在 1420 端口
export default defineConfig({
  base: './',
  clearScreen: false,
  plugins: [{
    name: 'platform-pet-assets', apply: 'build', enforce: 'pre',
    configResolved(config) { outputDirectory = resolve(config.root, config.build.outDir) },
    transform(_source, id) {
      if (normalizePath(id.split('?')[0]) === normalizePath(petPath)) return { code: JSON.stringify(pet), map: null }
    },
    async closeBundle() {
      // Keep the compiled manifest and the shipped media in sync; originals stay in public for development.
      await cp(resolve('public'), outputDirectory, { recursive: true, filter(file) {
        const name = normalizePath(relative(dirname(petPath), file))
        return name === '.' || name.startsWith('..') || petFiles.has(name)
      } })
      await writeFile(resolve(outputDirectory, 'pets/dsh-blue/pet.json'), JSON.stringify(pet, null, 2) + '\n')
    },
  }],
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
  },
  build: {
    copyPublicDir: false,
    rollupOptions: { input: { editor: 'index.html', pet: 'pet.html', notes: 'notes.html', petSettings: 'pet-settings.html' } },
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: true,
  },
})
