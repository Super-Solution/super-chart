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

// The price-axis scale corner (SC-116, SC-098): percentage / log / invert /
// auto-fit, one click away instead of three clicks into Settings. Rendered
// into the candle pane's own y-axis DOM element (ChartProComponent, the same
// technique the price-unit badge already uses), so it sits in that axis's
// own box at any chart size with no manual measurement.
//
// Part of SUPer-Chart (Apache-2.0).

import type { Component } from 'solid-js'

import i18n from '../../i18n'

import type { PriceScale, PriceScaleType } from '../../types'

export interface ScaleControlsProps {
  locale: string
  scale: PriceScale
  onTypeChange: (type: PriceScaleType) => void
  onReverseChange: (reverse: boolean) => void
  onFit: () => void
}

const ScaleControls: Component<ScaleControlsProps> = props => {
  const t = (key: string): string => i18n(key, props.locale)
  // Clicking the active toggle returns to 'normal' (the corrected fix's spec).
  const toggleType = (type: PriceScaleType): void => { props.onTypeChange(props.scale.type === type ? 'normal' : type) }

  return (
    <div class="klinecharts-pro-scale-controls" role="group" aria-label={t('price_axis_type')}>
      <button
        type="button"
        class={props.scale.type === 'percentage' ? 'selected' : ''}
        aria-pressed={props.scale.type === 'percentage'}
        title={t('percentage')}
        aria-label={t('percentage')}
        onClick={() => { toggleType('percentage') }}>%</button>
      <button
        type="button"
        class={props.scale.type === 'log' ? 'selected' : ''}
        aria-pressed={props.scale.type === 'log'}
        title={t('log')}
        aria-label={t('log')}
        onClick={() => { toggleType('log') }}>log</button>
      <button
        type="button"
        class={props.scale.reverse ? 'selected' : ''}
        aria-pressed={props.scale.reverse}
        title={t('reverse_coordinate')}
        aria-label={t('reverse_coordinate')}
        onClick={() => { props.onReverseChange(!props.scale.reverse) }}>
        <svg viewBox="0 0 1024 1024" aria-hidden="true"><path d="M512 64L320 288h384L512 64zM512 960l192-224H320l192 224zM480 352h64v320h-64z"/></svg>
      </button>
      <button
        type="button"
        title={t('auto_scale')}
        aria-label={t('auto_scale')}
        onClick={() => { props.onFit() }}>A</button>
    </div>
  )
}

export default ScaleControls
