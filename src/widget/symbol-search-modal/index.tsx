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

// The symbol search modal (SC-031, SC-106, SC-110, SC-111). Autofocus,
// Escape-close and the Tab focus trap already come from the shared Modal
// (d8f70cb6) — not re-implemented here. What this file adds:
//   - a *total* fetcher (SC-031): a rejecting/throwing searchSymbols tags its
//     own success/failure instead of leaving createResource in an errored
//     state, so the error path below can render instead of throwing during
//     a render update;
//   - search as you type (debounced `onInput`, not only blur/Enter);
//   - ArrowUp/ArrowDown + Enter, with an IME guard and a stale-list guard
//     (Enter never picks the still-showing previous query's top row);
//   - a combobox/listbox ARIA wiring and a polite live result count;
//   - a "Recent" group above the results, from `props.recents` (SC-111),
//     shown only when it is present in the *current* (empty-query) result —
//     so a demo market that returns [] never shows a stale ticker.
//
// Part of SUPer-Chart (Apache-2.0).

import { Component, createEffect, createMemo, createResource, createSignal, on, onCleanup, Show } from 'solid-js'

import { Modal, List, Input } from '../../component'

import i18n from '../../i18n'

import { SymbolInfo, Datafeed } from '../../types'

import { decideEnter, moveActiveIndex, visibleRecents } from './nav'
import type { RecentsStore } from './nav'

/**
 * A rejecting (or throwing, or non-array-returning) searchSymbols left the
 * modal spinning forever: Solid's createResource enters an errored state on
 * a rejection, and reading it (dataSource={symbolList() ?? []}) then throws
 * inside the render update with nothing to catch it (SC-031). A *total*
 * fetcher — one that always resolves, tagging its own success or failure —
 * keeps the resource out of that state altogether, so <Show> below can
 * render an error row with Retry instead.
 */
type SearchOutcome = { ok: true, items: SymbolInfo[] } | { ok: false, error: unknown }

export interface SymbolSearchModalProps {
  locale: string
  datafeed: Datafeed
  /** Prefilled from a type-to-search keystroke (SC-110). */
  initialQuery?: string
  /** From ChartProOptions.symbolSearch (SC-111); undefined disables the group entirely (no storage, no lookups). */
  recents?: RecentsStore
  onSymbolSelected: (symbol: SymbolInfo) => void
  onClose: () => void
}

const DEBOUNCE_MS = 150
let instanceSeq = 0

const SymbolSearchModal: Component<SymbolSearchModalProps> = props => {
  const listId = `klinecharts-pro-symbol-search-list-${++instanceSeq}`

  const [inputValue, setInputValue] = createSignal(props.initialQuery ?? '')
  const [query, setQuery] = createSignal(props.initialQuery ?? '')
  const [activeIndex, setActiveIndex] = createSignal(0)
  const [pendingSelect, setPendingSelect] = createSignal(false)
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let listWrapRef: HTMLDivElement | undefined
  let controller: AbortController | null = null

  const search = async (q: string): Promise<SearchOutcome> => {
    controller?.abort()
    controller = new AbortController()
    try {
      const result = await props.datafeed.searchSymbols(q, { signal: controller.signal })
      return { ok: true, items: Array.isArray(result) ? result : [] }
    } catch (error) {
      return { ok: false, error }
    }
  }

  onCleanup(() => { controller?.abort() })

  const [symbolList, { refetch }] = createResource(query, search)

  const failed = (): boolean => symbolList()?.ok === false
  const items = (): SymbolInfo[] => {
    const r = symbolList()
    return r?.ok === true ? r.items : []
  }

  const flushQuery = (): void => {
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer)
      debounceTimer = undefined
    }
    if (query() !== inputValue()) {
      setQuery(inputValue())
    }
  }

  const scheduleQuery = (v: string): void => {
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer)
    }
    debounceTimer = setTimeout(() => { setQuery(v) }, DEBOUNCE_MS)
  }

  const recentRows = createMemo(() => {
    if (props.recents === undefined || inputValue().trim() !== '') {
      return []
    }
    return visibleRecents(props.recents.list(), items(), s => s.ticker)
  })
  const searchRows = createMemo<SymbolInfo[]>(() => items())
  const rows = createMemo(() => (recentRows().length > 0 ? recentRows() : searchRows()))

  // A fresh result set starts at the top row.
  createEffect(on(rows, list => { setActiveIndex(list.length > 0 ? 0 : -1) }))

  const select = (symbol: SymbolInfo): void => {
    props.recents?.push(symbol.ticker)
    props.onSymbolSelected(symbol)
    props.onClose()
  }

  // An Enter pressed while the debounce was still pending: once the fresh
  // result for the query actually on screen arrives, select from it.
  createEffect(() => {
    if (pendingSelect() && !symbolList.loading && query() === inputValue()) {
      setPendingSelect(false)
      const list = rows()
      if (list.length > 0) {
        select(list[Math.max(0, Math.min(activeIndex(), list.length - 1))])
      }
    }
  })

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => moveActiveIndex(i, e.key === 'ArrowDown' ? 1 : -1, rows().length))
      listWrapRef?.querySelector(`#${listId}-${activeIndex()}`)?.scrollIntoView({ block: 'nearest' })
      return
    }
    if (e.key !== 'Enter') {
      return
    }
    const decision = decideEnter({
      isComposing: e.isComposing || e.keyCode === 229,
      shownQuery: query(),
      currentQuery: inputValue(),
      loading: symbolList.loading,
      activeIndex: activeIndex(),
      resultCount: rows().length
    })
    switch (decision.action) {
      case 'select': e.preventDefault(); select(rows()[decision.index]); break
      case 'wait': e.preventDefault(); setPendingSelect(true); flushQuery(); break
      default: break
    }
  }

  const activeId = (): string | undefined => (activeIndex() >= 0 ? `${listId}-${activeIndex()}` : undefined)

  return (
    <Modal
      title={i18n('symbol_search', props.locale)}
      locale={props.locale}
      width={460}
      onClose={props.onClose}>
      <Input
        class="klinecharts-pro-symbol-search-modal-input"
        placeholder={i18n('symbol_code', props.locale)}
        ariaLabel={i18n('symbol_search', props.locale)}
        role="combobox"
        aria-expanded={true}
        aria-controls={listId}
        aria-activedescendant={activeId()}
        aria-autocomplete="list"
        suffix={
          <svg viewBox="0 0 1024 1024" aria-hidden="true">
            <path d="M945.066667 898.133333l-189.866667-189.866666c55.466667-64 87.466667-149.333333 87.466667-241.066667 0-204.8-168.533333-373.333333-373.333334-373.333333S96 264.533333 96 469.333333 264.533333 842.666667 469.333333 842.666667c91.733333 0 174.933333-34.133333 241.066667-87.466667l189.866667 189.866667c6.4 6.4 14.933333 8.533333 23.466666 8.533333s17.066667-2.133333 23.466667-8.533333c8.533333-12.8 8.533333-34.133333-2.133333-46.933334zM469.333333 778.666667C298.666667 778.666667 160 640 160 469.333333S298.666667 160 469.333333 160 778.666667 298.666667 778.666667 469.333333 640 778.666667 469.333333 778.666667z"/>
          </svg>
        }
        value={inputValue()}
        onInput={v => { setInputValue(v); scheduleQuery(v) }}
        onKeyDown={onKeyDown}
        onChange={v => { setInputValue(`${v}`); flushQuery() }}/>
      <span class="klinecharts-pro-sr-only" aria-live="polite">
        {rows().length} {i18n('results', props.locale)}
      </span>
      <Show when={recentRows().length > 0}>
        <div class="klinecharts-pro-symbol-search-modal-group-label">{i18n('recent', props.locale)}</div>
      </Show>
      <div ref={el => { listWrapRef = el }}>
        <Show when={failed()}>
          <div class="klinecharts-pro-symbol-search-modal-error" role="alert">
            <span>{i18n('data_error', props.locale)}</span>
            <button type="button" onClick={() => { void refetch() }}>{i18n('retry', props.locale)}</button>
          </div>
        </Show>
        <Show when={!failed() && !symbolList.loading && rows().length === 0}>
          <div class="klinecharts-pro-symbol-search-modal-empty">{i18n('data_empty', props.locale)}</div>
        </Show>
        <List
          id={listId}
          role="listbox"
          aria-label={i18n('symbol_search', props.locale)}
          class="klinecharts-pro-symbol-search-modal-list"
          loading={symbolList.loading && rows().length === 0}
          loadingText={i18n('loading', props.locale)}
          dataSource={failed() ? [] : rows()}
          renderItem={(symbol: SymbolInfo, index: number) => (
            <li
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex()}
              classList={{ active: index === activeIndex() }}
              onMouseEnter={() => { setActiveIndex(index) }}
              onClick={() => { select(symbol) }}>
              <div>
                <Show when={symbol.logo}>
                  <img alt="symbol" src={symbol.logo}/>
                </Show>
                <span title={symbol.name ?? ''}>{symbol.shortName ?? symbol.ticker}{`${symbol.name ? `(${symbol.name})` : ''}`}</span>
              </div>
              {symbol.exchange ?? ''}
            </li>
          )}>
        </List>
      </div>
    </Modal>
  )
}

export default SymbolSearchModal
