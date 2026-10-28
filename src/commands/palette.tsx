/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// The opt-in command palette (SC-123's 4th point): off by default
// (`commandPalette` option), and even on, opens only while THIS chart owns
// the key — the shared key dispatcher's own targetInsideChart/
// lastPressInChart gating (src/common/keyDispatcher.ts, the same rule every
// other chart-scoped hotkey in this engine follows) — so a second chart on
// the page, a host's own Cmd/Ctrl+K (SupWallet's docs search) and the
// browser's own Ctrl+K are only ever pre-empted while the chart itself is
// the thing the user is interacting with. preventDefault is called only when
// the palette actually opens.
//
// A thin list over the command registry: it only ever calls execute() (never
// touches the chart directly), so it exercises exactly the same path an
// MCP/agent caller would.
//
// Part of SUPer-Chart (Apache-2.0).

import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from 'solid-js'

import Modal from '../component/modal'
import { useChartScope } from '../common/chartScope'
import { KEY_PRIORITY } from '../common/keyDispatcher'
import type { ExecuteRequest, ExecuteResult } from './bind'
import type { CommandDescriptor } from './schema'
import './palette.less'

export interface CommandPaletteHotkey {
  /** e.key, case-insensitive (e.g. 'k'). @default 'k' */
  key?: string
}

export interface CommandPaletteProps {
  getCommands: () => readonly CommandDescriptor[]
  execute: (request: ExecuteRequest) => Promise<ExecuteResult>
  titleFor: (descriptor: CommandDescriptor) => string
  hotkey?: CommandPaletteHotkey
}

const CommandPalette: Component<CommandPaletteProps> = props => {
  const scope = useChartScope()
  const [open, setOpen] = createSignal(false)
  const [query, setQuery] = createSignal('')
  const [activeIndex, setActiveIndex] = createSignal(0)
  const [status, setStatus] = createSignal('')
  let inputRef: HTMLInputElement | undefined

  const matches = createMemo(() => {
    const q = query().trim().toLowerCase()
    const commands = props.getCommands().filter(c => !c.destructive)
    if (q.length === 0) {
      return commands
    }
    return commands.filter(c => c.id.toLowerCase().includes(q) || props.titleFor(c).toLowerCase().includes(q))
  })

  const run = async (descriptor: CommandDescriptor): Promise<void> => {
    const result = await props.execute({ id: descriptor.id, args: descriptor.example })
    setStatus(result.ok ? `${props.titleFor(descriptor)}: done.` : `${props.titleFor(descriptor)}: ${result.error.message}`)
    if (result.ok) {
      setOpen(false)
    }
  }

  onMount(() => {
    const wantedKey = (props.hotkey?.key ?? 'k').toLowerCase()
    const off = scope?.keys.register(e => {
      if (open() || e.key.toLowerCase() !== wantedKey || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) {
        return false
      }
      e.preventDefault()
      setQuery('')
      setActiveIndex(0)
      setStatus('')
      setOpen(true)
      return true
    }, { priority: KEY_PRIORITY.CHART })
    onCleanup(() => { off?.() })
  })

  return (
    <Show when={open()}>
      <Modal
        class="klinecharts-pro-command-palette"
        width={420}
        title="Commands"
        onClose={() => { setOpen(false) }}>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="klinecharts-pro-command-palette-list"
          class="klinecharts-pro-command-palette-input"
          placeholder="Type a command…"
          value={query()}
          onInput={e => { setQuery(e.currentTarget.value); setActiveIndex(0) }}
          onKeyDown={e => {
            const list = matches()
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActiveIndex(i => Math.min(i + 1, Math.max(0, list.length - 1)))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActiveIndex(i => Math.max(i - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              const target = list[activeIndex()]
              if (target !== undefined) {
                void run(target)
              }
            }
          }}/>
        <ul id="klinecharts-pro-command-palette-list" role="listbox" class="klinecharts-pro-command-palette-list">
          <For each={matches()}>
            {(descriptor, i) => (
              <li
                role="option"
                aria-selected={i() === activeIndex()}
                class={`klinecharts-pro-command-palette-row ${i() === activeIndex() ? 'active' : ''}`}
                onMouseEnter={() => { setActiveIndex(i()) }}
                onClick={() => { void run(descriptor) }}>
                <span class="klinecharts-pro-command-palette-title">{props.titleFor(descriptor)}</span>
                <span class="klinecharts-pro-command-palette-id">{descriptor.id}</span>
              </li>
            )}
          </For>
        </ul>
        <div role="status" aria-live="polite" class="klinecharts-pro-command-palette-status">{status()}</div>
      </Modal>
    </Show>
  )
}

export default CommandPalette
