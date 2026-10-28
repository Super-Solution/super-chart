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

import { Component, For, createMemo, createSignal } from 'solid-js'
import { Styles, utils, DeepPartial } from 'klinecharts'

import { deepClone, setPath } from '../../common/object'

import { Modal, Select, Switch } from '../../component'
import type { SelectDataSourceItem } from '../../component'

import i18n from '../../i18n'
import { ChartType, isChartType } from '../../types'
import { CHART_TYPE_KEY, getOptions } from './data'

export interface SettingModalProps {
  locale: string
  currentStyles: Styles
  /** The chart type: Settings shows it and changes it through its one owner (SC-124). */
  chartType: ChartType
  onChartTypeChange: (type: ChartType) => void
  onClose: () => void
  onChange: (style: DeepPartial<Styles>) => void
  onRestoreDefault: (options: SelectDataSourceItem[]) => void
}

let settingSeq = 0

// One setting per row, label and control apart (SC-063). The rows are built
// once per locale and read their values reactively, so a switch or a select
// keeps focus when it changes (SC-145): nothing is re-created.
const SettingModal: Component<SettingModalProps> = props => {
  const seq = ++settingSeq
  const [styles, setStyles] = createSignal(props.currentStyles)
  const options = createMemo(() => getOptions(props.locale))

  const update = (option: SelectDataSourceItem, newValue: any): void => {
    const style = {}
    setPath(style, option.key, newValue)
    const ss = deepClone(styles())
    setPath(ss, option.key, newValue)
    setStyles(ss)
    props.onChange(style)
  }

  return (
    <Modal
      title={i18n('setting', props.locale)}
      locale={props.locale}
      width={440}
      buttons={[
        {
          type: 'cancel',
          children: i18n('restore_default', props.locale),
          onClick: () => {
            props.onRestoreDefault(options())
            props.onClose()
          }
        }
      ]}
      onClose={props.onClose}>
      <div
        class="klinecharts-pro-setting-modal-content">
        <For each={options()}>
          {
            (option, i) => {
              const labelId = `klinecharts-pro-setting-${seq}-${i()}`
              const value = (): unknown => option.key === CHART_TYPE_KEY ? props.chartType : utils.formatValue(styles(), option.key)
              let component
              switch (option.component) {
                case 'select': {
                  const dataSource = option.dataSource ?? []
                  component = (
                    <Select
                      style={{ width: '160px' }}
                      labelId={labelId}
                      selectedKey={String(value())}
                      value={dataSource.find(d => d.key === value())?.text ?? i18n(String(value()), props.locale)}
                      dataSource={dataSource}
                      onSelected={(data) => {
                        const newValue = (data as SelectDataSourceItem).key
                        if (option.key === CHART_TYPE_KEY) {
                          if (isChartType(newValue)) {
                            props.onChartTypeChange(newValue)
                          }
                        } else {
                          update(option, newValue)
                        }
                      }}/>
                  )
                  break
                }
                case 'switch': {
                  component = (
                    <Switch
                      open={!!value()}
                      labelId={labelId}
                      onChange={() => {
                        update(option, !value())
                      }}/>
                  )
                  break
                }
              }
              return (
                <>
                  <span id={labelId} class="label">{option.text}</span>
                  {component}
                </>
              )
            }
          }
        </For>
      </div>
    </Modal>
  )
}

export default SettingModal
