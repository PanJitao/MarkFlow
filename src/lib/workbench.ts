import { isMacOS, primaryModifier, shortcutLabel } from './platform'

interface Command {
  label: string
  shortcut?: string
  run: () => void
}

export function setupWorkbench(editor: HTMLTextAreaElement, options: {
  commands: Command[]
  beforeEdit: () => void
  changed: () => void
  revealEditor: () => void
  revealLine: (line: number) => void
}) {
  const palette = document.querySelector<HTMLDialogElement>('#command-palette')!
  const commandInput = document.querySelector<HTMLInputElement>('#command-input')!
  const commandList = document.querySelector<HTMLElement>('#command-list')!
  const findWidget = document.querySelector<HTMLElement>('#find-widget')!
  const findInput = document.querySelector<HTMLInputElement>('#find-input')!
  const replaceInput = document.querySelector<HTMLInputElement>('#replace-input')!
  const replaceRow = document.querySelector<HTMLElement>('#replace-row')!
  const matchCase = document.querySelector<HTMLButtonElement>('#find-case')!
  const count = document.querySelector<HTMLElement>('#find-count')!
  const cursor = document.querySelector<HTMLElement>('#cursor-position')!
  let matches: Array<{ start: number; end: number }> = []
  let matchIndex = -1
  let commands: Command[] = []
  let commandIndex = 0
  let previousFocus: HTMLElement | null = null

  function updateCursor() {
    const before = editor.value.slice(0, editor.selectionStart)
    const line = before.split('\n').length
    const column = editor.selectionStart - before.lastIndexOf('\n')
    const selection = editor.selectionEnd - editor.selectionStart
    cursor.textContent = `行 ${line}，列 ${column}${selection ? `（已选 ${selection}）` : ''}`
  }

  function selectMatch() {
    const match = matches[matchIndex]
    count.textContent = matches.length ? `${matchIndex + 1} / ${matches.length}` : (findInput.value ? '无结果' : '')
    if (!match) return
    editor.setSelectionRange(match.start, match.end)
    // The line gutter already measures soft wraps; use it to keep the result in view.
    const line = editor.value.slice(0, match.start).split('\n').length
    options.revealLine(line)
    updateCursor()
  }

  function refreshMatches(select = false) {
    matches = []
    const query = findInput.value
    if (query) {
      // Escaping keeps this a literal search and RegExp indices preserve UTF-16 offsets.
      const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(pattern, matchCase.getAttribute('aria-pressed') === 'true' ? 'gu' : 'giu')
      for (const match of editor.value.matchAll(regex)) {
        matches.push({ start: match.index!, end: match.index! + match[0].length })
      }
    }
    matchIndex = matches.findIndex((match) => match.start >= editor.selectionStart)
    if (matchIndex < 0 && matches.length) matchIndex = 0
    count.textContent = matches.length ? `${matchIndex + 1} / ${matches.length}` : (query ? '无结果' : '')
    if (select) selectMatch()
  }

  function openFind(replace = false) {
    options.revealEditor()
    const selection = editor.value.slice(editor.selectionStart, editor.selectionEnd)
    if (selection && !selection.includes('\n')) findInput.value = selection
    findWidget.hidden = false
    replaceRow.hidden = !replace
    document.querySelector('#find-toggle-replace')!.setAttribute('aria-expanded', String(replace))
    refreshMatches(true)
    findInput.focus()
    findInput.select()
  }

  function nextMatch(direction: number) {
    if (!matches.length) return
    matchIndex = (matchIndex + direction + matches.length) % matches.length
    selectMatch()
  }

  function replace(all: boolean) {
    refreshMatches()
    if (!matches.length) return
    options.beforeEdit()
    const selected = all ? matches : [matches[matchIndex]]
    // Work backwards so replacing an earlier match cannot move the later offsets.
    for (const match of [...selected].reverse()) {
      editor.setRangeText(replaceInput.value, match.start, match.end, 'end')
    }
    options.changed()
    refreshMatches(true)
  }

  const allCommands: Command[] = [
    ...options.commands,
    { label: '编辑：查找', shortcut: shortcutLabel('F'), run: () => openFind() },
    { label: '编辑：替换', shortcut: isMacOS ? shortcutLabel('Alt+F') : shortcutLabel('H'), run: () => openFind(true) },
  ]

  function renderCommands() {
    const query = commandInput.value.trim().replace(/^>\s*/, '').toLocaleLowerCase()
    commands = allCommands.filter((command) => command.label.toLocaleLowerCase().includes(query))
    commandIndex = 0
    commandList.replaceChildren()
    commands.forEach((command, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.id = `command-${index}`
      button.tabIndex = -1
      button.setAttribute('role', 'option')
      button.textContent = command.label
      const shortcut = document.createElement('kbd')
      shortcut.textContent = command.shortcut || ''
      button.append(shortcut)
      button.addEventListener('click', () => executeCommand(index))
      commandList.append(button)
    })
    if (!commands.length) commandList.textContent = '没有匹配的命令'
    highlightCommand()
  }

  function highlightCommand() {
    Array.from(commandList.children).forEach((element, index) => {
      element.setAttribute('aria-selected', String(index === commandIndex))
    })
    if (commands.length) {
      commandInput.setAttribute('aria-activedescendant', `command-${commandIndex}`)
      commandList.children[commandIndex]?.scrollIntoView({ block: 'nearest' })
    } else commandInput.removeAttribute('aria-activedescendant')
  }

  function executeCommand(index: number) {
    const command = commands[index]
    if (!command) return
    palette.close()
    previousFocus?.focus()
    command.run()
  }

  function openPalette() {
    previousFocus = document.activeElement as HTMLElement
    commandInput.value = ''
    palette.showModal()
    renderCommands()
    commandInput.focus()
  }

  document.querySelector('#command-palette-btn')!.addEventListener('click', openPalette)
  document.querySelector('#command-close')!.addEventListener('click', () => palette.close())
  commandInput.addEventListener('input', renderCommands)
  commandInput.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) return
    if (event.key === 'Enter') { event.preventDefault(); executeCommand(commandIndex) }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!commands.length) return
      commandIndex = (commandIndex + (event.key === 'ArrowDown' ? 1 : -1) + commands.length) % commands.length
      highlightCommand()
    }
  })
  document.querySelector('#find-btn')!.addEventListener('click', () => openFind())
  document.querySelector('#find-close')!.addEventListener('click', () => { findWidget.hidden = true; editor.focus() })
  document.querySelector('#find-toggle-replace')!.addEventListener('click', () => openFind(replaceRow.hidden))
  document.querySelector('#find-next')!.addEventListener('click', () => nextMatch(1))
  document.querySelector('#find-previous')!.addEventListener('click', () => nextMatch(-1))
  document.querySelector('#replace-one')!.addEventListener('click', () => replace(false))
  document.querySelector('#replace-all')!.addEventListener('click', () => replace(true))
  findInput.addEventListener('input', () => refreshMatches(true))
  matchCase.addEventListener('click', () => {
    matchCase.setAttribute('aria-pressed', String(matchCase.getAttribute('aria-pressed') !== 'true'))
    refreshMatches(true)
  })
  findWidget.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) return
    if (event.key === 'Enter') { event.preventDefault(); nextMatch(event.shiftKey ? -1 : 1) }
    if (event.key === 'Escape') { event.preventDefault(); findWidget.hidden = true; editor.focus() }
  })
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || document.querySelector('dialog[open]')) return
    if (event.key === 'F1' || (primaryModifier(event) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'p')) {
      event.preventDefault()
      openPalette()
      return
    }
    const target = event.target as HTMLElement
    if (target !== editor && target.closest('input, textarea, [contenteditable="true"]')) return
    if (!primaryModifier(event) || event.shiftKey) return
    const key = event.key.toLowerCase()
    if ((!event.altKey && key === 'f') || (isMacOS ? event.altKey && key === 'f' : !event.altKey && key === 'h')) {
      event.preventDefault()
      openFind(key === 'h' || event.altKey)
    }
  })
  for (const event of ['input', 'click', 'keyup', 'select']) editor.addEventListener(event, updateCursor)
  editor.addEventListener('input', () => { if (!findWidget.hidden) refreshMatches() })
  editor.addEventListener('select', () => { if (!findWidget.hidden) refreshMatches() })
  updateCursor()
}
