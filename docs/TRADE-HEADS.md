# Trade heads

Status: designed, not implemented. This document is the build plan.

A trade head is the avatar of the person who traded, drawn on the candle where
the trade happened, as meme-coin terminals do for a token's dev buys and sells.
Phones are the hard case: an 18px face covers about four candles at 360px.

The design reference is the concept page "交易頭像"
(https://claude.ai/artifact/CZqoRRx4zeqc98ccZGqn1i). It runs the placement
below on seeded data at phone and desktop width, beside a naive version on the
same trades. On its 9 phone-width trades the naive version covers 21 candles;
this design covers 0.

**The rule: the face says who, the ring says where.** A head never marks a
price. A small ring on the candle marks the exact trade price, and the head
sits clear of the candles with a tail pointing at that candle.

## Invariants

These are correctness requirements, not style. A wrong mark is false
information on a trading chart.

1. **Exact price.** Each trade's ring is drawn at its bar's x and its exact
   price. The trade's price must lie inside its bar's low–high range. If it
   does not, nothing is drawn for that trade and its status says why. It is
   never drawn at the nearest valid price.
2. **No candle is covered.** A buy head sits below, and a sell head above,
   the extreme of every candle under its full width (halo included), with an
   8px gap.
3. **No straight connector.** A vertical line from a head to a candle reads
   as a longer wick and makes the low look lower. One bar gets a tail
   triangle; several bars get a comb with one tooth per bar.
4. **Above every line.** Rings, heads and their tags paint in `paintLabels`,
   so they sit above the person's drawings and the assistant's lines.
5. **Deterministic.** The same trades, bars and viewport always give the same
   layout, whatever order the trades arrived in.

## Public API

A new opt-in entry, `@supersolutions/super-chart-web/trade-heads`, shaped like
`./annotations`: retained per symbol scope, with keyed replacement and per-entry
rejections.

```ts
export type TradeSide = 'buy' | 'sell'
export type TradePersonRole = 'dev' | 'self' | 'followed' | 'other'

export interface TradePerson {
  readonly id: string
  readonly name: string
  readonly role: TradePersonRole
  /** https: or data: image. Loaded with CORS; on failure the head shows a monogram. */
  readonly avatar?: string
  /** Monogram background when there is no usable avatar. */
  readonly color?: string
}

export interface TradeSpec {
  readonly key: string
  readonly person: string        // TradePerson.id
  readonly side: TradeSide
  readonly time: number          // exact trade time, ms
  readonly price: number         // exact trade price
  readonly amount?: string       // preformatted, shown only in the list
}

export interface TradeHeadsOptions {
  symbol: string | null
  theme?: 'light' | 'dark'
  /** Decimals for the exact price tags, as in EngineAnnotations. */
  pricePrecision?: number
  /** Roles that get a head. Others appear only in the host's list. */
  show?: Readonly<Record<TradePersonRole, boolean>>   // default dev, self, followed: true; other: false
  onChange?: () => void
}

export type TradeRejectCode =
  'bad_key' | 'duplicate_key' | 'unknown_person' | 'bad_side' | 'bad_time' | 'bad_price' | 'symbol_mismatch'

export class EngineTradeHeads implements EngineLayer {
  constructor (options: TradeHeadsOptions)
  setScope (symbol: string | null): void
  setTheme (theme: 'light' | 'dark'): void
  setPeople (people: readonly TradePerson[]): void
  setTrades (trades: readonly TradeSpec[], options?: { symbol?: string }): { applied: string[], rejected: Array<{ key: string, code: TradeRejectCode }> }
  setShow (show: Partial<Record<TradePersonRole, boolean>>): void
  /** Opens a pile: dims everything else and shows its rings filled. */
  focus (clusterKey: string | null): void
  /** One trade in the focused pile: its price on the axis and its second on the time axis. */
  select (tradeKey: string | null): void
  getSnapshot (): TradeHeadsSnapshot
  /** Required by the shared axis-tag solver, see "Axis and time tags". */
  axisTags (): readonly EngineAxisTag[]
  update (frame: EngineFrame): void
  paint (context: CanvasRenderingContext2D): void        // nothing; all marks are labels
  paintLabels (context: CanvasRenderingContext2D): void
  dispose (): void
}

export interface TradeHeadsSnapshot {
  readonly version: number
  readonly clusters: ReadonlyArray<{
    readonly key: string                 // `${side}:${sorted member keys}`
    readonly side: TradeSide
    readonly members: readonly string[]  // trade keys, newest first
    readonly faces: readonly string[]    // one or two person ids, front first
    readonly head: { x: number, y: number, r: number }
    readonly extent: { left: number, right: number, top: number, bottom: number }  // for hit targets and avoidance
  }>
  /** Every trade in scope with why it is or isn't drawn. */
  readonly trades: ReadonlyArray<{ key: string, status: 'visible' | 'hidden-role' | 'offscreen' | 'no-bar' | 'off-bar' | 'clipped' }>
}
```

Rejections happen at `setTrades` for malformed shape only. Whether a trade
fits its bar is decided at projection time, because history loads later and
the live bar's range keeps growing: until a matching bar exists the status is
`no-bar`, and a price outside the bar's range is `off-bar`.

The bar for a trade is the last loaded bar with `timestamp <= time`, provided
`time` is before the next bar's timestamp, or within one period for the last
bar. Otherwise the status is `no-bar`.

Export the bounds as a frozen object, as `ENGINE_ANNOTATION_LIMITS` does: 16
scopes, 2048 trades per scope, 512 people and 64 decoded avatars.

## Sizes

| Plot width | Head diameter D | Ring | Halo |
|---|---|---|---|
| < 480px | 18px | 2px side colour | 3.5px surface |
| ≥ 480px | 22px | 2px side colour | 3.5px surface |

The gap between a candle's extreme and a head's halo is `ZONE = 8px`. The tail
or comb lives in that gap. The side colours are `up` for a buy and `down` for a
sell, from `tokens.ts`.

## Placement

This runs in `update(frame)` for each side on its own. Sells go above the
candles and buys below.

1. Collect the visible trades whose role is shown. Their x is the bar's x.
2. Start one cluster per trade. A cluster's half width is
   `hw = r + HALO + (two faces ? r/2 : 0) + (more than one trade ? 3 : 0)`,
   where `r = D/2`. Its extent is the union of its trades' x and
   `mid ± hw`.
3. Sort the clusters by left extent. Sweep with a stack: push each cluster, and
   while the top two come within 2px of each other, merge them and recompute
   the merged extent. Test both ends of the extents, because a merge moves the
   midpoint and can move a cluster's left edge. The result must equal the
   concept page's fixed point (merge, re-sort, repeat until nothing
   overlaps). The concept's loop is quadratic, while the sweep is close to
   linear after the sort.
4. Head x: `cx = clamp(mid, hw + 2, plotRight - hw - 2)`, where mid is the
   midpoint of the cluster's trade x values.
5. Edge: over every plotted candle whose body or wick intersects
   `[min(minX, cx - hw), max(maxX, cx + hw)]`, take the highest high for sells
   or the lowest low for buys. Use the frame's plotted candles, not the trades'
   own bars, because the head is wider than its bars.
6. Head y: `edge ∓ (ZONE + r + HALO)`, above for sells and below for buys.
7. If the head plus halo leaves the price pane, the cluster is not drawn and
   its trades get the status `clipped`. This only happens when the person has
   set a manual price range, as the next section explains.
8. Faces: sort the members by role rank (dev 0, self 1, followed 2,
   other 3), then by newest time. Take the first two distinct people.

Same-bar piles and multi-bar piles differ only in the connector.

## Room on the price scale

Without reserved room, a head at the visible high or low would leave the pane.
Add an inset to the core price scale:

```ts
// packages/core/src/model/priceScale.ts
export interface PriceScaleOptions {
  mode?: PriceScaleMode
  reversed?: boolean
  range?: readonly [number, number]
  /** CSS px kept free above the highest and below the lowest auto-fit price. Ignored with `range`. */
  inset?: { readonly top: number, readonly bottom: number }
}
```

`rescale` in `frame.ts` passes `geometry.top + inset.top` and
`geometry.bottom - inset.bottom` to `createPriceScale`. The pane's geometry and
clip stay full size, so the heads in the inset are still inside `bounds`. The
existing 8% value padding stays.

The layer exports `tradeHeadInset(plotWidth)`, which returns
`ZONE + 2 * (r + HALO) + 4` (37px at D = 18). The host sets it with
`chart.setLayout` when it adds the layer, and keeps it constant while the
layer is attached, so turning a role on or off never rescales the chart.

## Painting

Everything paints in `paintLabels`, clipped to the price pane, in this order:

1. **Rings, one per visible trade**, at `(bar x, Y(price))`:
   - normal: a surface disc of r 4.5, a side-colour disc of r 3.5, and a
     surface disc of r 2 (an outlined dot);
   - in the focused pile: a surface disc of r 6 and a side-colour disc of
     r 4.5 (filled);
   - outside the focused pile: alpha 0.28.
2. **Clusters.** Draw each cluster in this order: the connector, then the back
   face, then the front face, then the count badge. Clusters outside the focus
   use alpha 0.28.
   - **Tail (one bar):** a triangle with a 9px base on the head's halo edge.
     The base is clamped to `cx ± (r - 4)` and its tip sits 2px short of the
     edge, at the bar's x. Stroke it 3px in surface colour (round join), then
     fill it in the side colour.
   - **Comb (several bars):** a horizontal 1px line at
     `cy ± (r + HALO + 2.5)`, spanning from the leftmost to the rightmost
     member x. Add a 3.5px tooth toward the candles at each member's bar, and
     a 1px stem from the head to the line. First draw everything 3px wide in
     surface colour, then 1px in the side colour.
   - **Face:** a surface disc of `r + HALO`, a side-colour disc of `r + 2`,
     and the avatar clipped to a circle of r. With two faces, the back face
     sits at `cx - r/2` and the front face at `cx + r/2`.
   - **Count badge**, only when a cluster has more than one trade: an ink
     pill at the front face's outer corner, `(cx + off + 0.72r, cy ∓ 0.72r)`.
     It is 13px high, at least 13px wide, with a mono 600 9px count in surface
     colour and a 1.5px surface outline.

`paint` on the main canvas draws nothing. Heads must not land under the
person's drawings.

## Axis and time tags

When a pile is focused, each member's exact price gets a tag on the price
axis in its side colour. Once a row is selected, only that trade keeps its
tag. The selected trade's `hh:mm:ss` also appears as an ink pill on the time
axis, and time labels within 52px of it are hidden.

The price tags must share one placement with the annotation tags. Today
`EngineAnnotations.paintLabels` places its own tags. If two layers each placed
their own, a trade tag and a level tag could land on the same pixels. So:

- Add `axisTags?: () => readonly EngineAxisTag[]` to `EngineLayer`, where
  `EngineAxisTag` is `{ y, price, color, fill?: boolean }`.
- Move the solver out of `annotations.ts` into the chart and keep its current
  rules. The last-price tag never moves. Other tags stay 25px apart and move
  the least distance needed, with a connector to their exact y. Each tag
  clears the axis 15px on either side, so a grid label is hidden rather than
  half covered.
- The chart paints every layer's tags once, after all `paintLabels`.
  `exportPng` does the same.

## The assistant's chips avoid heads

`EngineAnnotationsOptions` gains `avoid?: () => readonly Rect[]`. The host
passes the extents of the trade-head clusters and a 10px box around each
ring. A level's chip starts at the left end of its line and slides right in
4px steps until it clears every box, or reaches the right end. It stays on
its own line, so it still names the right price.

Add the trade-heads layer before `EngineAnnotations`, so the chips paint above
the heads. Every layer's `update` runs before any `paint` (see `chart.ts`), so
the snapshot that `avoid` reads is current.

## Hit targets and the list

The engine draws; the host owns the list UI.

`attachTradeHeadTargets(root, layer, { onOpen, label })` keeps one transparent
`<button>` per visible cluster, positioned from the snapshot. Each button is
at least 40×40px and centred on the head. Where two buttons would overlap,
each shrinks to the midpoint between the heads. The `aria-label` names the
side, the count and the people, for example "3 筆買入：mochi.dev、你、阿哲".
The tab order runs left to right. Escape closes the list and returns focus to
the button.

`gestures.ts` already ignores pointer events whose target is a button. A tap
on a head therefore opens the list instead of panning, but a drag that starts
on a head does not pan the chart. Check this on a phone before deciding
whether it needs a tap recognizer in `gestures.ts` instead.

The list, built by the host (for example the workspace or chat-plugin):

- **Phone (container < 600px):** a bottom sheet.
- **Wider:** a popover beside the head, flipped to stay inside the chart.
- **Each row:** the avatar, the name, a role tag, `hh:mm:ss`, ▲ or ▼ with the
  side word and the amount, and the exact price in mono.
- **Selecting a row:** calls `layer.select(key)`; selecting it again
  deselects it.
- **On open:** call `layer.focus(cluster.key)` and focus the first row.

## Avatars

- Fetch the avatar with `mode: 'cors'`, then call `createImageBitmap(blob, { resizeWidth: 2·D·dpr, resizeHeight: same })`.
  Do not use an `<img>` without CORS: a cross-origin image taints the canvas,
  and `exportPng` then fails in `toBlob`.
- Cache at most 64 decoded avatars, least recently used first out, and close
  each bitmap when it is evicted.
- While an avatar is loading, or after it fails, show a monogram instead: the
  first grapheme of the name (`Intl.Segmenter`), on `person.color` or
  `inkMuted`. Never show an empty circle.
- When a decode finishes, call `onChange`, which repaints without rebuilding
  the geometry.

## Files

| File | Change |
|---|---|
| `packages/core/src/model/priceScale.ts`, `frame.ts` | `inset` option, applied in `rescale` |
| `packages/bindings/web/src/layer.ts` | `axisTags` hook |
| `packages/bindings/web/src/chart.ts` | shared axis-tag solver, painted after all `paintLabels` and in `exportPng` |
| `packages/bindings/web/src/annotations.ts` | tags through `axisTags`; `avoid` option for chips |
| `packages/bindings/web/src/tradeHeads.ts` | new: `EngineTradeHeads`, `tradeHeadInset` |
| `packages/bindings/web/src/tradeHeadTargets.ts` | new: `attachTradeHeadTargets` |
| `packages/bindings/web/package.json` | `./trade-heads` export next to `./annotations` |
| `demo/showcase.ts` | seeded people and trades, so both themes show heads |
| `docs/PACKAGES.md` | the new entry |

## Validation

Follow AGENTS.md. Run `npm run typecheck`, `npm run lint` and `npm test`.
Typecheck currently reports one pre-existing error, the missing private
`@supersolutions/super-protocol` package, and the errors that cascade from it.
Ask the owner before adding any test, assertion, fixture or snapshot.

Manual observations to record here once the layer is built:

- Overlap: at 360px, measure in a dev script that no head disc (halo
  included) intersects a candle's body or wick, on the concept's 9 trades and
  on a dense random set.
- Every drawn ring's y equals `Y(price)` to the pixel, and every price tag
  shows the trade's exact price.
- Edge cases: trades on the first and the last visible bar (head clamped,
  tail still on the bar); a trade at a bar's exact high or low; a manual price
  range (`clipped`); zooming out to 1px bars (combs, no overlap); the live
  bar's range growing after a trade arrives.
- Light and dark themes, and `exportPng` with avatars from a CORS host and a
  non-CORS host (the second falls back to a monogram and the export still
  succeeds).
- Phone: a tap opens the sheet, the focus and selection tags appear, and
  Escape restores focus.

## Open decisions

- Which roles get a head by default. Large wallets ("whales") are currently
  list-only.
- Whether a drag that starts on a head should pan the chart. Answering yes
  needs a tap recognizer in `gestures.ts` in place of the buttons.
- Whether the list UI lives in the workspace package or stays with each host.
