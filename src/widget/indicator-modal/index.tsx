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

/**
 * The indicator picker (SC-113/SC-114/SC-133): catalogue-driven (search,
 * categories, presets) instead of two hard-coded name arrays, and its checked
 * state comes from the chart's real indicators (`props.indicators`, read by
 * ChartProComponent with readIndicators() every time this opens and after
 * every change) — never a list this component or ChartProComponent keeps on
 * the side. A host-created indicator (`owner: 'host'`) shows checked but is
 * never removed from here: the picker only ever removes what the engine
 * itself added ("Anything a host created through getChart() is never
 * edited, listed, deleted or re-registered by engine UI unless the host
 * opts in").
 *
 * One row per catalogue name (SC-113's "one row instead of listing MA/EMA/
 * BOLL/SAR/SMA/BBI twice"): each goes to the pane its catalogue entry
 * declares (candle pane for a price-scale indicator, a new pane otherwise).
 * A script indicator only appears once it (or its host) opts into the
 * catalogue — see registerCatalogedScriptIndicator, src/indicators/catalog.ts.
 *
 * Rows are keyboard-operable (SC-145, from the i18n/a11y batch): one row is
 * a checkbox (role="checkbox", aria-checked), one tab stop with Up/Down/
 * Home/End moving between them like the original two-list picker did — the
 * catalogue rewrite only changed what a row IS, not how it is reached.
 */
import { type Component, createMemo, createSignal, For, Show } from 'solid-js'

import { Modal, List, Checkbox, Input } from '../../component'

import i18n from '../../i18n'

import type { IndicatorCatalogEntry, IndicatorCategory } from '../../indicators/catalog'
import type { IndicatorSnapshot } from '../../indicators/state'
import { resolveIndicatorName } from '../../indicators/aliases'

export interface IndicatorModalProps {
  locale: string
  indicators: IndicatorSnapshot[]
  catalog: IndicatorCatalogEntry[]
  onClose: () => void
  /** A row was toggled on (a fresh add) or a preset was picked (calcParams set on the existing/new instance). */
  onAdd: (entry: IndicatorCatalogEntry, calcParams?: number[]) => void
  /** A checked, engine-owned row was toggled off. Never called for a host-owned row. */
  onRemove: (name: string) => void
}

const CATEGORY_KEYS: Record<IndicatorCategory, string> = {
  trend: 'indicator_category_trend',
  momentum: 'indicator_category_momentum',
  volatility: 'indicator_category_volatility',
  volume: 'indicator_category_volume',
  scripts: 'indicator_category_scripts',
  other: 'indicator_category_other'
}
const CATEGORY_ORDER: IndicatorCategory[] = ['trend', 'momentum', 'volatility', 'volume', 'scripts', 'other']

const IndicatorModal: Component<IndicatorModalProps> = props => {
  const [query, setQuery] = createSignal('')
  // Each row is one checkbox (role="checkbox", aria-checked): Space or Enter
  // toggles it, like a click. The rows are one tab stop; Up, Down, Home and
  // End move between them (SC-145). `.row` is queried generically, so it
  // works the same whether rows sit under one flat list or grouped by
  // category (the catalogue rewrite) — a row is still just a row.
  let listRef: HTMLDivElement | undefined

  const rows = (): HTMLElement[] => [...(listRef?.querySelectorAll<HTMLElement>('li.row') ?? [])]
  const onRowKeyDown = (e: KeyboardEvent, toggle: () => void): void => {
    const list = rows()
    const i = list.indexOf(e.currentTarget as HTMLElement)
    let to = -1
    switch (e.key) {
      case ' ':
      case 'Enter':
        e.preventDefault()
        toggle()
        return
      case 'ArrowDown': to = Math.min(list.length - 1, i + 1); break
      case 'ArrowUp': to = Math.max(0, i - 1); break
      case 'Home': to = 0; break
      case 'End': to = list.length - 1; break
      default: return
    }
    e.preventDefault()
    list.forEach((row, j) => { row.tabIndex = j === to ? 0 : -1 })
    list[to]?.focus()
  }

  const checkedNames = createMemo(() => new Set(props.indicators.map(i => i.name)))
  const hostOwnedNames = createMemo(() => {
    const s = new Set<string>()
    props.indicators.forEach(i => { if (i.owner === 'host') s.add(i.name) })
    return s
  })

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase()
    const list = props.catalog.filter(e => e.listed)
    if (q === '') return list
    return list.filter(e => {
      const label = i18n(e.i18nKey ?? '', props.locale)
      return e.name.toLowerCase().includes(q) || e.title.toLowerCase().includes(q) || label.toLowerCase().includes(q)
    })
  })

  const grouped = createMemo(() => {
    const byCat = new Map<IndicatorCategory, IndicatorCatalogEntry[]>()
    filtered().forEach(e => {
      const arr = byCat.get(e.category) ?? []
      arr.push(e)
      byCat.set(e.category, arr)
    })
    return CATEGORY_ORDER.map(cat => ({ cat, entries: byCat.get(cat) ?? [] })).filter(g => g.entries.length > 0)
  })

  // A row's catalogue name (e.g. 'RSI') is not always what ends up on the
  // chart: engine paths resolve 'RSI'/'MACD'/'SMA' to their SC_ replacement
  // (./aliases.ts), so the checked state has to follow the SAME resolution,
  // or a freshly-added SC_RSI would show its own 'RSI' row as unchecked.
  const chartNameOf = (entry: IndicatorCatalogEntry): string => resolveIndicatorName(entry.name)

  const toggle = (entry: IndicatorCatalogEntry): void => {
    const chartName = chartNameOf(entry)
    if (checkedNames().has(chartName)) {
      if (hostOwnedNames().has(chartName)) return // host-owned: never removed from here
      props.onRemove(chartName)
    } else {
      props.onAdd(entry)
    }
  }

  const firstEntry = createMemo(() => grouped()[0]?.entries[0])

  return (
    <Modal
      title={i18n('indicator', props.locale)}
      locale={props.locale}
      width={420}
      onClose={props.onClose}>
      <Input
        class="klinecharts-pro-indicator-modal-search"
        style={{ width: '100%', 'margin-bottom': '8px' }}
        placeholder={i18n('search', props.locale)}
        value={query()}
        onChange={v => { setQuery(String(v)) }}/>
      {/* display:contents keeps this only as a query root for keyboard nav
          (SC-145) — it must not become a box, or it breaks the flex chain
          .content-container -> .klinecharts-pro-indicator-modal-list that
          SC-078's `flex: 0 1 440px` (index.less) needs to shrink and scroll
          in a short chart. */}
      <div ref={listRef} style={{ display: 'contents' }}>
        <List class="klinecharts-pro-indicator-modal-list">
          <For each={grouped()}>
            {group => (
              <>
                <li class="title" role="presentation">{i18n(CATEGORY_KEYS[group.cat], props.locale)}</li>
                <For each={group.entries}>
                  {entry => {
                    const checked = (): boolean => checkedNames().has(chartNameOf(entry))
                    const hostOwned = (): boolean => hostOwnedNames().has(chartNameOf(entry))
                    const toggleThis = (): void => { toggle(entry) }
                    return (
                      <li
                        class={`row ${hostOwned() ? 'managed' : ''}`}
                        role="checkbox"
                        aria-checked={checked()}
                        title={hostOwned() ? i18n('indicator_host_managed', props.locale) : undefined}
                        tabIndex={firstEntry() === entry ? 0 : -1}
                        onKeyDown={e => { onRowKeyDown(e, toggleThis) }}
                        onClick={toggleThis}>
                        <Checkbox checked={checked()} label={entry.i18nKey ? i18n(entry.i18nKey, props.locale) : entry.title}/>
                        <Show when={(entry.presets != null) && entry.presets.length > 0}>
                          <span class="presets">
                            <For each={entry.presets}>
                              {preset => (
                                <span
                                  class="preset"
                                  onClick={e => { e.stopPropagation(); props.onAdd(entry, preset.calcParams) }}>
                                  {preset.label}
                                </span>
                              )}
                            </For>
                          </span>
                        </Show>
                      </li>
                    )
                  }}
                </For>
              </>
            )}
          </For>
          <Show when={grouped().length === 0}>
            <li class="empty">{i18n('indicator_no_match', props.locale)}</li>
          </Show>
        </List>
      </div>
    </Modal>
  )
}

export default IndicatorModal
