import { describe, expect, it } from 'vitest'

import { entryFileName } from './entry-file-name.mjs'

// The ES build names every preserved module through this function. When it
// returned an absolute path, `vite build` failed outright for anyone whose
// node_modules was a junction, a symlink or a hoisted workspace install.
describe('entryFileName', () => {
  it('keeps a src/ module at its path', () => {
    expect(entryFileName('klinecharts-pro')).toBe('klinecharts-pro.js')
    expect(entryFileName('extension/register')).toBe('extension/register.js')
  })

  it('moves an inlined dependency under vendor/ (node_modules inside the package)', () => {
    expect(entryFileName('node_modules/solid-js/web/dist/web')).toBe('vendor/solid-js/web/dist/web.js')
  })

  it('gives the same relative name when node_modules resolves outside the package', () => {
    const expected = 'vendor/solid-js/web/dist/web.js'
    // a junction or symlink (Rollup sees the real path)
    expect(entryFileName('F:/project/Zzyzx/zzyzx-wt/sc-opt-01/frontend/super-chart/node_modules/solid-js/web/dist/web')).toBe(expected)
    expect(entryFileName('C:\\repo\\node_modules\\solid-js\\web\\dist\\web')).toBe(expected)
    // a hoisted workspace install
    expect(entryFileName('/home/ci/repo/node_modules/solid-js/web/dist/web')).toBe(expected)
    // pnpm's store: the last node_modules segment wins
    expect(entryFileName('/repo/node_modules/.pnpm/solid-js@1.6.11/node_modules/solid-js/web/dist/web')).toBe(expected)
  })

  it('never returns an absolute or parent-relative name', () => {
    expect(() => entryFileName('/elsewhere/lib/module')).toThrow(/no place in dist/)
    expect(() => entryFileName('D:/elsewhere/lib/module')).toThrow(/no place in dist/)
    expect(() => entryFileName('../outside/module')).toThrow(/no place in dist/)
  })
})
