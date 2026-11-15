# Native lifecycle bridge, phase 3 (private candidate 0.0.43)

PR #2 was normally merged at 85c19bfbe5b53eba82f467488f5b3c66f1f6710e. This phase adds opt-in native lifecycle wiring in the private Super-Solution/super-chart repository. The original monorepo and deployed applications are unchanged.

## Host integration

The native entry still exports the same shared DataLoader as core. New createNativeDataLoader and createNativeEnvironment factories accept a structural AppState interface; they do not import react-native or NetInfo. Rendering and gesture handling stay in the host.

```ts
import { AppState } from 'react-native'
import { createNativeDataLoader } from '@supersolutions/super-chart-core/native'

const loader = createNativeDataLoader({
  datafeed,
  appState: AppState,
  // Optional host callback: emit only an actual reconnect transition.
  subscribeReconnect: onReconnect
})
loader.attach(chartPort)
loader.request(symbol, period)
// On component teardown:
loader.dispose()
```

The host supplies datafeed, chartPort, symbol, period and optionally onReconnect. Use the core ChartDataPort contract to adapt an existing native view; this package supplies neither an RN view nor gestures. The example illustrates the candidate API, not an installed package release.

AppState active maps to visible. Inactive, background and unknown/null map to hidden. Repeated hidden-state notifications do not reset the background timestamp or reschedule frames. An initially hidden attachment records its background time. The adapter subscribes lazily when the loader attaches and removes the native subscription after its final listener is removed on dispose. Sharing one environment across loaders shares the underlying lifecycle subscription.

Global requestAnimationFrame/cancelAnimationFrame are used when available, with injectable scheduler overrides for other hosts. The existing coalescer uses its timer path while hidden. No native dependency, polling timer or independent feed subscription is added by this bridge. Reconnect wiring is optional and owned by the host: do not pass every network-status notification as a reconnect.

Resume follows the existing shared loader policy: shown data is resynchronized after a background interval of at least one chart period. This does not promise recovery of every failure on foregrounding. In particular, an initial load that timed out while backgrounded still needs retry/reload or an actual reconnect; reconnect reloads an error state and resynchronizes other states. Core retry, abort, subscription, replay and request-generation rules are unchanged.

## Validation and limits

- All 84 existing loader cases passed through a temporary local resolver bridge that exercised the native environment using the existing fake clock, frames, visibility and online signals. No tracked tests, cases, assertions or fixtures were added or changed; the bridge is not packaged or committed.
- Manual lifecycle observation: two visibility listeners shared one AppState subscription; initial background notification plus foreground transition delivered two notifications per listener, with inactive/background duplicates suppressed. One reconnect notification was delivered. Removing the listeners returned AppState and reconnect subscription counts to zero. The factory constructed/disposed with document/window absent.
- TypeScript, Web/core/native compilation and generated declarations passed. The existing package checker initially rejected 776,223 packed bytes against its 775,000-byte backstop. The small new adapter/declarations account for the increase; no runtime dependency or source map was added. The existing allowance is now 780,000 bytes. Final package/consumer check passed: 309 files, 776,223 bytes. Scoped native-entry/adapter lint passed with no errors or warnings. Plain Node imported the built native/core entries and constructed/disposed the native factory with no document/window; both retain the same DataLoader class.
- No new pipeline, hosted checks, package publication, repository visibility change, phone/device acceptance or old-app adoption. This is an integration boundary, not a measured device performance gain.

Next stage: opt a real Web/RN host into these ports, profile actual devices and only then select further compute/render optimizations. That adoption needs a separate change in its owning application; it has not been applied to the old monorepo here.
