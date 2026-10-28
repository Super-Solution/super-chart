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

// SC-193: the rail's static icon path data is rounded to 2 decimal places
// (an SVGO-style convertPathData pass, floatPrecision 2, nothing else). This
// guards the bundle-size win against creeping back in a hand-edited icon, and
// against a re-run of the rewrite script accidentally widening precision.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const files = fs.readdirSync(here).filter(f => f.endsWith('.tsx'))

describe('drawing-bar icon path precision (SC-193)', () => {
  it('found the icon files (guards against a moved/renamed directory)', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  for (const file of files) {
    it(`${file}: every path number has at most 2 decimal places`, () => {
      const src = fs.readFileSync(path.join(here, file), 'utf8')
      const ds = [...src.matchAll(/d="([^"]*)"/g)].map(m => m[1])
      const tooPrecise: string[] = []
      for (const d of ds) {
        for (const num of d.match(/-?\d+\.\d+/g) ?? []) {
          const decimals = num.split('.')[1]
          if (decimals.length > 2) {
            tooPrecise.push(num)
          }
        }
      }
      expect(tooPrecise, `numbers with >2 decimals in ${file}`).toEqual([])
    })
  }
})
