import { describe, expect, it } from 'vitest'

import type { DataStatus } from '../data/loader'

import { buildChartState, buildLoadState } from './state'

const SYM = { ticker: 'BTC' }
const PERIOD = { multiplier: 1, timespan: 'hour' as const, text: '1H' }

describe('SC-023/SC-130: buildLoadState', () => {
  it('idle before anything has settled (loaded null)', () => {
    const status: DataStatus = { state: 'idle', loadingMore: false, error: null }
    expect(buildLoadState({ symbol: SYM, period: PERIOD }, null, status)).toEqual({
      requested: { symbol: SYM, period: PERIOD }, loaded: null, status: 'idle'
    })
  })

  it('loading while a request is in flight', () => {
    const status: DataStatus = { state: 'loading', loadingMore: false, error: null }
    expect(buildLoadState({ symbol: SYM, period: PERIOD }, null, status).status).toBe('loading')
  })

  it('idle (settled, not loading) once ready or empty', () => {
    const ready: DataStatus = { state: 'ready', loadingMore: false, error: null }
    const empty: DataStatus = { state: 'empty', loadingMore: false, error: null }
    expect(buildLoadState({ symbol: SYM, period: PERIOD }, { symbol: SYM, period: PERIOD }, ready).status).toBe('idle')
    expect(buildLoadState({ symbol: SYM, period: PERIOD }, { symbol: SYM, period: PERIOD }, empty).status).toBe('idle')
  })

  it('error carries a readable message', () => {
    const status: DataStatus = {
      state: 'error',
      loadingMore: false,
      error: { phase: 'initial', symbol: SYM, period: PERIOD, error: new Error('feed down'), timeout: false }
    }
    const s = buildLoadState({ symbol: SYM, period: PERIOD }, null, status)
    expect(s.status).toBe('error')
    expect(s.error).toBe('feed down')
  })

  it('requested and loaded can differ (a change mid-load)', () => {
    const status: DataStatus = { state: 'loading', loadingMore: false, error: null }
    const s = buildLoadState({ symbol: { ticker: 'ETH' }, period: PERIOD }, { symbol: SYM, period: PERIOD }, status)
    expect(s.requested.symbol.ticker).toBe('ETH')
    expect(s.loaded?.symbol.ticker).toBe('BTC')
  })
})

describe('SC-130: buildChartState', () => {
  const loadState = buildLoadState({ symbol: SYM, period: PERIOD }, { symbol: SYM, period: PERIOD }, { state: 'ready', loadingMore: false, error: null })

  it('is a plain JSON round-trip', () => {
    const state = buildChartState({
      symbol: SYM,
      period: PERIOD,
      timezone: 'Etc/UTC',
      locale: 'en-US',
      theme: 'dark',
      chartType: 'candle_solid',
      pricePrecision: 2,
      loadState,
      replayActive: false,
      bars: [{ timestamp: 1 }, { timestamp: 2 }, { timestamp: 3 }]
    })
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
  })

  it('data summarises count and the first/last timestamp', () => {
    const state = buildChartState({
      symbol: SYM,
      period: PERIOD,
      timezone: 'Etc/UTC',
      locale: 'en-US',
      theme: 'light',
      chartType: 'line',
      pricePrecision: 4,
      loadState,
      replayActive: false,
      bars: [{ timestamp: 100 }, { timestamp: 200 }]
    })
    expect(state.data).toEqual({ count: 2, firstTimestamp: 100, lastTimestamp: 200 })
  })

  it('no bars: nulls, not zeros, for the timestamps', () => {
    const state = buildChartState({
      symbol: SYM,
      period: PERIOD,
      timezone: 'Etc/UTC',
      locale: 'en-US',
      theme: 'light',
      chartType: 'line',
      pricePrecision: 4,
      loadState,
      replayActive: false,
      bars: []
    })
    expect(state.data).toEqual({ count: 0, firstTimestamp: null, lastTimestamp: null })
  })

  it('Line and Area report different chartType values', () => {
    const line = buildChartState({ symbol: SYM, period: PERIOD, timezone: 'Etc/UTC', locale: 'en-US', theme: 'light', chartType: 'line', pricePrecision: 2, loadState, replayActive: false, bars: [] })
    const area = buildChartState({ symbol: SYM, period: PERIOD, timezone: 'Etc/UTC', locale: 'en-US', theme: 'light', chartType: 'area', pricePrecision: 2, loadState, replayActive: false, bars: [] })
    expect(line.chartType).not.toBe(area.chartType)
  })

  it('carries schema: 1', () => {
    const state = buildChartState({ symbol: SYM, period: PERIOD, timezone: 'Etc/UTC', locale: 'en-US', theme: 'light', chartType: 'line', pricePrecision: 2, loadState, replayActive: false, bars: [] })
    expect(state.schema).toBe(1)
  })
})
