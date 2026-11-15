import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const src = (path: string): string => fileURLToPath(new URL(path, import.meta.url))

// Existing portable correctness cases for the owned API; no case or assertion
// was added by the package split.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@supersolutions\/super-chart-core\/native$/, replacement: src('./packages/core/src/native.ts') },
      { find: /^@supersolutions\/super-chart-core\/indicators$/, replacement: src('./packages/core/src/model/indicatorCatalog.ts') },
      { find: /^@supersolutions\/super-chart-core$/, replacement: src('./packages/core/src/index.ts') },
      { find: /^@supersolutions\/super-chart-superscript\/scripts$/, replacement: src('./packages/superscript/src/scripts.ts') },
      { find: /^@supersolutions\/super-chart-superscript$/, replacement: src('./packages/superscript/src/index.ts') },
      { find: /^@supersolutions\/super-chart-web\/annotations$/, replacement: src('./packages/bindings/web/src/annotations.ts') },
      { find: /^@supersolutions\/super-chart-web\/overlays$/, replacement: src('./packages/bindings/web/src/overlayEntry.ts') },
      { find: /^@supersolutions\/super-chart-react$/, replacement: src('./packages/bindings/react/src/index.ts') },
      { find: /^@supersolutions\/super-chart-web$/, replacement: src('./packages/bindings/web/src/index.ts') }
    ]
  },
  test: {
    environment: 'node',
    include: [
      'packages/**/src/**/*.test.ts',
      'examples/*/*.test.ts'
    ]
  }
})
