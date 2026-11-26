# Examples

Runnable code we have written to try the library, and to show others how to use it. **Nothing in this folder is
published**: it is not an npm workspace, every example manifest is `"private": true`, and each package ships only
`dist/` (`npm run build` fails otherwise, see `scripts/check-package.mjs`). They run against the sources in this
checkout, so they show your change before it is built or released.

```bash
npm install
npm run examples          # opens /examples/ : one page that links to every example
```

Each example is also a plain URL on the same dev server (`npm run dev`, then `/examples/<name>/index.html`).

| Example | Target | What it is |
| --- | --- | --- |
| [`playground`](playground/README.md) | web | every look and behaviour switch in one page and the pre-release checklist: **run this after a change** |
| [`vanilla`](vanilla/main.ts) | web | the smallest mount, one drawing and one host layer |
| [`react`](react/README.md) | react | `<SuperChart>` under Strict Mode, props, events, host annotations, saving |
| [`datafeed-http`](datafeed-http/README.md) | node + web | a `Datafeed` over the HTTP contract and a server for it |
| [`workspace-persistence`](workspace-persistence/README.md) | any | save, upgrade and restore a workspace (no UI; has tests) |

`_shared/feed.ts` is the one mock data source: deterministic history, a ticking last bar, and six markets
(`EQUITY`, `SESSION` with a New York trading schedule, `COIN`, `FX`, plus `EMPTY` and `BROKEN` for the empty and error states). It touches no DOM and no browser
global, so any host can use it. Use `MARKETS` where an example should simply show a chart.

## Targets

The chart engine is a canvas owned by `@supersolutions/super-chart-web` and has no UI framework, so a framework
example is only the mount and unmount around it. What exists today:

| Target | Supported by the library | Example |
| --- | --- | --- |
| Web, no framework | yes: `new SuperChart(container, options)` | `vanilla`, `playground` |
| React (and Next.js, client side) | yes: `@supersolutions/super-chart-react`, Strict Mode and SSR safe | `react` |
| Vue, Svelte, Angular, Solid, … | through the web binding, no wrapper package: create in the mount hook, `dispose()` in the unmount hook, one datafeed object for the app | none yet (add one when someone needs it, see below) |
| React Native / Expo | **not yet**: `@supersolutions/super-chart-core/native` gives the data loader and app-state lifecycle ([NATIVE-LIFECYCLE](../docs/NATIVE-LIFECYCLE.md)), but there is no native view or gesture layer | none: an example would have to fake the part that is missing |

A target is listed as supported only when it ships and is tested; an example for a target that is not supported yet
is not written ahead of the support.

## Add an example

1. Make `examples/<name>/` (lower-case, named for what it shows, not the framework alone).
2. Use `../_shared/feed.ts` for data. If you need a new market or a failure mode, add it there so every example gets
   it, rather than writing a second feed. Real network data belongs in its own example (see `datafeed-http`).
3. Import only the public entries (`@supersolutions/super-chart-*`), never `packages/*/src`. The root Vite config maps
   them to the sources while you develop; `package.json` for a standalone copy points them at `file:../../packages/…`.
4. Give it `index.html` (so it has a URL), and a `README.md` whose first lines say the **target**, how to run it
   and what it demonstrates.
5. If it is a new target, add a manifest with `"private": true` and a `tsconfig.json`, and add a row to the tables here.
6. Add it to `index.html` in this folder.
7. Keep it small and honest: no placeholder data that suggests a capability the library lacks, no host-specific
   (app) code. If an example needs a workaround, that is a library gap: fix the library.

## Before a release

Run `npm run examples` and walk the **playground checklist** (it keeps a ticked list per version) and open `react`.
A release is not ready while an example fails to mount, the playground's error counter is above 0, or an example
needs a change that was not made to the library.
