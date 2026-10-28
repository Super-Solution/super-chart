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

// Source-text checks, in the style of widget/drawing-toolbar/wiring.test.ts:
// the project's vitest config runs in a plain Node environment with no Solid
// JSX transform (its `include` is *.test.ts, not *.tsx, and there is no
// jsdom/testing-library wiring for it), so a unit test here reads the
// component source rather than rendering it. SC-058 / SC-074.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.tsx'), 'utf8')

describe('icon registry (src/icons)', () => {
  it('every <Svg> icon is aria-hidden (decorative; the control names itself)', () => {
    // The Svg wrapper itself sets aria-hidden="true" unconditionally.
    expect(src).toMatch(/aria-hidden="true"/)
    // No icon component sets its own aria-hidden="false" or omits it by using a raw <svg>.
    const rawSvgTags = [...src.matchAll(/<svg\b[^>]*>/g)].filter(m => !m[0].includes('aria-hidden'))
    expect(rawSvgTags.map(m => m[0])).toEqual([])
  })

  it('no icon hard-codes an id (a page with two of the same icon must not collide) — SC-058', () => {
    expect(src).not.toMatch(/\bid="/)
  })

  it('LockIcon, UnlockIcon and TrashIcon draw with stroke/currentColor, not the rail\'s fill convention', () => {
    for (const name of ['LockIcon', 'UnlockIcon', 'TrashIcon']) {
      const body = src.slice(src.indexOf(`export const ${name}`), src.indexOf(`export const ${name}`) + 400)
      expect(body, `${name} uses currentColor`).toMatch(/currentColor/)
    }
  })

  it('exports the icons the drawing-editor toolbar (SC-058) and the rail flyout (SC-011) need', () => {
    for (const name of ['LockIcon', 'UnlockIcon', 'TrashIcon', 'MoreIcon', 'CaretIcon', 'Svg']) {
      expect(src).toMatch(new RegExp(`export const ${name}\\b`))
    }
  })
})
