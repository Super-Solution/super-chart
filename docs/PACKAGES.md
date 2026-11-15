# Packages and layers

Dependencies only point down. `scripts/check-package.mjs` enforces it on every
build: a package may import only the packages it declares, in source and in `dist`.

```
super-chart-react ───────┐
super-chart-chat-plugin ─┴─> super-chart-web ──────┐
        │                                          ├─> super-chart-core
        └─> super-protocol (Apache-2.0, super-chat)│
                         super-chart-superscript ──┘
```

| Package | Contents | Runs in |
| --- | --- | --- |
| `super-chart-core` | `src/*` market data, loader, series, TA, viewport; `src/model/*` frame, indicators, drawings, price scale, workspace state and persistence, replay, countdown, overlays model; `src/analysis/*` detectors; `src/platform/native` lifecycle | Node, browser, React Native, workers |
| `super-chart-superscript` | `runtime/*` language, builtins, diagnostics; `ai/*` host-supplied AI helpers; `scripts` bridge from a compiled script to an engine indicator | Node, browser |
| `super-chart-web` | Canvas renderer, gestures, drawing input, image decode, workspace UI, annotation and overlay layers | browser |
| `super-chart-react` | `SuperChart` component and `useWorkspaceEvent`; a thin binding over the web workspace (React is a peer dependency, `react >= 18`) | browser, server render safe |
| `super-chart-chat-plugin` | the `super-chart.chart` card and seven agent tools | browser (chat host) |

Split rule: a new package only for a different runtime, licence, language, heavy
dependency or release cadence; otherwise a subpath export.

## Old imports to new

| 0.0.x / PR #20 (`@super-solution/super-chart`) | Now |
| --- | --- |
| `.` (`SuperChart`, `EngineChart`, `ChartWorkspace`, models) | `super-chart-web`; the models (`DrawingStore`, `EngineIndicators`, `buildEngineFrame`, …) come from `super-chart-core` and are re-exported where they were before |
| `/core` | `super-chart-core` |
| `/native` | `super-chart-core/native` |
| `/indicators` | `super-chart-core/indicators` |
| `/superscript` | `super-chart-superscript` |
| `/scripts` | `super-chart-superscript/scripts` |
| `/annotations` | `super-chart-web/annotations` |
| `/overlays` | `super-chart-web/overlays` |
| a React wrapper written by the host | `super-chart-react` (`SuperChart`) |
| `DefaultDatafeed` | removed; implement `Datafeed` |

`super-chart-core` root now includes the renderer-free engine model that used to
sit behind `/native` only, so one import covers a worker or an agent.

## Licences

All five packages are GPL-3.0-or-later (commercial licence available). The plugin
interface is Apache-2.0 in `@supersolutions/super-protocol`, which the plugin
imports; nothing in an Apache layer imports these packages. The `Datafeed`,
`MarketBar`, `SymbolInfo` and `Period` types in `super-protocol/chart` are
structurally identical to core's, and the plugin carries a compile-time check
that they stay assignable.

`super-chart-react` is the only package allowed a UI-framework dependency, and only
as a declared `peerDependency`; `scripts/check-package.mjs` still rejects any
other import of React, Solid, Vue or KLineChart. Adding another framework means
another folder under `packages/bindings/`, not an option on this package. For
what belongs to which layer see [API-LAYERS.md](API-LAYERS.md).

## Open items

* `@supersolutions/super-protocol@0.1.0` is not on npm yet. Until its separate
  release, [the explicit local setup](LOCAL-DEVELOPMENT.md) builds the real
  sibling protocol package and installs it without rewriting the published
  dependency or saving a machine-specific lockfile. Registry-only `npm install`
  remains unavailable; publish protocol first, then create `package-lock.json`.
* The old UMD/CJS bundles are gone: packages are ESM only. `super-chart-web` also ships
  `dist/super-chart.global.js`, a self-contained script that sets `window.SuperChart`
  (core included) for pages without a bundler.
