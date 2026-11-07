/** Timed playback for the owned loader; no renderer, DOM or global registry. */
export interface ReplayLoaderLike {
  enterReplay: (at?: number) => boolean
  exitReplay: () => void
  replayStep: (delta: number) => void
  readonly replaying: boolean
  readonly replayAtEnd: boolean
  readonly replayInfo: { index: number, length: number, timestamp: number } | null
  on?: (type: 'replay', listener: (active: boolean) => void) => () => void
}
export interface ReplayTimer {
  setTimeout: (callback: () => void, milliseconds: number) => unknown
  clearTimeout: (handle: unknown) => void
}
export interface TimedReplayState {
  readonly active: boolean
  readonly index: number | null
  readonly length: number
  readonly timestamp: number | null
  readonly atEnd: boolean
  readonly playing: boolean
  readonly speed: number
}
export interface ReplayStartOptions { index?: number, timestamp?: number }
export interface TimedReplayOptions {
  loader: ReplayLoaderLike
  /** Borrow the current data; restarting first exits replay to expose full history. */
  getDataList: () => ReadonlyArray<{ timestamp: number }>
  /** Null while loading/unavailable; use the complete symbol + period identity. */
  getMarketKey: () => string | null
  onChange?: (state: TimedReplayState) => void
  timer?: ReplayTimer
}
export interface TimedReplay {
  start: (options?: ReplayStartOptions) => boolean
  startByTimestamp: (timestamp: number) => boolean
  step: (delta?: number) => TimedReplayState
  play: (speed?: number) => boolean
  setSpeed: (speed: number) => void
  pause: () => void
  exit: () => void
  getState: () => TimedReplayState
  dispose: () => void
}
export const REPLAY_BASE_STEP_MS = 600
const timerDefault: ReplayTimer = {
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: handle => { clearTimeout(handle as ReturnType<typeof setTimeout>) }
}

/** Last loaded bar at or before an epoch-ms timestamp; clamps before the first to zero. */
export function indexAtOrBefore (bars: ReadonlyArray<{ timestamp: number }>, timestamp: number): number {
  if (!Number.isFinite(timestamp) || Math.abs(timestamp) > 8.64e15) throw new RangeError('Replay timestamp must be valid epoch milliseconds')
  let low = 0, high = bars.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (bars[middle].timestamp <= timestamp) low = middle + 1
    else high = middle
  }
  return Math.max(0, low - 1)
}

/** One scheduled step, never elapsed-time catch-up or synthetic price animation. */
export function createTimedReplay (options: TimedReplayOptions): TimedReplay {
  const { loader } = options, timer = options.timer ?? timerDefault
  let speed = 1, playing = false, disposed = false, generation = 0
  let handle: unknown, market: string | null = null
  const live = (): void => { if (disposed) throw new Error('Timed replay has been disposed') }
  const stop = (): void => {
    generation++
    if (handle !== undefined) { timer.clearTimeout(handle); handle = undefined }
    playing = false
  }
  const sameMarket = (): boolean => market !== null && options.getMarketKey() === market
  const getState = (): TimedReplayState => {
    const info = !disposed && (market === null || sameMarket()) ? loader.replayInfo : null
    return Object.freeze({
      active: info !== null,
      index: info?.index ?? null,
      length: info?.length ?? 0,
      timestamp: info?.timestamp ?? null,
      atEnd: info !== null && loader.replayAtEnd,
      playing: info !== null && playing,
      speed
    })
  }
  const emit = (): void => { if (!disposed) options.onChange?.(getState()) }
  const validSpeed = (value: number): void => {
    const delay = REPLAY_BASE_STEP_MS / value
    if (!Number.isFinite(value) || value <= 0 || delay < 16 || delay > 2_147_483_647) throw new RangeError('Replay speed must give a step interval from 16ms to 2147483647ms')
  }
  const schedule = (epoch: number): void => {
    if (disposed || !playing || epoch !== generation || !sameMarket() || !loader.replaying) return
    handle = timer.setTimeout(() => {
      if (disposed || epoch !== generation || !playing) return
      handle = undefined
      if (!sameMarket() || !loader.replaying) { stop(); emit(); return }
      try { loader.replayStep(1) } catch (error) { stop(); emit(); throw error }
      if (disposed || epoch !== generation) return
      if (!sameMarket() || !loader.replaying || loader.replayAtEnd) stop()
      emit()
      schedule(epoch)
    }, REPLAY_BASE_STEP_MS / speed)
  }
  const off = loader.on?.('replay', active => {
    if (!disposed && !active) { stop(); market = null; emit() }
  })
  const start = (input: ReplayStartOptions = {}): boolean => {
    live()
    if (input.index !== undefined && (!Number.isSafeInteger(input.index) || input.index < 0)) throw new RangeError('Replay index must be a nonnegative safe integer')
    if (input.timestamp !== undefined && (!Number.isFinite(input.timestamp) || Math.abs(input.timestamp) > 8.64e15)) throw new RangeError('Replay timestamp must be valid epoch milliseconds')
    if (input.index !== undefined && input.timestamp !== undefined) throw new TypeError('Choose a replay index or timestamp, not both')
    const nextMarket = options.getMarketKey()
    if (nextMarket === null) return false
    stop()
    if (loader.replaying) loader.exitReplay()
    if (disposed || options.getMarketKey() !== nextMarket) return false
    const index = input.index ?? (input.timestamp === undefined ? undefined : indexAtOrBefore(options.getDataList(), input.timestamp))
    market = nextMarket
    const result = loader.enterReplay(index)
    if (!result) market = null
    emit()
    return result && !disposed && sameMarket()
  }
  const setSpeed = (value: number): void => {
    live(); validSpeed(value)
    if (value === speed) return
    const resume = playing
    stop(); speed = value
    playing = resume && loader.replaying && sameMarket() && !loader.replayAtEnd
    const epoch = generation
    emit(); schedule(epoch)
  }
  return {
    start,
    startByTimestamp: timestamp => start({ timestamp }),
    step: (delta = 1) => {
      live()
      if (!Number.isSafeInteger(delta)) throw new RangeError('Replay step must be a safe integer')
      if (!loader.replaying || !sameMarket() || delta === 0) return getState()
      stop(); loader.replayStep(delta); emit(); return getState()
    },
    play: value => {
      live()
      if (value !== undefined) validSpeed(value)
      if (!loader.replaying || loader.replayAtEnd) return false
      const current = options.getMarketKey()
      if (current === null || (market !== null && market !== current)) { stop(); emit(); return false }
      market = current
      if (playing) { if (value !== undefined) setSpeed(value); return playing }
      if (value !== undefined) speed = value
      playing = true
      const epoch = generation
      emit(); schedule(epoch)
      return playing
    },
    setSpeed,
    pause: () => { live(); const changed = playing; stop(); if (changed) emit() },
    exit: () => { live(); stop(); loader.exitReplay(); market = null; emit() },
    getState,
    dispose: () => { if (disposed) return; disposed = true; stop(); off?.(); market = null }
  }
}
