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

// The top bar. Every control is a native <button type="button"> with an
// i18n name (SC-143): the rail toggle (aria-expanded), the symbol and the
// dialog openers (aria-haspopup="dialog"), Replay and Full screen (one fixed
// name each, the state in aria-pressed), the periods (aria-pressed, one tab
// stop: arrow keys, Home and End move focus, Enter or Space selects; manual
// activation, so arrowing never loads a period), and the chart type (a menu
// button with menuitemradio items).
//
// It fits any width (SC-064, SC-085; src/layout/topBarFit.ts): labels, then
// icons only, then tools moving into a More menu by priority (Screenshot,
// Timezone, Replay, Full screen, Settings, Indicators, Chart type), then the
// periods collapsing into one dropdown. Its menus render at the chart's root,
// so nothing clips them (component/menu).
//
// Class names and DOM order are what hosts style (`.klinecharts-pro-period-bar`,
// `.menu-container`, `.symbol`, `.period`, `.tools`, `.chart-type`), and
// `parts` removes single controls (SC-126). Later PRs add tools through
// `extraTools` (a TopBarTool list), and they join the More menu by priority.
//
// Part of SUPer-Chart (Apache-2.0).

import { type Component, For, type JSX, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js'

import { type SymbolInfo, type Period, type ChartParts, type ChartType, type LayoutMode, type SizeClass } from '../../types'

import i18n from '../../i18n'

import { samePeriod } from '../../data/keys'
import { chartTypeLabel } from '../../common/chartTypes'
import { useChartScope } from '../../common/chartScope'
import { type FitStep, barFits, fitTopBar } from '../../layout/topBarFit'

import { Menu } from '../../component'
import type { MenuItem } from '../../component'
import ChartTypeMenu from '../chart-type-menu'

import {
  RailToggleIcon, ChartTypeIcon, ReplayIcon, IndicatorIcon, TimezoneIcon, SettingIcon, ScreenshotIcon,
  FullscreenIcon, ExitFullscreenIcon, CaretIcon
} from './icons'
// The overflow "more" glyph is the same three-dot shape the drawing-editor
// toolbar uses: one shared icon (src/icons, SC-074) instead of two hand-drawn
// copies at different grids.
import { MoreIcon } from '../../icons'

/** A top-bar tool. Built-in tools and later PRs' tools share this shape. */
export interface TopBarTool {
  id: string
  /** Visible label and accessible name (the label hides in icon-only mode). */
  label: () => string
  icon: () => JSX.Element
  /** Lower moves into the More menu first. */
  priority: number
  /** Shown at all (a part flag). Default: always. */
  visible?: () => boolean
  /** An on/off tool: aria-pressed, the selected look, a checkbox item in More. */
  pressed?: () => boolean
  /** What activating it opens ('menu': it opens its own menu from `anchor`). */
  haspopup?: 'dialog' | 'menu'
  /** Extra classes on the button. */
  class?: string
  /** SC-NEXT #4: a small count badge (e.g. active indicators), like 10.png in the SC-NEXT brief. 0/undefined shows nothing. */
  badge?: () => number
  /** `anchor` is the button it was activated from (the More button when in More). */
  onActivate: (anchor: HTMLElement) => void
}

export interface PeriodBarProps {
  locale: string
  spread: boolean
  symbol: SymbolInfo
  /** SC-NEXT #4: a host's own header/symbol-selector element, mounted where the built-in symbol button sits. Hides that button while set. */
  headerSlotNode?: Node | null
  period: Period
  periods: Period[]
  parts: ChartParts
  layout: LayoutMode
  onSizeClassChange: (size: SizeClass) => void
  onMenuClick: () => void
  onSymbolClick: () => void
  onPeriodChange: (period: Period) => void
  chartType: ChartType
  onChartTypeChange: (type: ChartType) => void
  /** SC-NEXT #2: the grouped chart-type menu's starred types. */
  favouriteChartTypes: ReadonlySet<ChartType>
  onToggleFavouriteChartType: (type: ChartType) => void
  replay: boolean
  onReplayClick: () => void
  onIndicatorClick: () => void
  /** SC-NEXT #4: active-indicator count for the Indicators tool's badge (10.png in the SC-NEXT brief). */
  indicatorCount?: () => number
  onTimezoneClick: () => void
  /** The Timezone item's element, so the popover can anchor itself under it. */
  onTimezoneButtonRef?: (el: HTMLDivElement) => void
  onSettingClick: () => void
  onScreenshotClick: () => void
  fullscreenEnabled: boolean
  fullscreen: boolean
  onFullscreenClick: () => void
  /** More tools (the slot later PRs add theirs through). */
  extraTools?: TopBarTool[]
}

type OpenMenu = { kind: 'chartType' | 'period' | 'more', anchor: HTMLElement } | null

/** Tools at or above this priority (Indicators, Chart type) leave the bar only once the periods have collapsed. */
export const CORE_PRIORITY = 60

const PeriodBar: Component<PeriodBarProps> = props => {
  const scope = useChartScope()
  let barRef: HTMLDivElement | undefined
  let moreRef: HTMLButtonElement | undefined
  let periodMenuRef: HTMLButtonElement | undefined

  const [menu, setMenu] = createSignal<OpenMenu>(null)
  const toggleMenu = (kind: 'chartType' | 'period' | 'more', anchor: HTMLElement): void => {
    const open = menu()
    setMenu(open?.kind === kind && open.anchor === anchor ? null : { kind, anchor })
  }

  const t = (key: string): string => i18n(key, props.locale)

  // Built once: every field reads props, so a state change updates the
  // buttons in place (a focused button keeps focus).
  const builtIn: TopBarTool[] = [
    {
      id: 'chartType',
      label: () => chartTypeLabel(props.chartType, props.locale),
      icon: () => <ChartTypeIcon/>,
      priority: 70,
      visible: () => props.parts.chartType,
      haspopup: 'menu',
      class: 'chart-type',
      onActivate: anchor => { toggleMenu('chartType', anchor) }
    },
    {
      id: 'replay',
      label: () => t('replay'),
      icon: () => <ReplayIcon/>,
      priority: 30,
      visible: () => props.parts.replay,
      pressed: () => props.replay,
      onActivate: () => { props.onReplayClick() }
    },
    {
      id: 'indicators',
      label: () => t('indicator'),
      icon: () => <IndicatorIcon/>,
      priority: 60,
      visible: () => props.parts.indicators,
      haspopup: 'dialog',
      badge: () => props.indicatorCount?.() ?? 0,
      onActivate: () => { props.onIndicatorClick() }
    },
    {
      id: 'timezone',
      label: () => t('timezone'),
      icon: () => <TimezoneIcon/>,
      priority: 20,
      visible: () => props.parts.timezone,
      haspopup: 'dialog',
      onActivate: () => { props.onTimezoneClick() }
    },
    {
      id: 'settings',
      label: () => t('setting'),
      icon: () => <SettingIcon/>,
      priority: 50,
      visible: () => props.parts.settings,
      haspopup: 'dialog',
      onActivate: () => { props.onSettingClick() }
    },
    {
      id: 'screenshot',
      label: () => t('screenshot'),
      icon: () => <ScreenshotIcon/>,
      priority: 10,
      visible: () => props.parts.screenshot,
      haspopup: 'dialog',
      onActivate: () => { props.onScreenshotClick() }
    },
    {
      id: 'fullscreen',
      label: () => t('full_screen'),
      icon: () => props.fullscreen ? <ExitFullscreenIcon/> : <FullscreenIcon/>,
      priority: 40,
      visible: () => props.parts.fullscreen && props.fullscreenEnabled,
      pressed: () => props.fullscreen,
      onActivate: () => { props.onFullscreenClick() }
    }
  ]

  const tools = createMemo(() => [...builtIn, ...(props.extraTools ?? [])].filter(tool => tool.visible?.() ?? true))
  /** The order tools move into More: lowest priority first. */
  const hideOrder = createMemo(() => [...tools()].sort((a, b) => a.priority - b.priority).map(tool => tool.id))
  /** Tools below CORE_PRIORITY may move into More before the periods collapse. */
  const beforeNarrow = createMemo(() => tools().filter(tool => tool.priority < CORE_PRIORITY).length)

  // ---- fitting the width ----------------------------------------------------
  const [fit, setFit] = createSignal<FitStep>({ size: 'regular', hidden: 0 })
  const hiddenIds = createMemo(() => new Set(hideOrder().slice(0, fit().hidden)))
  const collapsed = (): boolean => fit().size === 'narrow'

  const rootOf = (): HTMLElement | undefined => scope?.root ?? barRef?.parentElement ?? undefined

  const apply = (step: FitStep): void => {
    if (barRef === undefined) {
      return
    }
    rootOf()?.setAttribute('data-size', step.size)
    const hide = new Set(hideOrder().slice(0, step.hidden))
    barRef.querySelectorAll<HTMLElement>('[data-tool]').forEach(el => { el.hidden = hide.has(el.dataset.tool ?? '') })
    barRef.querySelectorAll<HTMLElement>('.period[data-period]').forEach(el => { el.hidden = step.size === 'narrow' })
    if (periodMenuRef !== undefined) {
      periodMenuRef.hidden = step.size !== 'narrow'
    }
    if (moreRef !== undefined) {
      moreRef.hidden = hide.size === 0
    }
  }

  const refit = (): void => {
    const bar = barRef
    if (bar === undefined || bar.clientWidth === 0) {
      return
    }
    const step = fitTopBar(props.layout, hideOrder().length, fit(), {
      apply,
      measure: slack => barFits(bar, slack)
    }, beforeNarrow())
    const prev = fit()
    if (prev.size !== step.size || prev.hidden !== step.hidden) {
      setFit(step)
    }
    props.onSizeClassChange(step.size)
  }

  onMount(() => {
    refit()
    if (typeof ResizeObserver !== 'undefined' && barRef !== undefined) {
      const observer = new ResizeObserver(() => { refit() })
      observer.observe(barRef)
      onCleanup(() => { observer.disconnect() })
    }
    // Labels measured before a web font arrives are too narrow or too wide.
    void document.fonts?.ready.then(() => { refit() })
  })

  // What changes the bar's content: fit again once it has rendered.
  createEffect(on(
    () => [props.locale, props.layout, props.periods, props.period, props.symbol, props.chartType, props.fullscreen, props.replay, props.spread, tools(), ...tools().map(tool => tool.label())],
    () => { refit() },
    { defer: true }
  ))

  // A menu whose trigger went away (moved into More) closes.
  createEffect(on(fit, () => {
    const open = menu()
    if (open !== null && (open.anchor.hidden || !open.anchor.isConnected)) {
      setMenu(null)
    }
  }, { defer: true }))

  // ---- periods: one tab stop, arrows move, Enter/Space select ----------------
  const periodIndex = (): number => props.periods.findIndex(p => samePeriod(p, props.period))
  const onPeriodKeyDown = (e: KeyboardEvent): void => {
    const chips = [...(barRef?.querySelectorAll<HTMLElement>('.period[data-period]:not([hidden])') ?? [])]
    const i = chips.indexOf(e.currentTarget as HTMLElement)
    let to = -1
    switch (e.key) {
      case 'ArrowRight': to = (i + 1) % chips.length; break
      case 'ArrowLeft': to = (i - 1 + chips.length) % chips.length; break
      case 'Home': to = 0; break
      case 'End': to = chips.length - 1; break
      default: return
    }
    e.preventDefault()
    chips.forEach((chip, j) => { chip.tabIndex = j === to ? 0 : -1 })
    chips[to]?.focus()
  }

  // ---- menus ----------------------------------------------------------------
  const periodMenuItems = createMemo<MenuItem[]>(() => props.periods.map(p => ({
    key: `${p.multiplier}${p.timespan}`,
    label: p.text,
    checked: samePeriod(p, props.period),
    onSelect: () => { props.onPeriodChange(p) }
  })))

  const moreMenuItems = createMemo<MenuItem[]>(() => tools().filter(tool => hiddenIds().has(tool.id)).map(tool => ({
    key: tool.id,
    // The plain label, never with the badge count suffixed — the More menu's
    // items are matched by exact label text elsewhere (this codebase's own
    // e2e, and plausibly a host's), and the top-bar button (below) is where
    // SC-NEXT's screenshot actually shows the count.
    label: tool.label(),
    ...(tool.pressed !== undefined ? { checked: tool.pressed(), toggle: true } : {}),
    onSelect: () => {
      const anchor = moreRef
      if (anchor === undefined) {
        return
      }
      if (tool.haspopup === 'menu') {
        // Opens its own menu from the More button, once this one has closed.
        queueMicrotask(() => { tool.onActivate(anchor) })
        return
      }
      setMenu(null)
      anchor.focus({ preventScroll: true })
      tool.onActivate(anchor)
    }
  })))

  const menuOpen = (kind: 'chartType' | 'period' | 'more'): boolean => menu()?.kind === kind
  const openOnArrow = (kind: 'chartType' | 'period' | 'more') => (e: KeyboardEvent) => {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !menuOpen(kind)) {
      e.preventDefault()
      setMenu({ kind, anchor: e.currentTarget as HTMLElement })
    }
  }

  const symbolText = (): string => props.symbol.shortName ?? props.symbol.name ?? props.symbol.ticker

  return (
    <>
    <div
      ref={barRef}
      class="klinecharts-pro-period-bar">
      <Show when={props.parts.railToggle}>
        <button
          type="button"
          class="menu-container"
          aria-label={t('drawing_tools')}
          title={t('drawing_tools')}
          aria-expanded={props.spread}
          onClick={() => { props.onMenuClick() }}>
          <RailToggleIcon class={props.spread ? '' : 'rotate'}/>
        </button>
      </Show>
      <Show when={props.headerSlotNode} keyed>
        {node => (
          <div
            class="klinecharts-pro-header-slot"
            ref={el => { el.appendChild(node) }}/>
        )}
      </Show>
      <Show when={props.parts.symbol && props.symbol && !props.headerSlotNode}>
        <button
          type="button"
          class="symbol"
          aria-haspopup="dialog"
          aria-label={`${t('symbol_search')}: ${symbolText()}`}
          title={symbolText()}
          onClick={() => { props.onSymbolClick() }}>
          <Show when={props.symbol.logo}>
            <img alt="" src={props.symbol.logo}/>
          </Show>
          <span class="label">{symbolText()}</span>
        </button>
      </Show>
      <Show when={props.parts.periods}>
        <For each={props.periods}>
          {(p, i) => {
            const selected = (): boolean => samePeriod(p, props.period)
            return (
              <button
                type="button"
                data-period={i()}
                class={`item period ${selected() ? 'selected' : ''}`}
                aria-pressed={selected()}
                tabIndex={selected() || (periodIndex() < 0 && i() === 0) ? 0 : -1}
                hidden={collapsed()}
                onKeyDown={onPeriodKeyDown}
                onClick={() => { props.onPeriodChange(p) }}>
                {p.text}
              </button>
            )
          }}
        </For>
        <button
          ref={periodMenuRef}
          type="button"
          class="item period period-menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen('period')}
          aria-label={`${t('interval')}: ${props.period.text}`}
          title={t('interval')}
          hidden={!collapsed()}
          onKeyDown={openOnArrow('period')}
          onClick={e => { toggleMenu('period', e.currentTarget) }}>
          <span class="label">{props.period.text}</span>
          <CaretIcon/>
        </button>
      </Show>
      <For each={tools()}>
        {tool => {
          const count = (): number => tool.badge?.() ?? 0
          const accessibleName = (): string => count() > 0 ? `${tool.label()} (${count()})` : tool.label()
          return (
            <button
              type="button"
              data-tool={tool.id}
              class={`item tools ${tool.class ?? ''} ${tool.pressed?.() === true ? 'selected' : ''}`}
              aria-label={accessibleName()}
              title={accessibleName()}
              aria-pressed={tool.pressed !== undefined ? tool.pressed() : undefined}
              aria-haspopup={tool.haspopup}
              aria-expanded={tool.id === 'chartType' ? menuOpen('chartType') && menu()?.anchor.dataset.tool === tool.id : undefined}
              hidden={hiddenIds().has(tool.id)}
              onKeyDown={tool.id === 'chartType' ? openOnArrow('chartType') : undefined}
              onClick={e => { tool.onActivate(e.currentTarget) }}>
              {tool.icon()}
              <span class="label">{tool.label()}</span>
              <Show when={count() > 0}>
                <span class="badge" aria-hidden="true">{count()}</span>
              </Show>
            </button>
          )
        }}
      </For>
      <button
        ref={moreRef}
        type="button"
        class="item tools more"
        aria-label={t('more_tools')}
        title={t('more_tools')}
        aria-haspopup="menu"
        aria-expanded={menuOpen('more')}
        hidden={hiddenIds().size === 0}
        onKeyDown={openOnArrow('more')}
        onClick={e => { toggleMenu('more', e.currentTarget) }}>
        <MoreIcon/>
      </button>
    </div>
      <ChartTypeMenu
        open={menuOpen('chartType')}
        anchor={() => menu()?.anchor}
        value={props.chartType}
        favourites={props.favouriteChartTypes}
        locale={props.locale}
        labelFor={type => chartTypeLabel(type, props.locale)}
        onChange={type => { props.onChartTypeChange(type) }}
        onToggleFavourite={type => { props.onToggleFavouriteChartType(type) }}
        onClose={() => { setMenu(null) }}/>
      <Menu
        open={menuOpen('period')}
        anchor={() => menu()?.anchor}
        items={periodMenuItems()}
        label={t('interval')}
        class="period-menu-list"
        onClose={() => { setMenu(null) }}/>
      <Menu
        open={menuOpen('more')}
        anchor={() => menu()?.anchor}
        items={moreMenuItems()}
        label={t('more_tools')}
        class="more-menu"
        onClose={() => { setMenu(null) }}/>
    </>
  )
}

export default PeriodBar
