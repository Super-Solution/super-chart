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

/**
 * Indicator settings form (SC-115/SC-163):
 *  - a name absent from ./data.ts (a script indicator, SUPER_SMACROSS/SUPER_RSI,
 *    COMPARE, …) no longer crashes `getConfig(name).map` — it falls back to a
 *    generic numeric field per calcParams entry;
 *  - invalid input is flagged (Input's `data-status="error"`, aria-invalid)
 *    instead of silently dropped, and Confirm is disabled until every field
 *    is valid;
 *  - SAR is shown in TradingView's own units (data.ts' fromStore/toStore),
 *    not klinecharts' internal hundredths;
 *  - Reset restores each field's schema default (or, for a name with no
 *    schema, the values the modal opened with — there is no template
 *    reference here to fall back to).
 */
import { type Component, createMemo, createSignal, For, Show } from 'solid-js'

import { utils } from 'klinecharts'

import { Modal, Input } from '../../component'

import i18n from '../../i18n'

import data, { type SettingParam } from './data'

export interface IndicatorSettingModalProps {
  locale: string
  params: { indicatorName: string, paneId: string, calcParams: any[] }
  onClose: () => void
  onConfirm: (calcParams: any) => void
}

function genericConfig (calcParams: any[]): SettingParam[] {
  return calcParams.map((v, i) => ({
    paramNameKey: `params_${i + 1}`,
    precision: Number.isInteger(v) ? 0 : 4
  }))
}

let indicatorSettingSeq = 0

const IndicatorSettingModal: Component<IndicatorSettingModalProps> = props => {
  const seq = ++indicatorSettingSeq
  const initial = utils.clone(props.params.calcParams)
  const [calcParams, setCalcParams] = createSignal(initial)
  const [invalid, setInvalid] = createSignal<boolean[]>([])

  const config = createMemo((): SettingParam[] => {
    const known = data[props.params.indicatorName]
    return known ?? genericConfig(props.params.calcParams)
  })

  const allValid = createMemo(() => invalid().every(v => !v))

  const displayValue = (d: SettingParam, i: number): number | string => {
    const v = calcParams()[i]
    if (!utils.isValid(v) || v === '') return ''
    return (d.fromStore != null) ? d.fromStore(v) : v
  }

  const confirm = (): void => {
    if (!allValid()) return
    const cfg = config()
    const params: any[] = []
    utils.clone(calcParams()).forEach((param: any, i: number) => {
      if (!utils.isValid(param) || param === '') {
        if (cfg[i] && 'default' in cfg[i]) params.push(cfg[i].default)
        else params.push(param)
      } else {
        params.push(param)
      }
    })
    props.onConfirm(params)
    props.onClose()
  }

  return (
    <Modal
      title={props.params.indicatorName}
      locale={props.locale}
      width={360}
      buttons={[
        {
          type: 'confirm',
          children: i18n('confirm', props.locale),
          disabled: !allValid(),
          onClick: confirm
        },
        {
          type: 'cancel',
          children: i18n('reset', props.locale),
          onClick: () => {
            const cfg = config()
            const restored = calcParams().map((v, i) => (cfg[i] && 'default' in cfg[i] ? cfg[i].default : v))
            setCalcParams(restored)
            setInvalid(restored.map(() => false))
          }
        }
      ]}
      // Enter in a parameter field confirms, like the button.
      onEnter={confirm}
      onClose={props.onClose}>
      <div class="klinecharts-pro-indicator-setting-modal-content">
        <Show when={config().length === 0}>
          <span class="no-params">{i18n('indicator_no_params', props.locale)}</span>
        </Show>
        <For each={config()}>
          {(d, i) => (
            <>
              <span id={`klinecharts-pro-indicator-param-${seq}-${i()}`}>{i18n(d.paramNameKey, props.locale)}</span>
              <Input
                style={{ width: '100%', 'max-width': '200px' }}
                labelId={`klinecharts-pro-indicator-param-${seq}-${i()}`}
                value={displayValue(d, i())}
                precision={d.precision}
                min={d.min}
                max={d.max}
                onValidityChange={valid => {
                  const next = [...invalid()]
                  next[i()] = !valid
                  setInvalid(next)
                }}
                onChange={value => {
                  const params = utils.clone(calcParams())
                  params[i()] = value === '' ? value : ((d.toStore != null) ? d.toStore(value as number) : value)
                  setCalcParams(params)
                }}/>
            </>
          )}
        </For>
      </div>
    </Modal>
  )
}

export default IndicatorSettingModal
