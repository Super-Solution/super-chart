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

// The `parts` option (SC-126): which controls of the chrome are shown. Every
// flag defaults to true, so a chart without `parts` renders exactly what it
// always did. Unknown keys and non-boolean values (JSON callers) are ignored
// with a console warning.
//
// Part of SUPer-Chart (Apache-2.0).

import { CHART_PARTS, ChartPart, ChartParts } from '../types'

export const ALL_PARTS: Readonly<ChartParts> = Object.freeze(
  Object.fromEntries(CHART_PARTS.map(part => [part, true])) as ChartParts
)

function isPart (key: string): key is ChartPart {
  return (CHART_PARTS as readonly string[]).includes(key)
}

/** `input` merged over `base`. */
export function resolveParts (input: unknown, base: Readonly<ChartParts> = ALL_PARTS): ChartParts {
  const out: ChartParts = { ...base }
  if (input === undefined || input === null) {
    return out
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    console.warn(`[super-chart] parts must be an object of booleans; got ${JSON.stringify(input)}. Ignored.`)
    return out
  }
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!isPart(key)) {
      console.warn(`[super-chart] unknown part ${JSON.stringify(key)}; expected one of ${CHART_PARTS.join(', ')}. Ignored.`)
      continue
    }
    if (typeof value !== 'boolean') {
      console.warn(`[super-chart] part ${key} must be true or false; got ${JSON.stringify(value)}. Ignored.`)
      continue
    }
    out[key] = value
  }
  return out
}
