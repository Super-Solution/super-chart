/// <reference types="vite/client" />
import { defineConfig } from 'vite'
import { entryFileName } from './scripts/entry-file-name.mjs'

const entries = {
  'super-chart': './src/index.ts',
  core: './src/core/index.ts',
  native: './src/native.ts',
  superscript: './src/superscript-entry.ts',
  indicators: './src/engine/indicatorCatalog.ts',
  scripts: './src/engine/scriptIndicators.ts',
  annotations: './src/engine/annotations.ts',
  overlays: './src/engine/overlayEntry.ts'
}

// One shared ESM graph; optional modules stay outside the default chart import.
// CJS/UMD are the same owned main API for consumers that need those formats.
export default defineConfig(({ mode }) => {
  const bundles = mode === 'bundles'
  return {
    build: {
      sourcemap: process.env.SC_SOURCEMAP === '1',
      emptyOutDir: !bundles,
      rollupOptions: { output: bundles ? { exports: 'named' } : {
        preserveModules: true, preserveModulesRoot: 'src',
        entryFileNames: (chunk: { name: string }) => entryFileName(chunk.name)
      } },
      lib: bundles ? {
        entry: './src/index.ts', name: 'SuperChart', formats: ['cjs', 'umd'],
        fileName: (format: string) => format === 'cjs' ? 'super-chart.cjs' : 'super-chart.umd.js'
      } : { entry: entries, formats: ['es'] }
    }
  }
})
