import { StrictMode, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SuperChart, useWorkspaceEvent, type ChartWorkspace } from '@supersolutions/super-chart-react'
import { createFeed, MARKETS as SYMBOLS } from '../_shared/feed'
import { ENVELOPE_SCHEMA, readEnvelope, restoreEnvelope, saveEnvelope } from '../workspace-persistence/persistence'

// One feed for the whole app: a new feed object would be a new data source, and the chart would mount again.
const { datafeed } = createFeed()
const STORAGE_KEY = 'super-chart-example:workspace'
const DEVICE = 'example-browser'

function App () {
  const [ticker, setTicker] = useState(SYMBOLS[0].ticker)
  const [period, setPeriod] = useState('15m')
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [workspace, setWorkspace] = useState<ChartWorkspace | null>(null)
  const [log, setLog] = useState<string[]>([])
  const note = useCallback((text: string) => { setLog(lines => [text, ...lines].slice(0, 4)) }, [])
  const symbol = SYMBOLS.find(item => item.ticker === ticker) ?? SYMBOLS[0]

  // Events from a component that holds the workspace. The listener may change every render.
  useWorkspaceEvent(workspace, 'loadResult', result => { note(`load: ${result.status}`) })

  // Host-owned marks: a take-profit level the person can drag. Dragging is a request; the host validates it and writes the price.
  // One price per market: a level for BETA means nothing on ALPHA.
  const takeProfit = useRef(new Map<string, number>())
  useEffect(() => {
    if (workspace === null) return
    const place = (): void => {
      const bars = workspace.getBars({ limit: 1 }), last = bars[bars.length - 1]
      if (last === undefined) return
      const key = workspace.getSymbol().ticker, price = takeProfit.current.get(key) ?? last.close * 1.04
      takeProfit.current.set(key, price)
      workspace.annotations.setAnnotations('trade', [
        { key: 'tp', kind: 'level', anchors: [{ time: last.timestamp, price }], text: 'Take profit', tone: 'bull', draggable: true }
      ])
    }
    return workspace.on('dataChange', event => { if (event.kind === 'reset') place() })
  }, [workspace])

  const save = (): void => {
    if (workspace === null) return
    const previous = readEnvelope(localStorage.getItem(STORAGE_KEY))
    const envelope = saveEnvelope(workspace, DEVICE, typeof previous === 'object' ? previous : null)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope))
    note(`saved revision ${envelope.revision} (envelope schema ${ENVELOPE_SCHEMA})`)
  }
  const restore = async (): Promise<void> => {
    if (workspace === null) return
    const stored = readEnvelope(localStorage.getItem(STORAGE_KEY))
    if (stored === null || stored === 'newer-than-app') { note(stored === null ? 'nothing saved yet' : 'saved by a newer version of this app'); return }
    const outcome = await restoreEnvelope(workspace, stored, { isMarketAvailable: market => SYMBOLS.some(item => item.ticker === market.ticker) })
    note(`restore: ${outcome.status}`)
    if (outcome.status === 'restored') { setTicker(workspace.getSymbol().ticker); setPeriod(workspace.getPeriod().text) }
  }

  return (
    <>
      <header>
        <select value={ticker} onChange={event => { setTicker(event.target.value) }} aria-label="Market">{SYMBOLS.map(item => <option key={item.ticker}>{item.ticker}</option>)}</select>
        <select value={period} onChange={event => { setPeriod(event.target.value) }} aria-label="Interval">{['1m', '5m', '15m', '1h', '4h', '1D'].map(item => <option key={item}>{item}</option>)}</select>
        <button onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark') }}>{theme === 'dark' ? 'Light' : 'Dark'}</button>
        <button onClick={save} disabled={workspace === null}>Save</button>
        <button onClick={() => { void restore() }} disabled={workspace === null}>Restore</button>
        <span className="note" role="status">{log[0] ?? 'Drag the take-profit line; drawings and indicators save with the workspace.'}</span>
      </header>
      <main>
        <SuperChart
          datafeed={datafeed}
          symbol={symbol}
          period={period}
          theme={theme}
          chart={{ drawByHolding: true }}
          onReady={setWorkspace}
          onDispose={() => { setWorkspace(null) }}
          onAnnotationIntent={event => {
            if (event.phase !== 'commit' || workspace === null) return
            // A trading app would validate the order here (size, risk, venue) and refuse by simply not writing the price.
            takeProfit.current.set(workspace.getSymbol().ticker, event.price)
            workspace.annotations.setAnnotations('trade', [{ key: 'tp', kind: 'level', anchors: [{ time: Date.now(), price: event.price }], text: 'Take profit', tone: 'bull', draggable: true }])
            note(`take profit moved to ${event.price.toFixed(4)}`)
          }}
        />
      </main>
    </>
  )
}

// StrictMode on purpose: development mounts, disposes and mounts the chart again, which is exactly what must be safe.
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
