import { pickOpenFolder, scanWallpapers, wallpaperPreviewUrl, getWallpaperProject, type WallpaperEntry } from './io'
import type { StoredBackgroundAsset } from './appearance'
import type { WallpaperValues } from './wallpaper-runtime'
import { propertyDefinitions, propertyLabel, propertyVisible, wallpaperValues, savedWallpaperValues, saveWallpaperValues, weColorToHex, hexToWeColor, type WallpaperProperty } from './wallpaper-properties'

export function setupWallpaperLibrary(apply: (asset: StoredBackgroundAsset) => Promise<void>, updateProperties: (path: string, values: WallpaperValues) => void = () => {}, current: () => StoredBackgroundAsset | null = () => null) {
  const dialog = document.querySelector<HTMLDialogElement>('#wallpaper-dialog')!
  const grid = document.querySelector<HTMLElement>('#wallpaper-grid')!
  const status = document.querySelector<HTMLElement>('#wallpaper-status')!
  const search = document.querySelector<HTMLInputElement>('#wallpaper-search')!
  const filter = document.querySelector<HTMLSelectElement>('#wallpaper-filter')!
  const location = document.querySelector<HTMLElement>('#wallpaper-location')!
  const propertyList = document.querySelector<HTMLElement>('#wallpaper-properties')!
  const propertySearch = document.querySelector<HTMLInputElement>('#wallpaper-property-search')!
  const propertyTitle = document.querySelector<HTMLElement>('#wallpaper-property-title')!
  const propertyNote = document.querySelector<HTMLElement>('#wallpaper-property-note')!
  const reset = document.querySelector<HTMLButtonElement>('#wallpaper-properties-reset')!
  const scanButtons = [...dialog.querySelectorAll<HTMLButtonElement>('[data-wallpaper-scan]')]
  let items: WallpaperEntry[] = []
  let root: string | null = localStorage.getItem('markflow:wallpaperRoot')
  let selected: WallpaperEntry | null = null
  let properties: WallpaperProperty[] = []
  let values: WallpaperValues = {}
  let busy = false
  let selectedApplied = false
  const kindLabel = (kind: string) => ({ image: '图片', video: '视频', scene: '场景', web: '网页', application: '应用' })[kind] || '其他'
  const propertyPath = () => selected?.projectPath || selected?.path || ''
  const editable = () => Boolean(selectedApplied && selected && selected.path === current()?.path && selected.available !== false && ['scene', 'web'].includes(selected.kind))

  function updateVisibility() {
    const query = propertySearch.value.trim().toLocaleLowerCase()
    propertyList.querySelectorAll<HTMLElement>('[data-property-key]').forEach(row => {
      const prop = properties.find(p => p.key === row.dataset.propertyKey)!
      row.hidden = !propertyVisible(prop.condition, values) || Boolean(query && !`${prop.text} ${prop.key}`.toLocaleLowerCase().includes(query))
    })
  }
  function commit(key: string, value: string | number | boolean) {
    values[key] = value; updateProperties(propertyPath(), { [key]: value })
    try { saveWallpaperValues(propertyPath(), values) } catch { status.textContent = '参数本次已更新，但本地存储已满，无法保存。' }
    updateVisibility()
  }
  function renderProperties() {
    propertyList.replaceChildren(); reset.disabled = busy || !editable() || !properties.length
    propertySearch.disabled = busy || !properties.length
    for (const prop of properties) {
      const row = document.createElement('div'); row.className = 'wallpaper-property-row'; row.dataset.propertyKey = prop.key
      const label = document.createElement('label'); label.textContent = prop.text; label.title = prop.key; row.append(label)
      if (['group', 'text'].includes(prop.type)) { row.classList.add('wallpaper-property-heading'); propertyList.append(row); continue }
      const value = values[prop.key] ?? prop.value; const id = `wallpaper-prop-${properties.indexOf(prop)}`; label.htmlFor = id
      let control: HTMLInputElement | HTMLSelectElement
      if (prop.type === 'combo' && prop.options?.length) {
        control = document.createElement('select')
        prop.options.forEach((option, index) => {
          const el = document.createElement('option'); el.value = String(index); el.textContent = propertyLabel(option.label)
          el.selected = option.value === value; control.append(el)
        })
        control.addEventListener('change', () => commit(prop.key, prop.options![Number(control.value)].value))
      } else {
        const input = document.createElement('input'); control = input
        if (prop.type === 'bool') {
          input.type = 'checkbox'; input.checked = Boolean(value); input.addEventListener('change', () => commit(prop.key, input.checked))
        } else if (prop.type === 'color') {
          input.type = 'color'; input.value = weColorToHex(value)
          const hex = document.createElement('input'); hex.type = 'text'; hex.value = input.value; hex.maxLength = 7
          hex.className = 'wallpaper-color-hex'; hex.setAttribute('aria-label', `${prop.text} HEX`); hex.disabled = busy || !editable()
          input.addEventListener('input', () => { hex.value = input.value; commit(prop.key, hexToWeColor(input.value)) })
          hex.addEventListener('change', () => {
            if (!/^#[\da-f]{6}$/i.test(hex.value)) { hex.value = input.value; return }
            input.value = hex.value; commit(prop.key, hexToWeColor(input.value))
          })
          row.append(hex)
        } else if (prop.type === 'slider') {
          input.type = 'number'; input.min = String(prop.min ?? 0); input.max = String(prop.max ?? 100)
          input.step = String(prop.step && prop.step > 0 ? prop.step : prop.precision ? 10 ** -Math.min(6, prop.precision) : 1); input.value = String(value)
          const slider = document.createElement('input'); slider.type = 'range'
          slider.min = input.min; slider.max = input.max; slider.step = input.step; slider.value = input.value
          slider.setAttribute('aria-label', prop.text); slider.disabled = busy || !editable()
          const change = (source: HTMLInputElement, target: HTMLInputElement) => {
            if (source.value === '' || !Number.isFinite(Number(source.value))) return
            const n = Math.max(Number(input.min), Math.min(Number(input.max), Number(source.value)))
            source.value = String(n); target.value = String(n); commit(prop.key, n)
          }
          slider.addEventListener('input', () => change(slider, input)); input.addEventListener('change', () => change(input, slider)); row.append(slider)
        } else {
          input.type = 'text'; input.value = String(value); input.addEventListener('change', () => commit(prop.key, input.value))
          if (prop.type !== 'textinput') {
            input.readOnly = true; const note = document.createElement('small')
            note.textContent = `此属性类型（${prop.type}）暂不支持替换资源，保留壁纸默认值。`; row.append(note)
          }
        }
      }
      control.id = id; control.disabled = busy || !editable(); row.append(control); propertyList.append(row)
    }
    if (!properties.length) {
      const empty = document.createElement('p'); empty.className = 'wallpaper-empty'
      empty.textContent = selected ? '这张壁纸没有声明自定义参数。' : '选择一张壁纸后，显示它自带的参数。'; propertyList.append(empty)
    }
    updateVisibility()
  }
  async function select(item: WallpaperEntry, applyNow = true) {
    selected = item; selectedApplied = false; properties = []; values = {}; propertySearch.value = ''; propertyTitle.textContent = item.name
    propertyNote.textContent = item.reason || (['scene', 'web'].includes(item.kind)
      ? '修改实时生效，按壁纸分别保存。复杂特效取决于渲染器兼容性。'
      : '图片/视频已编码为固定画面；WE 主题色等元数据不会改变画面。')
    setBusy(true); renderProperties()
    let cancelled = false
    try {
      if (applyNow && item.available !== false) {
        status.textContent = `正在加载：${item.name}`
        await apply({ path: item.path, name: item.name, type: `${item.kind}/wallpaper`, ...(item.projectPath ? { projectPath: item.projectPath } : {}) })
        selectedApplied = true
        status.textContent = `已应用：${item.name}`
      } else if (item.available === false) status.textContent = item.reason || '这张壁纸暂不可用'
      else selectedApplied = true
      if (item.projectPath) properties = propertyDefinitions((await getWallpaperProject(item.projectPath)).general?.properties)
      values = wallpaperValues(properties, savedWallpaperValues(propertyPath()))
    } catch (error) {
      cancelled = error instanceof DOMException && error.name === 'AbortError'
      if (cancelled) status.textContent = '已取消上一次壁纸加载'
      else {
        status.textContent = `${selectedApplied ? '壁纸已应用，但参数读取失败' : '应用失败'}：${error instanceof Error ? error.message : String(error)}`
        propertyNote.textContent = selectedApplied ? '当前壁纸已应用，参数暂不可用。' : '这张壁纸未能加载，参数仅供查看；原背景仍保留。'
        if (item.projectPath) {
          try { properties = propertyDefinitions((await getWallpaperProject(item.projectPath)).general?.properties); values = wallpaperValues(properties, savedWallpaperValues(propertyPath())) }
          catch { /* Invalid project metadata has no editable properties. */ }
        }
      }
    }
    finally {
      setBusy(false)
      if (cancelled || (selectedApplied && current()?.path !== item.path)) syncSelection()
      render(); renderProperties()
    }
  }
  function render() {
    const matching = items.filter(item => item.name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())
      && (!filter.value || (filter.value === 'unavailable' ? item.available === false : item.kind === filter.value)))
    const fragment = document.createDocumentFragment()
    for (const item of matching) {
      const card = document.createElement('button'); card.type = 'button'; card.className = 'wallpaper-card'
      card.title = `${item.name}\n${item.reason || item.path}`; card.disabled = busy; card.setAttribute('aria-pressed', String(item.path === current()?.path))
      const thumbnail = document.createElement('span'); thumbnail.className = 'wallpaper-thumbnail'; thumbnail.textContent = kindLabel(item.kind)
      if (item.preview) {
        const image = document.createElement('img'); image.alt = ''; image.loading = 'lazy'; image.src = wallpaperPreviewUrl(item.preview)
        image.addEventListener('error', () => image.remove(), { once: true }); thumbnail.append(image)
      }
      const name = document.createElement('span'); name.className = 'wallpaper-name'; name.textContent = item.name
      const kind = document.createElement('small'); kind.textContent = item.available === false ? '不可用' : kindLabel(item.kind)
      card.append(thumbnail, name, kind); card.addEventListener('click', () => void select(item)); fragment.append(card)
    }
    if (!matching.length) {
      const empty = document.createElement('p'); empty.className = 'wallpaper-empty'
      empty.textContent = items.length ? '没有匹配的壁纸，请调整搜索或类型。' : '未发现壁纸。请自动查找 Steam，或选择包含壁纸项目的目录。'; fragment.append(empty)
    }
    grid.replaceChildren(fragment)
  }
  function setBusy(value: boolean) {
    busy = value; scanButtons.forEach(button => { button.disabled = value })
    grid.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = value })
    search.disabled = value; filter.disabled = value; grid.setAttribute('aria-busy', String(value))
  }
  function syncSelection() {
    const active = current()
    if (!busy && selected && selected.path !== active?.path) {
      selected = null; selectedApplied = false; properties = []; values = {}; propertySearch.value = ''
      propertyTitle.textContent = '壁纸参数'
      propertyNote.textContent = active ? `当前背景：${active.name}。选择壁纸会替换当前背景。` : '未选择背景。选择壁纸后显示它的参数。'
      status.textContent = active ? `当前背景：${active.name}` : '背景已清除'
      renderProperties()
    }
    render()
  }
  document.querySelector('#custom-background')?.addEventListener('background-change', syncSelection)
  async function scan(nextRoot: string | null) {
    setBusy(true); status.textContent = '正在读取壁纸库…'
    try {
      const result = await scanWallpapers(nextRoot); root = nextRoot
      if (root) localStorage.setItem('markflow:wallpaperRoot', root); else localStorage.removeItem('markflow:wallpaperRoot')
      items = result.items; location.textContent = result.roots.join(' · ') || '未发现 Steam 壁纸库，请手动选择目录'; location.title = location.textContent
      const available = items.filter(item => item.available !== false).length
      status.textContent = `共 ${items.length} 项 · 可尝试加载 ${available} 项 · 暂不支持 ${result.unsupported} 项 · 缺失或无效 ${result.invalid} 项${result.truncated ? ' · 已达扫描上限，请选择更具体的目录' : ''}`
    } catch (error) { status.textContent = `读取失败：${error instanceof Error ? error.message : String(error)}` }
    finally { setBusy(false); render() }
  }
  document.querySelectorAll('[data-wallpaper-open]').forEach(button => button.addEventListener('click', async () => {
    dialog.showModal(); if (busy) return
    if (!items.length) await scan(root)
    syncSelection()
    const active = current()
    if (!selected && active?.path) { const item = items.find(item => item.path === active.path); if (item) await select(item, false) }
  }))
  document.querySelector('#wallpaper-close-btn')!.addEventListener('click', () => dialog.close())
  scanButtons.forEach(button => button.addEventListener('click', async () => {
    if (button.dataset.wallpaperScan !== 'choose') { await scan(button.dataset.wallpaperScan === 'auto' ? null : root); return }
    try { const folder = await pickOpenFolder(); if (folder) await scan(folder) } catch (error) { status.textContent = String(error) }
  }))
  reset.addEventListener('click', () => {
    if (busy || !editable()) return
    values = wallpaperValues(properties, {}); updateProperties(propertyPath(), values)
    try { saveWallpaperValues(propertyPath(), {}) } catch { status.textContent = '无法保存默认参数' }
    renderProperties()
  })
  search.addEventListener('input', render); filter.addEventListener('change', render); propertySearch.addEventListener('input', updateVisibility)
  render(); renderProperties()
}
