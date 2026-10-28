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

// 'klinecharts' is mocked here rather than loaded for real: its dist/umd
// build is a classic UMD/IIFE with no import/export statements, but the
// package's own package.json says "type": "module" — so Node's ESM/CJS
// interop parses it as an (empty) ES module, the UMD wrapper's own
// `typeof exports === 'object'` guard is false in real ESM scope, and it
// falls through to the browser-global branch instead of populating this
// module's exports (confirmed: `require('klinecharts')` in plain Node
// returns `[Module: null prototype] {}`). Every *.test.ts elsewhere in this
// project only ever does `import type` from 'klinecharts' for exactly this
// reason. This mock exercises builtinHit.ts's actual wrapping logic (read
// the original template's fields, append a hit path only for a
// drawing_tools instance, preserve everything else, idempotent) against a
// fake registry with the same shape as klinecharts' registerOverlay /
// getOverlayClass / getSupportedOverlays.
import { describe, it, expect, vi } from 'vitest'

interface FakeTemplate {
  name: string
  totalStep?: number
  needDefaultPointFigure?: boolean
  needDefaultXAxisFigure?: boolean
  needDefaultYAxisFigure?: boolean
  createPointFigures?: (ctx: unknown) => unknown
  performEventMoveForDrawing?: (...args: unknown[]) => unknown
  onRightClick?: (...args: unknown[]) => unknown
}

type FakeCtor = new () => FakeTemplate

const registry = new Map<string, FakeCtor>()

function extend (template: FakeTemplate): FakeCtor {
  return class {
    constructor () {
      Object.assign(this as object, template)
    }
  } as unknown as FakeCtor
}

vi.mock('klinecharts', () => ({
  getOverlayClass: (name: string) => registry.get(name) ?? null,
  getSupportedOverlays: () => [...registry.keys()],
  registerOverlay: (template: FakeTemplate) => { registry.set(template.name, extend(template)) }
}))

// Imported after the mock is set up (vi.mock is hoisted by vitest anyway,
// but this keeps the intent obvious).
const { patchBuiltinLineHitTest, BUILTIN_LINE_TOOLS } = await import('./builtinHit')
const { HIT_PATH_FIGURE } = await import('./hitPath')
const { DRAWING_GROUP_ID } = await import('../drawing-editor/controller')

function registerFakeBuiltin (name: string): void {
  registry.set(name, extend({
    name,
    totalStep: 2,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: (ctx: unknown) => {
      const { coordinates } = ctx as { coordinates: Array<{ x: number, y: number }> }
      return [{ type: 'line', attrs: { coordinates } }]
    },
    performEventMoveForDrawing: () => 'moved',
    onRightClick: () => true
  }))
}

function figuresOf (name: string, groupId: string): Array<{ type: string, attrs?: unknown }> {
  const Ctor = registry.get(name)
  if (Ctor === undefined) throw new Error(`not registered: ${name}`)
  const instance = new Ctor()
  const coordinates = [{ x: 10, y: 10 }, { x: 100, y: 60 }]
  const result = instance.createPointFigures?.({
    overlay: { groupId, styles: null },
    coordinates,
    defaultStyles: { line: { size: 1 } }
  })
  return (Array.isArray(result) ? result : [result]) as Array<{ type: string, attrs?: unknown }>
}

// patchBuiltinLineHitTest patches once per process (a module-level guard,
// matching registerExtensions()'s own idempotency elsewhere in this
// package), so these run in one sequence against one shared fake registry
// rather than each resetting it — vitest runs `it`s within a `describe` in
// declaration order.
describe('patchBuiltinLineHitTest (SC-100)', () => {
  for (const name of BUILTIN_LINE_TOOLS) registerFakeBuiltin(name)
  registry.set('somethingElse', extend({ name: 'somethingElse', createPointFigures: (ctx: unknown) => [{ type: 'line', attrs: { coordinates: (ctx as { coordinates: unknown }).coordinates } }] }))

  it('before patching, a drawing-group instance has no hit-path figure', () => {
    const figures = figuresOf('horizontalStraightLine', DRAWING_GROUP_ID)
    expect(figures.some(f => f.type === HIT_PATH_FIGURE)).toBe(false)
  })

  it('patches every listed tool: a drawing-group instance gains a hit-path figure, a host (no group) instance does not', () => {
    patchBuiltinLineHitTest()
    for (const name of BUILTIN_LINE_TOOLS) {
      const grouped = figuresOf(name, DRAWING_GROUP_ID)
      expect(grouped.some(f => f.type === HIT_PATH_FIGURE), `${name}: drawing-group instance`).toBe(true)
      const host = figuresOf(name, 'some_other_group_or_none')
      expect(host.some(f => f.type === HIT_PATH_FIGURE), `${name}: host instance`).toBe(false)
    }
  })

  it('preserves the original line figure (still drawn) and other template fields (performEventMoveForDrawing, onRightClick)', () => {
    const figures = figuresOf('segment', DRAWING_GROUP_ID)
    expect(figures.filter(f => f.type === 'line').length).toBe(1)
    expect(figures.filter(f => f.type === HIT_PATH_FIGURE).length).toBe(1)
    const Ctor = registry.get('segment')
    expect(Ctor).toBeDefined()
    const instance = new (Ctor as FakeCtor)()
    expect(instance.performEventMoveForDrawing?.()).toBe('moved')
    expect(instance.onRightClick?.()).toBe(true)
  })

  it('is idempotent: patching again does not double the hit path', () => {
    patchBuiltinLineHitTest()
    const figures = figuresOf('rayLine', DRAWING_GROUP_ID)
    expect(figures.filter(f => f.type === HIT_PATH_FIGURE).length).toBe(1)
  })

  it('the hit path is bounded to the drawn segment, with a tolerance derived from the line width (not a fixed 2px)', () => {
    const figures = figuresOf('priceLine', DRAWING_GROUP_ID)
    const hit = figures.find(f => f.type === HIT_PATH_FIGURE) as { attrs: Array<{ coordinates: Array<{ x: number, y: number }>, tolerance: number }> }
    expect(hit.attrs[0].coordinates).toEqual([{ x: 10, y: 10 }, { x: 100, y: 60 }])
    expect(hit.attrs[0].tolerance).toBeGreaterThanOrEqual(4)
  })

  it('a name outside BUILTIN_LINE_TOOLS (not a rail built-in) is left untouched', () => {
    const figures = figuresOf('somethingElse', DRAWING_GROUP_ID)
    expect(figures.some(f => f.type === HIT_PATH_FIGURE)).toBe(false)
  })
})
