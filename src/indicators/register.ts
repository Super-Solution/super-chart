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
 * Registers the SC_* templates on klinecharts' registry (a peer singleton).
 * Never touches the plain built-in names ('RSI', 'MACD', 'SMA', …) — see
 * ./aliases.ts for how the engine routes those to these on its own paths.
 * Idempotent, like extension/register.ts's registerExtensions().
 *
 * Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */
import { registerIndicator, getSupportedIndicators } from 'klinecharts'

import { SC_RSI } from './SC_RSI'
import { SC_MACD } from './SC_MACD'
import { SC_SMA } from './SC_SMA'
import { SC_VWAP } from './SC_VWAP'
import { SC_ATR } from './SC_ATR'
import { SC_STOCH } from './SC_STOCH'
import { SC_STOCHRSI } from './SC_STOCHRSI'
import { SC_BBP } from './SC_BBP'
import { SC_MFI } from './SC_MFI'
import { SC_SUPERTREND } from './SC_SUPERTREND'
import { SC_KELTNER } from './SC_KELTNER'
import { SC_DONCHIAN } from './SC_DONCHIAN'
import { SC_ATR_BANDS } from './SC_ATR_BANDS'
import { SC_ICHIMOKU } from './SC_ICHIMOKU'
import { SC_VRVP } from './SC_VRVP'
import { SC_ORDER_BLOCKS } from './SC_ORDER_BLOCKS'
import { SC_FVG } from './SC_FVG'
import { SC_PDHL } from './SC_PDHL'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TEMPLATES: readonly any[] = [
  SC_RSI, SC_MACD, SC_SMA, SC_VWAP, SC_ATR, SC_STOCH, SC_STOCHRSI, SC_BBP, SC_MFI,
  SC_SUPERTREND, SC_KELTNER, SC_DONCHIAN, SC_ATR_BANDS, SC_ICHIMOKU, SC_VRVP,
  SC_ORDER_BLOCKS, SC_FVG, SC_PDHL
]

let registered = false

/** Register every SC_* template. Idempotent; safe to call from more than one entry. */
export function registerScIndicators (): void {
  if (registered) return
  registered = true
  for (const t of TEMPLATES) {
    // A host or a previous load may already have one of these names (e.g. two
    // copies of this package on the page); never clobber a registration this
    // module does not own.
    if (!getSupportedIndicators().includes(t.name)) registerIndicator(t)
  }
}

/** The plain SC_* names this pack registers, for tests and the catalogue seed. */
export const SC_INDICATOR_NAMES: readonly string[] = TEMPLATES.map(t => t.name as string)
