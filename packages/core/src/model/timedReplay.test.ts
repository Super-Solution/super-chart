import { describe, expect, it, vi } from 'vitest'

import { createTimedReplay as createReplayController, indexAtOrBefore, REPLAY_BASE_STEP_MS } from './timedReplay'
import type { TimedReplayOptions as ReplayControllerDeps, ReplayLoaderLike, ReplayTimer } from './timedReplay'

describe('indexAtOrBefore', () => {
  const bars = [{ timestamp: 0 }, { timestamp: 10 }, { timestamp: 20 }, { timestamp: 30 }]
  it('the last bar at or before the timestamp', () => {
    expect(indexAtOrBefore(bars, 25)).toBe(2)
    expect(indexAtOrBefore(bars, 20)).toBe(2)
    expect(indexAtOrBefore(bars, 30)).toBe(3)
  })
  it('0 when the timestamp is before every bar', () => {
    expect(indexAtOrBefore(bars, -5)).toBe(0)
  })
})

/** A fake DataLoader replay surface, manually driven (no real DataLoader/Chart). */
function fakeLoader (dataLength = 20): ReplayLoaderLike & { replaying: boolean, replayAtEnd: boolean, full: number, idx: number } {
  const listeners = new Set<(active: boolean) => void>()
  const state = {
    replaying: false,
    replayAtEnd: false,
    full: dataLength,
    idx: -1,
    enterReplay: vi.fn((at?: number) => {
      state.replaying = true
      state.idx = at ?? Math.floor(dataLength * 0.6)
      state.replayAtEnd = state.idx >= state.full - 1
      listeners.forEach(fn => { fn(true) })
      return true
    }),
    exitReplay: vi.fn(() => {
      state.replaying = false
      state.idx = -1
      listeners.forEach(fn => { fn(false) })
    }),
    replayStep: vi.fn((dir: number) => {
      state.idx = Math.max(0, Math.min(state.full - 1, state.idx + dir))
      state.replayAtEnd = state.idx >= state.full - 1
    }),
    get replayInfo () {
      return state.replaying ? { index: state.idx, length: state.full, timestamp: state.idx * 1000 } : null
    },
    on: (_type: 'replay', fn: (active: boolean) => void) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    }
  }
  return state as unknown as ReplayLoaderLike & { replaying: boolean, replayAtEnd: boolean, full: number, idx: number }
}

function manualTimer (): ReplayTimer & { flush: () => void, pending: number } {
  let fn: (() => void) | null = null
  return {
    get pending () { return fn === null ? 0 : 1 },
    setTimeout: (f: () => void) => { fn = f; return {} },
    clearTimeout: () => { fn = null },
    flush: () => { const f = fn; fn = null; f?.() }
  }
}

function deps (loader: ReplayLoaderLike, timer: ReplayTimer, onChange = vi.fn()): ReplayControllerDeps {
  return { loader, getMarketKey: () => 'test-market', getDataList: () => Array.from({ length: 20 }, (_, i) => ({ timestamp: i * 1000 })), onChange, timer }
}

describe('createReplayController', () => {
  it('start() enters replay at the default index and reports active state', () => {
    const loader = fakeLoader()
    const onChange = vi.fn()
    const controls = createReplayController(deps(loader, manualTimer(), onChange))
    expect(controls.start()).toBe(true)
    expect(loader.enterReplay).toHaveBeenCalledWith(undefined)
    expect(controls.getState().active).toBe(true)
    expect(onChange).toHaveBeenCalled()
  })

  it('start() while already replaying (a "jump to bar") exits the current replay first, then re-enters at the new index', () => {
    const loader = fakeLoader()
    const controls = createReplayController(deps(loader, manualTimer()))
    controls.start({ index: 5 })
    expect(loader.exitReplay).not.toHaveBeenCalled() // the first start(): nothing to exit yet
    controls.start({ index: 12 }) // picking a new bar mid-replay
    expect(loader.exitReplay).toHaveBeenCalledTimes(1)
    expect(loader.enterReplay).toHaveBeenLastCalledWith(12)
    expect(controls.getState().index).toBe(12)
  })

  it('start({ index }) passes the index straight through', () => {
    const loader = fakeLoader()
    const controls = createReplayController(deps(loader, manualTimer()))
    controls.start({ index: 5 })
    expect(loader.enterReplay).toHaveBeenCalledWith(5)
    expect(controls.getState().index).toBe(5)
  })

  it('start({ timestamp }) resolves the timestamp to a data index first', () => {
    const loader = fakeLoader()
    const controls = createReplayController(deps(loader, manualTimer()))
    controls.start({ timestamp: 7500 }) // bar 7 (7000) is the last at or before 7500
    expect(loader.enterReplay).toHaveBeenCalledWith(7)
  })

  it('step(n) steps n bars and reports the new index; a no-op outside replay', () => {
    const loader = fakeLoader()
    const controls = createReplayController(deps(loader, manualTimer()))
    controls.step(1) // not replaying yet
    expect(loader.replayStep).not.toHaveBeenCalled()
    controls.start({ index: 5 })
    controls.step(3)
    expect(controls.getState().index).toBe(8)
    controls.step(-1)
    expect(controls.getState().index).toBe(7)
  })

  it('play() steps once per REPLAY_BASE_STEP_MS/speed, and pause() stops it', () => {
    const loader = fakeLoader()
    const timer = manualTimer()
    const controls = createReplayController(deps(loader, timer))
    controls.start({ index: 0 })
    controls.play()
    expect(controls.getState().playing).toBe(true)
    timer.flush()
    expect(controls.getState().index).toBe(1)
    expect(timer.pending).toBe(1) // rescheduled
    controls.pause()
    expect(controls.getState().playing).toBe(false)
    expect(timer.pending).toBe(0)
  })

  it('a speed multiplier changes the scheduled delay', () => {
    const loader = fakeLoader()
    const setTimeoutSpy = vi.fn((fn: () => void) => { return {} })
    const timer: ReplayTimer = { setTimeout: setTimeoutSpy, clearTimeout: vi.fn() }
    const controls = createReplayController(deps(loader, timer))
    controls.start({ index: 0 })
    controls.play(2)
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), REPLAY_BASE_STEP_MS / 2)
  })

  it('play() stops automatically once it reaches the newest bar', () => {
    const loader = fakeLoader(3)
    const timer = manualTimer()
    const controls = createReplayController(deps(loader, timer))
    controls.start({ index: 1 }) // one step from the end
    controls.play()
    timer.flush() // steps to index 2, the last bar
    expect(controls.getState()).toMatchObject({ index: 2, playing: false })
    expect(timer.pending).toBe(0) // did not reschedule past the end
  })

  it('exit() stops any running play loop and ends replay', () => {
    const loader = fakeLoader()
    const timer = manualTimer()
    const controls = createReplayController(deps(loader, timer))
    controls.start({ index: 0 })
    controls.play()
    controls.exit()
    expect(loader.exitReplay).toHaveBeenCalled()
    expect(controls.getState().active).toBe(false)
    expect(timer.pending).toBe(0)
  })

  it('a symbol switch that ends replay outside the controller self-heals immediately (SC-067)', () => {
    const loader = fakeLoader()
    const timer = manualTimer()
    const onChange = vi.fn()
    const controls = createReplayController(deps(loader, timer, onChange))
    controls.start({ index: 0 })
    controls.play()
    // Something else (a symbol switch) ends replay directly on the loader.
    ;(loader as unknown as { exitReplay: () => void }).exitReplay()
    expect(controls.getState()).toMatchObject({ active: false, playing: false })
    expect(timer.pending).toBe(0) // the pending step is cancelled, not left to fire on a chart no longer in replay
  })

  it('dispose() stops the timer and unsubscribes from the loader', () => {
    const loader = fakeLoader()
    const timer = manualTimer()
    const controls = createReplayController(deps(loader, timer))
    const dispose = controls.dispose
    controls.start({ index: 0 })
    controls.play()
    dispose()
    expect(timer.pending).toBe(0)
  })

  it('changing speed while already playing reschedules the pending step at the new delay', () => {
    const loader = fakeLoader()
    const timer = manualTimer()
    const clearSpy = vi.spyOn(timer, 'clearTimeout')
    const controls = createReplayController(deps(loader, timer))
    controls.start({ index: 0 })
    controls.play() // 1x
    controls.play(2) // change speed mid-play
    expect(clearSpy).toHaveBeenCalledTimes(1) // the pending 1x step was cancelled
    expect(controls.getState().speed).toBe(2)
    expect(timer.pending).toBe(1) // rescheduled at the new speed
  })

  it('play() twice does not schedule two timers', () => {
    const loader = fakeLoader()
    const timer = manualTimer()
    const setTimeoutSpy = vi.spyOn(timer, 'setTimeout')
    const controls = createReplayController(deps(loader, timer))
    controls.start({ index: 0 })
    controls.play()
    controls.play()
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1)
  })
})
