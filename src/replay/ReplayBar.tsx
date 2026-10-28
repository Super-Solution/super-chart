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

// The replay transport bar (SC-067): named, focusable buttons (no Unicode
// glyphs) driving the shared `ReplayController`, plus a speed menu and the
// "pick a bar to start from" toggle (ChartProComponent arms/disarms the
// actual click-to-pick; this only shows and toggles that state).
//
// Part of SUPer-Chart (Apache-2.0).

import { createMemo, createSignal } from 'solid-js'
import type { Component } from 'solid-js'

import { Menu } from '../component'
import type { MenuItem } from '../component'

import i18n from '../i18n'

import type { ReplayState } from '../types'

const SPEEDS = [0.5, 1, 2, 5, 10]

export interface ReplayBarProps {
  locale: string
  state: ReplayState
  /** "Pick a bar to start from" is armed (ChartProComponent owns the actual click-to-pick). */
  picking: boolean
  /** The bar's own root element (SC-057: so the drawing toolbar can avoid covering it). */
  ref?: (el: HTMLDivElement) => void
  onTogglePicking: () => void
  onStepBack: () => void
  onPlayPause: () => void
  onStepForward: () => void
  onSpeedChange: (speed: number) => void
  onExit: () => void
}

const ReplayBar: Component<ReplayBarProps> = props => {
  const t = (key: string): string => i18n(key, props.locale)
  const [speedMenuOpen, setSpeedMenuOpen] = createSignal(false)
  let speedButtonRef: HTMLButtonElement | undefined

  const speedItems = createMemo<MenuItem[]>(() => SPEEDS.map(s => ({
    key: String(s),
    label: `${s}x`,
    checked: s === props.state.speed,
    onSelect: () => { props.onSpeedChange(s) }
  })))

  return (
    <>
      <div ref={props.ref} class="klinecharts-pro-replay-bar" role="toolbar" aria-label={t('replay')}>
        <button
          type="button"
          class={props.picking ? 'selected' : ''}
          aria-pressed={props.picking}
          aria-label={t('replay_select_start')}
          title={t('replay_select_start')}
          onClick={props.onTogglePicking}>
          <svg viewBox="0 0 1024 1024" aria-hidden="true"><path d="M512 128a64 64 0 0 1 64 64v256h256a64 64 0 0 1 0 128H576v256a64 64 0 0 1-128 0V576H192a64 64 0 0 1 0-128h256V192a64 64 0 0 1 64-64z"/></svg>
        </button>
        <button
          type="button"
          aria-label={t('replay_back')}
          title={t('replay_back')}
          onClick={props.onStepBack}>
          <svg viewBox="0 0 1024 1024" aria-hidden="true"><path d="M256 192v640l-160-320zM896 192L416 512l480 320z"/></svg>
        </button>
        <button
          type="button"
          class="play"
          aria-pressed={props.state.playing}
          aria-label={props.state.playing ? t('replay_pause') : t('replay_play')}
          title={props.state.playing ? t('replay_pause') : t('replay_play')}
          onClick={props.onPlayPause}>
          {props.state.playing
            ? <svg viewBox="0 0 1024 1024" aria-hidden="true"><path d="M288 192h128v640H288zM608 192h128v640H608z"/></svg>
            : <svg viewBox="0 0 1024 1024" aria-hidden="true"><path d="M256 192l576 320-576 320z"/></svg>}
        </button>
        <button
          type="button"
          aria-label={t('replay_forward')}
          title={t('replay_forward')}
          onClick={props.onStepForward}>
          <svg viewBox="0 0 1024 1024" aria-hidden="true"><path d="M768 192v640l160-320zM128 192l480 320-480 320z"/></svg>
        </button>
        <button
          ref={el => { speedButtonRef = el }}
          type="button"
          class="speed"
          aria-haspopup="menu"
          aria-expanded={speedMenuOpen()}
          aria-label={`${t('replay_speed')}: ${props.state.speed}x`}
          title={t('replay_speed')}
          onClick={() => { setSpeedMenuOpen(v => !v) }}>
          {props.state.speed}x
        </button>
        <button
          type="button"
          class="exit"
          aria-label={t('replay_exit')}
          onClick={props.onExit}>
          {t('replay_exit')}
        </button>
      </div>
      <Menu
        open={speedMenuOpen()}
        anchor={() => speedButtonRef}
        items={speedItems()}
        label={t('replay_speed')}
        class="replay-speed-menu"
        onClose={() => { setSpeedMenuOpen(false) }}/>
    </>
  )
}

export default ReplayBar

// Re-exported for tests / consumers of the pure list.
export { SPEEDS }
