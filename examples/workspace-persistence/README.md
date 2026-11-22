# Saving a workspace

> To keep drawings (or this envelope) on a server, use `DocumentSync` from `@supersolutions/super-chart-core/sync` and the [sync protocol](../../docs/SYNC-PROTOCOL.md): it adds a server-assigned revision, offline retry, a journal and conflict handling. `syncEnvelope` below is the smaller, older illustration of the same idea.

`workspace.exportDocument()` returns one JSON string (chart document version 1: market, candle mode, render options,
layout, indicators, drawings) that `workspace.restoreDocument(json)` accepts. The chart validates the whole document
before it changes anything, never stores code, layers, annotations or feed subscriptions, and loads the saved market
through your datafeed. That is the chart's half. The host's half is `persistence.ts` in this folder: copy it and keep what
you need.

| Step | What `persistence.ts` does | Why |
| --- | --- | --- |
| **Save** | `saveEnvelope` wraps the document with `savedAt`, a `revision` that only goes up and a `deviceId` | the chart's document has no author or order; sync needs both |
| **Upgrade** | `readEnvelope` reads schema 1 (older app) and upgrades it, returns `null` for corrupt text and `'newer-than-app'` for a schema it does not know | an older app must not overwrite a newer one's save, and corrupt storage must not crash startup |
| **Invalidate** | `restoreEnvelope` drops indicators the app no longer registers (reporting them) and refuses a market the app says is gone, before touching the chart | `restoreDocument` rejects a document with an unknown indicator as a whole |
| **Sync** | `syncEnvelope` against a `RemoteStore` with compare-and-set: pushes, pulls, retries when it lost a race, and reports `conflict` instead of merging | two devices that both changed need a person to choose |

Two distinct version numbers exist on purpose: the envelope's `schema` is yours to evolve; the inner document's `version`
belongs to the chart, which rejects versions it does not know with a clear error.

What is deliberately not saved: annotations and anything else the host writes (rebuild them from your own state after
`restoreDocument` resolves), the datafeed, registered indicators, commands and themes, and the person's drawings for
other markets (the workspace keeps those per market with `drawingCache`; see WORKSPACE-UI.md). `restoreDocument` resolves
`superseded` if the person changed market while it loaded, and `loaded` or `unchanged` when it applied.

```ts
// Save
const envelope = saveEnvelope(workspace, deviceId, readEnvelope(localStorage.getItem(KEY)) as Envelope | null)
localStorage.setItem(KEY, JSON.stringify(envelope))

// Restore
const stored = readEnvelope(localStorage.getItem(KEY))
if (stored !== null && stored !== 'newer-than-app') {
  const outcome = await restoreEnvelope(workspace, stored, { isMarketAvailable: market => tradable.has(market.ticker) })
}
```

`npm test` runs `persistence.test.ts` (envelope upgrade, repair, and every sync outcome including a lost race).
The React example (`../react`) wires Save and Restore buttons to these functions.
