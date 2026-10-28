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

// The drawing rail's own state, lifted out of the DrawingBar component into
// ChartProComponent (SC-118, SC-182): which tool each group is on, plus
// lock / magnet, survive the rail being hidden and re-shown (it lives inside
// a <Show>, so it used to remount and reset every time) and, by default,
// a full reload (one namespaced localStorage key). `visible` (the eye) was
// already lifted in an earlier PR and is not duplicated here.
//
// Part of SUPer-Chart (Apache-2.0).

import { batch, createSignal } from 'solid-js'
import type { Accessor } from 'solid-js'

// From ./icons/options, NOT ./icons: that module also imports every icon
// .tsx component, which a plain *.test.ts cannot load (this project's vitest
// config has no JSX/Solid plugin). See the comment in icons/options.ts.
import {
  createSingleLineOptions, createMoreLineOptions, createPolygonOptions, createFibonacciOptions,
  createWaveOptions, createPositionOptions, createMeasureOptions, createTextOptions, createBrushOptions,
  createVolumeOptions
} from './icons/options'
import type { DrawingBarOption } from '../../types'

export const GROUP_KEYS = [
  'singleLine', 'moreLine', 'polygon', 'fibonacci', 'wave', 'position', 'measure', 'text', 'brush', 'volume'
] as const
export type ToolGroupKey = typeof GROUP_KEYS[number]

export type MagnetKind = 'weak_magnet' | 'strong_magnet'
export type DrawingMode = 'normal' | MagnetKind

/** TradingView conventions (SC-118): the first group's Trend Line (segment), not an infinite line, is the default. */
export const GROUP_DEFAULTS: Record<ToolGroupKey, string> = {
  singleLine: 'segment',
  moreLine: 'priceChannelLine',
  polygon: 'circle',
  fibonacci: 'fibonacciLine',
  wave: 'xabcd',
  position: 'positionLong',
  measure: 'priceDateRange',
  text: 'text',
  brush: 'brush',
  volume: 'fixedRangeVolumeProfile'
}

const GROUP_OPTIONS: Record<ToolGroupKey, (locale: string) => Array<{ key: string }>> = {
  singleLine: createSingleLineOptions,
  moreLine: createMoreLineOptions,
  polygon: createPolygonOptions,
  fibonacci: createFibonacciOptions,
  wave: createWaveOptions,
  position: createPositionOptions,
  measure: createMeasureOptions,
  text: createTextOptions,
  brush: createBrushOptions,
  volume: createVolumeOptions
}

/** Every valid tool name for a group (locale-independent: option `key`s do not change with locale). */
function validKeysFor (group: ToolGroupKey): ReadonlySet<string> {
  return new Set(GROUP_OPTIONS[group]('en-US').map(o => o.key))
}

const VALID_KEYS: Record<ToolGroupKey, ReadonlySet<string>> = Object.fromEntries(
  GROUP_KEYS.map(g => [g, validKeysFor(g)])
) as Record<ToolGroupKey, ReadonlySet<string>>

/** A stored/passed-in tool name, checked against its group's real options; the group's default when it is unknown or missing (an unknown name would make the icon lookup throw). */
function sanitizeTool (group: ToolGroupKey, name: unknown): string {
  return typeof name === 'string' && VALID_KEYS[group].has(name) ? name : GROUP_DEFAULTS[group]
}

const DEFAULT_STORAGE_KEY = 'superchart.drawingBar.v1'

interface StoredShape {
  tools?: Partial<Record<ToolGroupKey, string>>
  lock?: boolean
  magnetKind?: MagnetKind
  mode?: DrawingMode
}

function storageKeyOf (persist: DrawingBarOption['persist']): string | null {
  if (persist === false) {
    return null
  }
  if (typeof persist === 'object' && persist !== null && typeof persist.key === 'string' && persist.key.length > 0) {
    return persist.key
  }
  return DEFAULT_STORAGE_KEY
}

/** Every storage read/write is wrapped: a blocked or throwing localStorage (private mode, a locked-down host) must never break the rail. */
function readStorage (key: string): StoredShape | null {
  try {
    const raw = window.localStorage?.getItem(key)
    if (raw === null || raw === undefined) {
      return null
    }
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed as StoredShape : null
  } catch {
    return null
  }
}

function writeStorage (key: string, value: StoredShape): void {
  try {
    window.localStorage?.setItem(key, JSON.stringify(value))
  } catch { /* private mode, quota, or no localStorage: persistence is best-effort */ }
}

export interface DrawingBarState {
  /** The current tool for each group. */
  tool: (group: ToolGroupKey) => string
  setTool: (group: ToolGroupKey, name: string) => void
  lock: Accessor<boolean>
  setLock: (lock: boolean) => void
  /** Which magnet strength the rail's magnet button shows/arms (independent of `mode`, which also carries 'normal'). */
  magnetKind: Accessor<MagnetKind>
  /** 'normal' | the current magnetKind — what setAllMode / new drawings actually use. */
  mode: Accessor<DrawingMode>
  setMode: (mode: DrawingMode) => void
}

/**
 * Create the rail's lifted, persisted state. One instance per chart, owned by
 * ChartProComponent and passed into DrawingBar as props so hiding/re-showing
 * the rail (it sits inside a `<Show>`) does not reset it.
 */
export function createDrawingBarState (option: DrawingBarOption | undefined): DrawingBarState {
  const persist = option?.persist
  const storageKey = storageKeyOf(persist)
  const stored = storageKey === null ? null : readStorage(storageKey)

  const initialTool = (group: ToolGroupKey): string =>
    sanitizeTool(group, option?.tools?.[group] ?? stored?.tools?.[group])

  const [tools, setTools] = createSignal<Record<ToolGroupKey, string>>(
    Object.fromEntries(GROUP_KEYS.map(g => [g, initialTool(g)])) as Record<ToolGroupKey, string>
  )
  const [lock, setLockSignal] = createSignal(stored?.lock === true)
  const [magnetKind, setMagnetKind] = createSignal<MagnetKind>(stored?.magnetKind === 'strong_magnet' ? 'strong_magnet' : 'weak_magnet')
  const [mode, setModeSignal] = createSignal<DrawingMode>(stored?.mode === 'weak_magnet' || stored?.mode === 'strong_magnet' ? stored.mode : 'normal')

  // Persist explicitly from each setter rather than a createEffect: this
  // module is also used from *.test.ts (no DOM, no reactive scheduler
  // running effects), and it must behave identically there and in the
  // browser, not merely "not crash" there.
  const persistNow = (): void => {
    if (storageKey !== null) {
      writeStorage(storageKey, { tools: tools(), lock: lock(), magnetKind: magnetKind(), mode: mode() })
    }
  }

  return {
    tool: group => tools()[group],
    setTool: (group, name) => {
      setTools(prev => ({ ...prev, [group]: sanitizeTool(group, name) }))
      persistNow()
    },
    lock,
    setLock: next => {
      setLockSignal(next)
      persistNow()
    },
    magnetKind,
    mode,
    setMode: next => {
      batch(() => {
        setModeSignal(next)
        if (next !== 'normal') {
          setMagnetKind(next)
        }
      })
      persistNow()
    }
  }
}
