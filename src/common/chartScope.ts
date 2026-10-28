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

// What every piece of one chart's chrome shares: its root element (menus and
// popovers portal into it), its key dispatcher and its full-screen state.
// Created once per chart by ChartProComponent and provided through Solid
// context, so a modal, a menu or a later PR's widget deep in the tree reaches
// them with `useChartScope()` instead of new props.
//
// Part of SUPer-Chart (Apache-2.0).

import { createContext, useContext } from 'solid-js'

import { createKeyDispatcher, KeyDispatcher } from './keyDispatcher'
import { createFullscreen, FullscreenController, FullscreenChange, FullscreenOption } from './fullscreen'

export interface ChartScope {
  /** The chart's own root element (`.klinecharts-pro-root`). */
  root: HTMLElement
  keys: KeyDispatcher
  fullscreen: FullscreenController
  dispose: () => void
}

export interface ChartScopeOptions {
  fullscreen: () => FullscreenOption
  onFullscreenChange?: (change: FullscreenChange) => void
}

export function createChartScope (root: HTMLElement, options: ChartScopeOptions): ChartScope {
  const win = root.ownerDocument.defaultView ?? window
  const keys = createKeyDispatcher(() => root, win)
  const fullscreen = createFullscreen(root, { option: options.fullscreen, keys, onChange: options.onFullscreenChange })
  return {
    root,
    keys,
    fullscreen,
    dispose () {
      fullscreen.dispose()
      keys.dispose()
    }
  }
}

export const ChartScopeContext = createContext<ChartScope>()

/** The chart this component is part of; undefined outside a chart (a component rendered on its own). */
export function useChartScope (): ChartScope | undefined {
  return useContext(ChartScopeContext)
}
