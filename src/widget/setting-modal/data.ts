/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific locale governing permissions and
 * limitations under the License.
 */

import i18n from '../../i18n'
import { chartTypeItems } from '../../common/chartTypes'

/** The chart type row: it goes through setChartType, not setStyles (SC-124). */
export const CHART_TYPE_KEY = 'candle.type'

export interface SettingOption {
  key: string
  text: string
  component: 'select' | 'switch'
  dataSource?: Array<{ key: string, text: string }>
}

export function getOptions (locale: string): SettingOption[] {
  return [
    {
      key: CHART_TYPE_KEY,
      text: i18n('chart_type', locale),
      component: 'select',
      // The top bar's list, names included: Line is Line here too.
      dataSource: chartTypeItems(locale)
    },
    {
      key: 'candle.priceMark.last.show',
      text: i18n('last_price_show', locale),
      component: 'switch'
    },
    {
      key: 'candle.priceMark.high.show',
      text: i18n('high_price_show', locale),
      component: 'switch'
    },
    {
      key: 'candle.priceMark.low.show',
      text: i18n('low_price_show', locale),
      component: 'switch'
    },
    {
      key: 'indicator.lastValueMark.show',
      text: i18n('indicator_last_value_show', locale),
      component: 'switch'
    },
    {
      key: 'yAxis.type',
      text: i18n('price_axis_type', locale),
      component: 'select',
      dataSource: [
        { key: 'normal', text: i18n('normal', locale) },
        { key: 'percentage', text: i18n('percentage', locale) },
        { key: 'log', text: i18n('log', locale) }
      ]
    },
    {
      key: 'yAxis.reverse',
      text: i18n('reverse_coordinate', locale),
      component: 'switch'
    },
    {
      key: 'grid.show',
      text: i18n('grid_show', locale),
      component: 'switch'
    }
  ]
}
