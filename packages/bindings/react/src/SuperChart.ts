import { createElement, forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type ForwardedRef, type ReactElement } from 'react'
import { ChartWorkspace, type ChartWorkspaceOptions, type WorkspaceEvents, type WorkspaceThemeName } from '@supersolutions/super-chart-web'
import type { AnnotationIntentEvent } from '@supersolutions/super-chart-web/annotations'
import { periodKey, parsePeriod, symbolKey, type Period, type SymbolInfo } from '@supersolutions/super-chart-core'

/**
 * Props of the React chart. The market, the theme (`theme="auto"` follows the system's light/dark setting live), the locale and the layout follow the props after mount; everything else
 * in `ChartWorkspaceOptions` (`chart`, `loader`, `search`, `commands`, `contextMenu`, `drawingCache`, `countdown`,
 * `periods`) is read once when the chart mounts. Changing `datafeed` mounts a new chart, because it is a new source of
 * data: create it outside the component or memoize it, or every render replaces the chart.
 */
export interface SuperChartProps extends Omit<ChartWorkspaceOptions, 'period'> {
  /** A period object, or its text such as `15m`. Compared by value, so a new object with the same period does nothing. */
  period: Period | string
  className?: string
  style?: CSSProperties
  /** Called once per mounted chart, right after it is created, with the workspace to drive imperatively. */
  onReady?: (workspace: ChartWorkspace) => void
  /** Called when the chart is about to be disposed (unmount, or a new `datafeed`). The workspace is still usable. */
  onDispose?: (workspace: ChartWorkspace) => void
  onMarketChange?: (event: WorkspaceEvents['marketChange']) => void
  onLoadState?: (event: WorkspaceEvents['loadState']) => void
  onLoadResult?: (event: WorkspaceEvents['loadResult']) => void
  onDataChange?: (event: WorkspaceEvents['dataChange']) => void
  onReplayChange?: (event: WorkspaceEvents['replayChange']) => void
  /** The shown market's drawings changed: `origin` tells the person's own edit from `importDrawings()`. */
  onDrawingsChange?: (event: WorkspaceEvents['drawingsChange']) => void
  /** The person dragged a `draggable` annotation level. A request only: validate it, then write the new price yourself. */
  onAnnotationIntent?: (event: AnnotationIntentEvent) => void
}

type Handlers = Pick<SuperChartProps, 'onReady' | 'onDispose' | 'onMarketChange' | 'onLoadState' | 'onLoadResult' | 'onDataChange' | 'onReplayChange' | 'onDrawingsChange' | 'onAnnotationIntent'>
const EVENTS = [['marketChange', 'onMarketChange'], ['loadState', 'onLoadState'], ['loadResult', 'onLoadResult'], ['dataChange', 'onDataChange'], ['replayChange', 'onReplayChange'], ['drawingsChange', 'onDrawingsChange']] as const

/** The mount-time period: a string is looked up in `periods`, else parsed (`15m`, `1D`, `60`) and labelled as typed. */
function resolvePeriod (period: Period | string, periods: readonly Period[] | undefined): Period {
  if (typeof period !== 'string') return period
  const known = periods?.find(item => item.text === period)
  if (known !== undefined) return known
  const parsed = parsePeriod(period)
  if (parsed === null) throw new TypeError(`Unknown period ${JSON.stringify(period)}`)
  return { ...parsed, text: period }
}

function SuperChartImpl (props: SuperChartProps, ref: ForwardedRef<ChartWorkspace | null>): ReactElement {
  const { className, style, onReady, onDispose, onMarketChange, onLoadState, onLoadResult, onDataChange, onReplayChange, onDrawingsChange, onAnnotationIntent, period, symbol, datafeed, theme, locale, ui } = props
  const host = useRef<HTMLDivElement | null>(null)
  const [workspace, setWorkspace] = useState<ChartWorkspace | null>(null)
  // What the mounted chart was built with, so the follow-up effects only act on a real change.
  const built = useRef({ ui: '', market: '' })
  // The latest props, read by the mount effect and the event bridges so they never need to re-run when a callback changes.
  const latest = useRef({ props, handlers: {} as Handlers })
  latest.current = { props, handlers: { onReady, onDispose, onMarketChange, onLoadState, onLoadResult, onDataChange, onReplayChange, onDrawingsChange, onAnnotationIntent } }
  useImperativeHandle(ref, () => workspace as ChartWorkspace, [workspace])

  // Mount: one workspace per datafeed. Strict Mode runs this effect twice in development; the first workspace is
  // disposed before the second exists, so nothing leaks and no request outlives its chart.
  useEffect(() => {
    const element = host.current
    if (element === null) return
    const current = latest.current.props
    const options: ChartWorkspaceOptions = {
      ...current, period: resolvePeriod(current.period, current.periods)
    }
    for (const key of ['className', 'style', 'onReady', 'onDispose', 'onMarketChange', 'onLoadState', 'onLoadResult', 'onDataChange', 'onReplayChange', 'onDrawingsChange', 'onAnnotationIntent'] as const) delete (options as unknown as Record<string, unknown>)[key]
    built.current = { ui: current.ui === undefined ? '' : JSON.stringify(current.ui), market: `${symbolKey(current.symbol)}|${typeof current.period === 'string' ? current.period : periodKey(current.period)}` }
    const created = new ChartWorkspace(element, options)
    const stops: Array<() => void> = EVENTS.map(([type, handler]) => created.on(type, event => { (latest.current.handlers[handler] as ((value: typeof event) => void) | undefined)?.(event) }))
    stops.push(created.onAnnotationIntent(event => { latest.current.handlers.onAnnotationIntent?.(event) }))
    setWorkspace(created)
    latest.current.handlers.onReady?.(created)
    return () => {
      try { latest.current.handlers.onDispose?.(created) } finally {
        for (const stop of stops) stop()
        setWorkspace(null)
        created.dispose()
      }
    }
  }, [datafeed])

  // Follow the market. Compared by value so a fresh object with the same symbol and period is not a request.
  const periodValue = typeof period === 'string' ? period : periodKey(period)
  const marketValue = `${symbolKey(symbol)}|${periodValue}`
  useEffect(() => {
    if (workspace === null || built.current.market === marketValue) return
    built.current = { ...built.current, market: marketValue }
    // A superseded request resolves as `superseded`; a failed one is reported through onLoadResult, so nothing to await here.
    void workspace.setMarket(symbol, period)
  }, [workspace, marketValue])

  useEffect(() => { if (workspace !== null && theme !== undefined && workspace.getTheme() !== theme) workspace.setTheme(theme as WorkspaceThemeName) }, [workspace, theme])
  useEffect(() => {
    if (workspace === null || locale === undefined) return
    if (workspace.getLocale().toLowerCase() !== locale.trim().toLowerCase().replace(/_/g, '-')) workspace.setLocale(locale)
  }, [workspace, locale])
  const uiValue = ui === undefined ? '' : JSON.stringify(ui)
  useEffect(() => {
    if (workspace === null || ui === undefined || built.current.ui === uiValue) return
    built.current = { ...built.current, ui: uiValue }; workspace.setUi(ui)
  }, [workspace, uiValue])

  return createElement('div', { ref: host, className, style: { width: '100%', height: '100%', minHeight: 0, ...style } })
}

/**
 * The Super Chart workspace as a React component. It renders one `div`, creates the workspace in an effect (so it is safe
 * to server-render and in Strict Mode) and disposes it on unmount. The ref is the `ChartWorkspace`, `null` until mounted.
 */
export const SuperChart = forwardRef<ChartWorkspace | null, SuperChartProps>(SuperChartImpl)
SuperChart.displayName = 'SuperChart'

export type { ChartWorkspace }
