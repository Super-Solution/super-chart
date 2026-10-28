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

// The bar-replay controller (SC-067): one object both the ReplayBar widget
// and `chartPro.replay` (a later MCP/agent tool's entry point too) drive, so
// the UI and the API can never disagree about what state replay is in. It
// wraps `src/data/loader.ts`'s DataLoader (the actual replay data mode —
// buffering ticks, scroll-back, ending on a symbol switch) and adds only
// what that layer does not need for itself: play/pause with a speed
// multiplier, and picking a start bar by timestamp.
//
// Timer functions are injected (`timer`), so tests drive time without real
// delays, and the play loop re-checks `loader.replaying` on every tick, so a
// replay that a symbol switch ended out from under it (see `data/loader.ts`)
// stops cleanly instead of stepping a chart no longer in replay.
//
// Part of SUPer-Chart (Apache-2.0).

import type { ReplayControls, ReplayStartOptions, ReplayState } from '../types'

export interface ReplayLoaderLike {
  enterReplay: (at?: number) => boolean
  exitReplay: () => void
  replayStep: (dir: number) => void
  readonly replaying: boolean
  readonly replayAtEnd: boolean
  readonly replayInfo: { index: number, length: number, timestamp: number } | null
  /** DataLoader#on: fires with `false` the moment something outside this controller (a symbol/period switch) ends replay. */
  on?: (type: 'replay', fn: (active: boolean) => void) => () => void
}

export interface ReplayTimer {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

const defaultTimer: ReplayTimer = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: handle => { clearTimeout(handle as ReturnType<typeof setTimeout>) }
}

/** The base step interval (speed 1x), matching the chart's long-standing default. */
export const REPLAY_BASE_STEP_MS = 600

export interface ReplayControllerDeps {
  loader: ReplayLoaderLike
  /** For `start({ timestamp })`: the data currently on screen (oldest first). */
  getDataList: () => ReadonlyArray<{ timestamp: number }>
  onChange?: (state: ReplayState) => void
  timer?: ReplayTimer
}

/** The index of the last bar at or before `timestamp` (0 if `timestamp` is before every bar). */
export function indexAtOrBefore (bars: ReadonlyArray<{ timestamp: number }>, timestamp: number): number {
  let index = 0
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].timestamp <= timestamp) {
      index = i
    } else {
      break
    }
  }
  return index
}

export interface ReplayController {
  controls: ReplayControls
  dispose: () => void
}

export function createReplayController (deps: ReplayControllerDeps): ReplayController {
  const { loader } = deps
  const timer = deps.timer ?? defaultTimer
  let speed = 1
  let playing = false
  let handle: unknown

  const getState = (): ReplayState => {
    const info = loader.replayInfo
    return { active: info !== null, index: info?.index ?? -1, timestamp: info?.timestamp ?? null, playing, speed }
  }
  const emit = (): void => { deps.onChange?.(getState()) }

  const stopTimer = (): void => {
    if (handle !== undefined) {
      timer.clearTimeout(handle)
      handle = undefined
    }
    playing = false
  }

  const tick = (): void => {
    handle = undefined
    if (!loader.replaying) {
      playing = false
      emit()
      return
    }
    loader.replayStep(1)
    if (loader.replayAtEnd) {
      playing = false
      emit()
      return
    }
    emit()
    if (playing) {
      handle = timer.setTimeout(tick, REPLAY_BASE_STEP_MS / speed)
    }
  }

  // Self-heal the moment something outside this controller (a symbol/period
  // switch) ends replay — not only on the next scheduled tick, so the UI
  // never shows "playing" for up to one step interval after it really ended.
  const offLoaderReplay = loader.on?.('replay', active => {
    if (!active) {
      stopTimer()
      emit()
    }
  })

  return {
    controls: {
      start (options?: ReplayStartOptions): boolean {
        stopTimer()
        // Re-arming "pick a bar" while already in replay (a "jump to bar",
        // SC-067's corrected fix) needs a fresh entry: DataLoader#enterReplay
        // refuses to re-enter an already-active replay, by design (it is not
        // itself a re-target call), so end the current one first.
        if (loader.replaying) {
          loader.exitReplay()
        }
        let index = options?.index
        if (index === undefined && options?.timestamp !== undefined) {
          index = indexAtOrBefore(deps.getDataList(), options.timestamp)
        }
        const ok = loader.enterReplay(index)
        emit()
        return ok
      },
      step (n = 1): void {
        if (!loader.replaying || n === 0) {
          return
        }
        stopTimer()
        const dir = n > 0 ? 1 : -1
        for (let i = 0; i < Math.abs(n); i++) {
          loader.replayStep(dir)
        }
        emit()
      },
      play (options?: { speed?: number }): void {
        if (!loader.replaying) {
          return
        }
        const requestedSpeed = options?.speed !== undefined && options.speed > 0 ? options.speed : speed
        const speedChanged = requestedSpeed !== speed
        speed = requestedSpeed
        if (playing) {
          // Already running: a speed change reschedules at the new delay
          // (the speed menu can be used mid-play); anything else is a no-op.
          if (speedChanged) {
            if (handle !== undefined) {
              timer.clearTimeout(handle)
            }
            emit()
            handle = timer.setTimeout(tick, REPLAY_BASE_STEP_MS / speed)
          }
          return
        }
        if (loader.replayAtEnd) {
          return
        }
        playing = true
        emit()
        handle = timer.setTimeout(tick, REPLAY_BASE_STEP_MS / speed)
      },
      pause (): void {
        if (!playing) {
          return
        }
        stopTimer()
        emit()
      },
      exit (): void {
        stopTimer()
        loader.exitReplay()
        emit()
      },
      getState
    },
    dispose: () => {
      stopTimer()
      offLoaderReplay?.()
    }
  }
}
