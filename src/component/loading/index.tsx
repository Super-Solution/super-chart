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

import type { Component, VoidComponent } from 'solid-js'
import { Show } from 'solid-js'

import i18n from '../../i18n'

import type { DataStatus } from '../../data/loader'
import type { DataStatesOption } from '../../types'

/**
 * A thin indeterminate progress bar along the top edge. Never takes pointer
 * events. Decorative: LoadingStatus says "Loading" to assistive technology.
 */
const Loading: VoidComponent = () => {
  return (
    <div class="klinecharts-pro-loading" aria-hidden="true">
      <i class="klinecharts-pro-loading-bar"/>
    </div>
  )
}

/**
 * A polite live region that says "Loading…" while `loading` is true. Always
 * mounted (a region created together with its text is announced unreliably),
 * visually hidden, and never inside an aria-busy subtree, which would silence
 * it: the busy flag goes on the region that is loading, beside this one.
 */
export const LoadingStatus: VoidComponent<{ loading: boolean, locale: string }> = props => {
  return (
    <span class="klinecharts-pro-visually-hidden" role="status" aria-live="polite">
      {props.loading ? i18n('loading', props.locale) : ''}
    </span>
  )
}

export interface DataStateLayerProps {
  status: DataStatus
  locale: string
  options: DataStatesOption
  drawingBarVisible: boolean
  onRetry: () => void
}

/**
 * The data states over the chart area (not the drawing rail): a progress bar
 * while loading, a spinner at the left edge while older bars load, "No data"
 * for an empty history and a banner with Retry for a failed one. Only the
 * banner takes pointer events, so the chart and the rail stay usable.
 */
export const DataStateLayer: Component<DataStateLayerProps> = props => {
  const chrome = (): boolean => props.options !== false
  const label = (key: 'empty' | 'error'): string | undefined => typeof props.options === 'object' ? props.options[key] : undefined
  const loading = (): boolean => props.status.state === 'loading'
  return (
    <>
      <div
        class="klinecharts-pro-data-state"
        aria-busy={loading() ? 'true' : undefined}
        data-state={props.status.state}
        data-drawing-bar-visible={String(props.drawingBarVisible)}>
        <Show when={loading()}>
          <Loading/>
        </Show>
        <Show when={props.status.loadingMore}>
          <i class="klinecharts-pro-data-state-more" aria-hidden="true"/>
        </Show>
        <Show when={chrome() && props.status.state === 'empty'}>
          <div class="klinecharts-pro-data-state-empty">{label('empty') ?? i18n('data_empty', props.locale)}</div>
        </Show>
        <Show when={chrome() && props.status.state === 'error'}>
          <div class="klinecharts-pro-data-state-error" role="alert">
            <span>{label('error') ?? i18n('data_error', props.locale)}</span>
            <button type="button" onClick={() => { props.onRetry() }}>{i18n('retry', props.locale)}</button>
          </div>
        </Show>
      </div>
      {/* A sibling of the aria-busy region, never inside it: some screen
          readers suppress a live region's announcement when an ancestor is
          marked busy. */}
      <LoadingStatus loading={loading()} locale={props.locale}/>
    </>
  )
}

export default Loading
