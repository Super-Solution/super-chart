// Single source of truth for the package set: build order, entries, licences.
// Dependencies only point down: core <- superscript, core <- web <- chat-plugin, web <- react.
// `peers` are runtime libraries the host app supplies (only the react binding has one); everyone else may not import a UI framework.
// `dir` is the short id used by the build; `path` is where the package lives (grouped by role:
// packages/bindings/<framework>, packages/integrations/<host>).
export const SCOPE = '@supersolutions'
export const VERSION = '0.11.0'
export const AUTHOR = 'SUPER SOLUTION LABS INC'
export const LICENSE = 'GPL-3.0-or-later'
export const REPO = 'Super-Solution/super-chart'

/** entries: subpath -> [source file, output basename] */
export const PACKAGES = [
  {
    dir: 'core', path: 'packages/core', name: `${SCOPE}/super-chart-core`,
    description: 'Renderer-free chart core: market data, loader, indicators, drawings, frame and workspace models. No DOM.',
    deps: [],
    entries: { '.': ['src/index.ts', 'index'], './native': ['src/native.ts', 'native'], './indicators': ['src/model/indicatorCatalog.ts', 'indicators'], './sync': ['src/sync.ts', 'sync'] }
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
    additionalGlobals: [{ entry: 'src/engine.ts', file: 'super-chart.engine.global', name: 'SuperChartEngine' }],
    entries: { '.': ['src/index.ts', 'index'], './engine': ['src/engine.ts', 'engine'], './annotations': ['src/annotations.ts', 'annotations'], './overlays': ['src/overlayEntry.ts', 'overlays'], './sync': ['src/syncEntry.ts', 'sync'] }
  },
  {
    dir: 'react', path: 'packages/bindings/react', name: `${SCOPE}/super-chart-react`,
    description: 'React component and hooks for the Super Chart workspace: lifecycle-safe mount, Strict Mode, market and theme props, events.',
    deps: ['core', 'web'],
    peers: { react: '>=18' },
    entries: { '.': ['src/index.ts', 'index'] }
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
