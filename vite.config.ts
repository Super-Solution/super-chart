/// <reference types="vite/client" />

import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import solidPlugin from 'vite-plugin-solid'

import { entryFileName } from './scripts/entry-file-name.mjs'
import { compactLocales } from './scripts/compact-locales.mjs'

// Two build passes (see "build-core" in package.json):
//
//   vite build                 ES modules for the three package entries, `.`
//                              (klinecharts-pro.js), `./lite` (lite.js) and
//                              `./superscript` (superscript.js), in ONE Rollup
//                              build with preserveModules. The entries share
//                              every module, so there is one SuperScript
//                              language registry and one copy of each figure,
//                              and a bundler can drop the modules a host does
//                              not use (see "sideEffects" in package.json).
//   vite build --mode bundles  The single-file `.` builds: klinecharts-pro.cjs
//                              (the `require` export) and klinecharts-pro.umd.js
//                              (script tags). Rollup cannot put several entries
//                              into one UMD file, so these stay separate.
//
// Source maps were ~68% of the packed tarball and no host ships them to
// browsers. SC_SOURCEMAP=1 builds them for local debugging.
const sourcemap = process.env.SC_SOURCEMAP === '1'

// The CSS file name is a contract: every host imports
// `@zzyzxlabs/super-chart/dist/klinecharts-pro.css` (and `./style.css` points at
// it). Vite 4 emits a library's CSS as "style.css"; pin the name here rather
// than depend on that.
const CSS_FILE = 'klinecharts-pro.css'
const assetFileNames = (asset: { name?: string }): string =>
  asset.name === 'style.css' ? CSS_FILE : 'assets/[name]-[hash][extname]'

// Compiled JSX imports its DOM helpers from this module instead of solid-js/web:
// src/solid-runtime.ts builds templates lazily and skips event delegation
// without a window, so importing the `.` entry does not need a DOM (SSR, Node).
const SOLID_RUNTIME = 'super-chart-solid-runtime'
const solid = (): Plugin => solidPlugin({ solid: { moduleName: SOLID_RUNTIME } })
const locales = (): Plugin => compactLocales(fileURLToPath(new URL('./src', import.meta.url)))

/** The second pass must not write the CSS again: the first pass owns it. */
const dropCss = (): Plugin => ({
  name: 'super-chart:drop-css',
  // After vite:css-post, which adds the CSS asset in its own generateBundle.
  enforce: 'post',
  generateBundle (_options, bundle) {
    for (const file of Object.keys(bundle)) {
      if (file.endsWith('.css')) {
        delete bundle[file]
      }
    }
  }
})

export default defineConfig(({ mode }) => {
  const bundles = mode === 'bundles'
  return {
    plugins: bundles ? [solid(), locales(), dropCss()] : [solid(), locales()],
    resolve: {
      alias: [{ find: SOLID_RUNTIME, replacement: fileURLToPath(new URL('./src/solid-runtime.ts', import.meta.url)) }]
    },
    build: {
      cssTarget: 'chrome61',
      sourcemap,
      emptyOutDir: !bundles,
      rollupOptions: {
        external: ['klinecharts'],
        output: bundles
          ? {
              assetFileNames,
              exports: 'named',
              globals: { klinecharts: 'klinecharts' }
            }
          : {
              assetFileNames,
              preserveModules: true,
              preserveModulesRoot: 'src',
              // Inlined dependencies (solid-js) go under dist/vendor/, wherever
              // node_modules resolves (see scripts/entry-file-name.mjs).
              entryFileNames: (chunk: { name: string }) => entryFileName(chunk.name)
            }
      },
      lib: bundles
        ? {
            entry: './src/index.ts',
            name: 'klinechartspro',
            formats: ['cjs', 'umd'],
            fileName: (format: string) => format === 'cjs' ? 'klinecharts-pro.cjs' : 'klinecharts-pro.umd.js'
          }
        : {
            entry: {
              'klinecharts-pro': './src/index.ts',
              lite: './src/lite.ts',
              superscript: './src/superscript-entry.ts',
              commands: './src/commands/schema.ts'
            },
            formats: ['es']
          }
    }
  }
})
