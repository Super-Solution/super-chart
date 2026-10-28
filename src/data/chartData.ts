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

// The Solid side of the data loader: signals for the chart component, the
// effect that turns symbol/period changes into loads, and the load-outcome
// waiters (SC-023). Bar replay itself lives in src/replay/controller.ts
// (SC-067), which wraps DataLoader directly.

import type { KLineData } from 'klinecharts'
import type { Accessor } from 'solid-js'
import { createEffect, createMemo, createSignal, on, untrack } from 'solid-js'

import type { Datafeed, Period, SymbolInfo } from '../types'

import { periodKey, symbolKey } from './keys'
import type { DataStatus, LoaderChart } from './loader'
import { DataLoader } from './loader'
import type { FinalPair, LoadOutcome } from './loadWaiters'
import { LoadWaiterQueue } from './loadWaiters'

function dataKeyOf (symbol: SymbolInfo, period: Period): string {
  return `${symbolKey(symbol)}|${periodKey(period)}`
}

function describeError (error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  try {
    return String(error)
  } catch {
    return 'unknown error'
  }
}

export interface ChartDataOptions {
  datafeed: Datafeed
  symbol: Accessor<SymbolInfo>
  period: Accessor<Period>
  tickThrottleMs?: number
}

export interface ChartData {
  /** Bar replay lives on this directly now (src/replay/controller.ts, SC-067): the loader is the one place that knows the current pair's data. */
  loader: DataLoader
  status: Accessor<DataStatus>
  attach: (chart: LoaderChart | null) => void
  reload: () => void
  /**
   * SC-023: a Promise<LoadResult>-shaped await for the symbol/period change
   * a caller just made. Call once per setSymbol/setPeriod, right after its
   * signal write (chartProComponent.tsx does), so this batch's baseline is
   * read before that write and its final pair after it. Coalesced with any
   * other call in the same tick; never rejects.
   */
  awaitLoad: () => Promise<LoadOutcome>
  /** getBars(): the chart's own data list, optionally the newest `limit` bars. */
  getBars: (limit?: number) => KLineData[]
  dispose: () => void
}

export function createChartData (options: ChartDataOptions): ChartData {
  const loader = new DataLoader({ datafeed: options.datafeed, tickThrottleMs: options.tickThrottleMs })
  const [status, setStatus] = createSignal<DataStatus>(loader.status)
  let chartRef: LoaderChart | null = null

  const readFinal = (): FinalPair => {
    const symbol = untrack(options.symbol)
    const period = untrack(options.period)
    return { key: dataKeyOf(symbol, period), symbol, period }
  }
  const waiters = new LoadWaiterQueue(readFinal().key, readFinal)

  loader.on('status', s => {
    setStatus(s)
    const shown = loader.shown
    if (shown === null) {
      return
    }
    const shownKey = dataKeyOf(shown.symbol, shown.period)
    if (s.state === 'ready' || s.state === 'empty') {
      waiters.settle(shownKey, { status: 'loaded', symbol: shown.symbol, period: shown.period, bars: chartRef?.getDataList().length ?? 0 })
    } else if (s.state === 'error' && s.error !== null) {
      waiters.settle(shownKey, { status: 'error', symbol: shown.symbol, period: shown.period, message: describeError(s.error.error), timeout: s.error.timeout })
    }
  })

  // Only a change to what would be fetched starts a load: an identical
  // re-send, or a new display name, precision or period label, does not.
  const dataKey = createMemo(() => dataKeyOf(options.symbol(), options.period()))
  createEffect(on(dataKey, () => { loader.request(untrack(options.symbol), untrack(options.period)) }))

  return {
    loader,
    status,
    attach: (chart: LoaderChart | null) => { chartRef = chart; if (chart !== null) { loader.attach(chart) } },
    reload: () => { loader.reload() },
    awaitLoad: async () => await waiters.wait(),
    getBars: (limit) => {
      const list = chartRef?.getDataList() ?? []
      return limit === undefined || limit >= list.length ? list : list.slice(list.length - limit)
    },
    dispose: () => {
      waiters.dispose()
      loader.dispose()
    }
  }
}
