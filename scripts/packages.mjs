// Single source of truth for the package set: build order, entries, licences.
// Dependencies only point down: core <- superscript, core <- web <- chat-plugin.
// `dir` is the short id used by the build; `path` is where the package lives (grouped by role:
// packages/bindings/<framework>, packages/integrations/<host>).
export const SCOPE = '@supersolutions'
export const VERSION = '0.1.0'
export const AUTHOR = 'SUPER SOLUTION LABS INC'
export const LICENSE = 'GPL-3.0-or-later'
export const REPO = 'Super-Solution/super-chart'

/** entries: subpath -> [source file, output basename] */
export const PACKAGES = [
  {
    dir: 'core', path: 'packages/core', name: `${SCOPE}/super-chart-core`,
    description: 'Renderer-free chart core: market data, loader, indicators, drawings, frame and workspace models. No DOM.',
    deps: [],
    entries: { '.': ['src/index.ts', 'index'], './native': ['src/native.ts', 'native'], './indicators': ['src/model/indicatorCatalog.ts', 'indicators'] }
  },
  {
    dir: 'superscript', path: 'packages/superscript', name: `${SCOPE}/super-chart-superscript`,
    description: 'SuperScript language runtime, AI helpers and the script-to-indicator bridge for Super Chart. Runs in plain Node.',
    deps: ['core'],
    entries: { '.': ['src/index.ts', 'index'], './scripts': ['src/scripts.ts', 'scripts'] }
  },
  {
    dir: 'web', path: 'packages/bindings/web', name: `${SCOPE}/super-chart-web`,
    description: 'Canvas chart engine and workspace for the browser: drawing tools, replay, annotations and market overlays.',
    deps: ['core'],
    global: { entry: 'src/index.ts', file: 'super-chart.global', name: 'SuperChart' },
    entries: { '.': ['src/index.ts', 'index'], './annotations': ['src/annotations.ts', 'annotations'], './overlays': ['src/overlayEntry.ts', 'overlays'] }
  },
  {
    dir: 'chat-plugin', path: 'packages/integrations/chat-plugin', name: `${SCOPE}/super-chart-chat-plugin`,
    description: 'super-chat plugin: shows and drives Super Chart charts as chat cards, with an agent tool surface.',
    deps: ['core', 'web'],
    external: [`${SCOPE}/super-protocol`],
    entries: { '.': ['src/index.ts', 'index'] }
  }
]
export const nameOf = dir => PACKAGES.find(p => p.dir === dir).name
