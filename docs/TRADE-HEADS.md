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
   layout, whatever order the trades arrived in. Panning never regroups a
   pile; only zooming does.
6. **Bounded by width, not by load.** The number of heads depends on the plot
   width alone. A busy hour of 8,000 trades draws as many piles as 800 do,
   and the count badge and the list carry the rest.

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
  /** Opens a pile into balloons (see "Opening a pile"); null closes it. */
  focus (clusterKey: string | null): void
  /** One person in the open pile: their balloon, rings, tags and string stand out. */
  choose (personId: string | null): void
  /** One trade in the open pile: its price on the axis and its second on the time axis. */
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

This runs in `update(frame)`, separately for each side. Sells go above the
candles and buys below. The number of piles depends on the plot width, not on
the number of trades.

The first version merged neighbouring piles whenever their heads touched.
That failed under load. In a busy hour (800 trades, every wallet shown, 360px
wide) it put each side into one pile of up to 354 trades spanning all 96 bars, so
the head no longer said where anything happened. At 800 trades with the
default roles, two heads also overlapped at the plot edge. The rules below
replace it.

**Reach.** Use `r = D/2`. A pile reaches `L = off + r + HALO` to the left of
its centre, where `off = r/2` with two faces and 0 with one. To the right it
reaches the larger of the same value and the count badge's outer edge,
`off + 0.72r + badgeWidth/2 + 1.5`. The pitch is the widest a pile can be
(two faces and a "99+" badge) plus `GAP = 2px`. That is 43px at D = 18.

**Bars per pile.** With `n` visible bars:

```
per = ceil(n * pitch / (plotWidth - 4 - 2 * pitch))
```

The formula covers the worst case. `n` bars hold at most `n / per + 2` piles
(one cut off at each edge), and that many piles at full pitch must fit the
plot. `per` changes only when you zoom.

Steps:

1. **Group.** Take every trade in scope whose role is shown, not only the
   visible ones, sorted by time. A trade joins the current pile of its side
   while it is within `per` bars of that pile's first trade; otherwise it
   starts the next pile. Grouping over all trades means that panning never
   regroups. Cache the groups by `per`, the filters and the trade revision.
2. **Keep** the piles that have at least one trade in view.
3. **Faces.** Sort each pile's trades by role rank (dev 0, self 1, followed 2,
   other 3), then by size, then by newest. The first two distinct people are
   the faces, and their first trade in that order is each face's
   representative trade.
4. **Head x.** Start at the midpoint of the pile's visible trade x values.
   Then space the heads in a forward pass and a backward pass:
   - Forward, left to right: `cx >= L + 2`, and `cx >= prev.cx + prev.R + GAP + L`.
   - Backward, right to left: `cx <= plotWidth - R - 2`, and `cx <= next.cx - next.L - GAP - R`.

   Thanks to `per`, the piles always fit, so this ends without overlap. As a
   safety net, if a check still fails, fold the first failing pile into its
   neighbour and repeat; in the stress runs this never happened.
5. **Edge.** Over every plotted candle whose body or wick intersects
   `[min(minX, cx - L), max(maxX, cx + R)]`, take the highest high for sells or
   the lowest low for buys. Use the frame's plotted candles, not the trades'
   own bars, because the head is wider than its bars.
6. **Head y.** `edge ∓ (ZONE + r + HALO)`: above the edge for sells, below it
   for buys.
7. **Clipping.** If the head plus halo leaves the price pane, the pile is not
   drawn and its trades get the status `clipped`. This only happens when the
   person has set a manual price range, as the next section explains.

The cluster key is `${side}:${firstBarIndex}-${lastBarIndex}`. It stays the
same while panning, so an open pile stays open.

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

1. **Rings** at `(bar x, Y(price))`. A ring belongs to a face. At rest, only
   each pile's representative trades get a ring, at most two per pile.
   Otherwise a busy bar would be buried under its own rings. When a pile is
   open, ring every trade in it if there are 12 or fewer. Otherwise ring its
   representative trades plus the selected trade.
   - normal: a surface disc of r 4.5, a side-colour disc of r 3.5, and a
     surface disc of r 2 (an outlined dot);
   - in the focused pile: a surface disc of r 6 and a side-colour disc of
     r 4.5 (filled);
   - outside the focused pile: alpha 0.28.
2. **Clusters.** Draw each cluster in this order: the connector, then the back
   face, then the front face, then the count badge. Clusters outside the focus
   use alpha 0.28.
   - **Tail:** used when the pile has one bar and that bar is within `r - 4`
     of the head's x. Draw a triangle with a 9px base on the head's halo edge.
     The base is clamped to `cx ± (r - 4)` and its tip sits 2px short of the
     edge, at the bar's x. Stroke it 3px in surface colour (round join), then
     fill it in the side colour. A single-bar pile that the spacing pushed
     sideways gets the comb instead, so the tail never slants far.
   - **Comb:** a horizontal 1px line at
     `cy ± (r + HALO + 2.5)`, spanning from the leftmost to the rightmost
     member x. Add a 3.5px tooth toward the candles at each bar that holds a
     trade, and a 1px stem from the head to the line. When the pile covers
     more than 8 bars, draw teeth only at the first and last bar: that many
     teeth read as a ruler. First draw everything 3px wide in surface colour,
     then 1px in the side colour.
   - **Face:** a surface disc of `r + HALO`, a side-colour disc of `r + 2`,
     and the avatar clipped to a circle of r. With two faces, the back face
     sits at `cx - r/2` and the front face at `cx + r/2`.
   - **Count badge**, only when a cluster has more than one trade: an ink
     pill at the front face's outer corner, `(cx + off + 0.72r, cy ∓ 0.72r)`.
     It is 13px high, at least 13px wide, with a mono 600 9px count in surface
     colour and a 1.5px surface outline. Counts above 99 read "99+"; the list
     gives the exact count.

`paint` on the main canvas draws nothing. Heads must not land under the
person's drawings.

## Axis and time tags

When a pile is focused, the price axis tags the exact prices in the side
colour. A pile of up to 3 trades tags all of them. A larger pile tags only
its representative trades, since 40 tags would push each other far from their
prices. Once a row is selected, only that trade keeps its tag. The selected trade's `hh:mm:ss` also appears as an ink pill on the time
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
- **Header:** the exact count (for example "1,659 筆買入"), even when the badge
  reads 99+, and the pile's time range.
- **Order:** Dev first, then you, then followed wallets, then everyone else.
  Within each group, rows are in time order. In a pile of 1,659 trades, the
  ones you care about would otherwise be on page 20.
- **Rendering:** rows render 60 at a time as the list scrolls, using an
  `IntersectionObserver` sentinel. The stress run opened a 1,659-row pile this
  way.
- **Each row:** the avatar, the name, a role tag, `hh:mm:ss`, ▲ or ▼ with the
  side word and the amount, and the exact price in mono. A wallet with no
  name shows its shortened address in mono.
- **Selecting a row:** calls `layer.select(key)`; selecting it again
  deselects it.
- **On open:** call `layer.focus(cluster.key)`, which opens the pile into
  balloons, and focus the first row.
- **Choosing a balloon:** call `layer.choose(personId)` and filter the list
  to that person.

## Opening a pile

Tapping a pile opens it on the chart. The heads were a social feature from
the start, so opening a pile gives every person in it their own head, tied
to the candle where they traded. The concept page has this on all three live
charts and in a still under "把一疊展開".

**What recedes:**
- The bars outside the pile's range fade to alpha 0.25 and, where
  `CanvasRenderingContext2D.filter` exists, blur by 1px. This applies to both
  candles and volume.
- A wash marks the pile's own bars.
- Every other pile shrinks to a 3px dot at alpha 0.4.

**Balloons:**
- **One per person.** A person with several trades in the pile gets a single
  balloon with a count badge. Their representative trade is their largest
  one in view.
- **Order:** Dev, then you, then followed wallets, then everyone else. Within
  each group, the larger total amount goes first.
- **Cap:** at most 23 balloons on a phone and 39 on desktop. The people who
  don't fit share one "+N" balloon, and the list holds all of them.
- **Placement:** candidate centres sit on a hex grid anchored at the pile's
  head, spaced `2(r + HALO) + 3`. A candidate is dropped if its halo comes
  within 1px of any of these:
  - the pile's own candles, from `Y(high) - ZONE` to `Y(low) + ZONE` across
    its bars;
  - an open panel (on desktop, the popover);
  - the plot's edges.

  The remaining candidates are sorted by distance from the head. Candidates
  on the candle side of the head count 1.8 times their distance, so the
  bouquet grows outward first. The highest-ranked person gets the nearest
  slot.
- **What balloons may cover:** they never cover the pile's own candles or
  rings. They may cover the receded bars elsewhere; this is a temporary,
  explicit state, and those bars come back when the pile closes.
- **Strings:** a 1px string in the side colour runs from each balloon to a
  knot on the tie line (`cy ± (r + HALO + 2.5)`), at the x of that person's
  representative bar. A balloon on the head's side leaves sideways and drops
  onto the knot: `quadraticCurveTo(tx, by, tx, ty)`. A balloon beside the
  pile rises first: `quadraticCurveTo(bx, ty, tx, ty)`. Either way, no string
  runs down a wick or crosses the pile's candles. The tie line has a tooth on
  each knotted bar, up to 8 bars.
- **Motion:** see "Springs" below. Under reduced motion every balloon
  appears in place and closing is immediate.

### Springs

Every animated value is a damped spring solved in closed form:
`x(t) = to + e^(-ζω₀t)(A cos ω_d t + B sin ω_d t)`, with `ω₀ = 2π / response`.
It is not stepped per frame. That gives two properties:

- A balloon lands on the same curve at 60, 120 or 144 Hz.
- Any spring can be retargeted mid-flight from its current value and
  velocity.

Retargeting is what makes the motion feel like iOS. Close a pile halfway
through its pop, then tap it again, and the balloons turn around from where
they are, at the speed they had.

| Value | response | damping | Notes |
|---|---|---|---|
| Balloon position | 0.44s | 0.74 | from the pile's head; a wave with 11ms between balloons, capped at 180ms |
| Balloon scale in | 0.38s | 0.58 | 0.2 to 1, a visible overshoot |
| Balloon opacity | 0.2s | 1 | never overshoots; an overshoot on opacity flickers |
| Chosen balloon | 0.34s | 0.56 | to 1.18 |
| Press / hover | 0.16s / 0.34s | 1 / 0.56 | press sinks to 0.9 without bounce; hover (mouse only) lifts to 1.07 |
| Background recede | 0.36s | 1 | cross-fades the opened chart over the closed one |
| Close | 0.3s position, 0.28s scale | 0.9 / 1 | back into the head, scale to 0.2, opacity to 0 |

Two cues make motion read as smooth even when frames drop:

- **Stretch:** a balloon stretches along its velocity, by up to 16% at
  3,200 px/s, then rounds out as it lands.
- **Trailing strings:** each string's control point trails the balloon by
  45ms of its velocity (at most 40px), so strings bend while balloons fly and
  pull straight as they land.

Count badges fade in only as their balloon slows below 500 px/s, so no
numbers fly around mid-pop.

**Frame cost:** an open pile keeps two cached bitmaps of the chart, one at
rest and one opened (without balloons). Each frame copies both, cross-faded,
and paints only the strings and balloons. Nothing else is laid out or drawn
during the animation. On the concept page's 8,000-trade hour, a frame took
0.31ms on average and 0.9ms at most for 23 balloons (desktop Chromium). That
is far inside the 8.3ms a 120 Hz frame allows. Hit targets are rebuilt once
per state change, never per frame.

**The sheet and the popover** use the same springs as CSS `linear()` curves,
sampled at 49 points until the spring settles:

- The sheet rises with response 0.5 and damping 0.8, and drops back with
  response 0.32 and damping 1.
- The popover's scale springs from the corner nearest the pile, while its
  opacity eases separately.
- The `linear()` curves are applied only after
  `CSS.supports('transition-timing-function', 'linear(0, 1)')`; older
  browsers keep the cubic-bezier.

**Choosing a person:**
- **On the chart:** their balloon grows by 18% and gets an ink ring; the
  other balloons and strings fade. Each of their trades gets a filled ring at
  its exact price.
- **Axis tags:** their price tags follow the usual rule (all of them up to 3,
  otherwise the representative), and the time axis shows their
  representative's second.
- **The list:** it switches to their trades in time order. The title reads
  "Nori 的 3 筆賣出" ("Nori's 3 sells"; no space after a Chinese name), and a
  "全部 N 筆" (all N trades) button returns to the whole pile. Choosing the
  same balloon again, or that button, clears the choice.
- **Whole-pile list:** it puts Dev, you and followed wallets first, so your
  own trades are never buried even before you choose your balloon.

**Closing:** tap empty chart, press Escape, or close the list; focus returns
to the pile's button.

**Desktop popover:** it docks in the top corner away from the pile; the
right corner unless the pile leaves no room there. Its rect is passed to the
balloon placement as a region to avoid.

**Targets:** one button per balloon, the size of its grid slot (28px at
D = 18), labelled "Nori，3 筆賣出" (Nori, 3 sells). The "+N" button focuses
the list. The open pile's own button is removed, and the other piles keep
theirs, so tapping a dot switches to that pile.

**Concept-page check:** the biggest pile was opened on each live chart, in
both themes. On the stress chart that pile held 159 trades and 115 people,
which gave 23 balloons plus "+92". In every case, no balloon overlapped the
pile's candles, the panel, another balloon or the plot edge. Every string
ended at its person's bar. Choose, back and Escape all worked.

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

### Stress run of the design (concept page, 2026-11-16)

This ran on the concept page in headless Chromium, not in the engine. The
data is one seeded busy hour of 120 one-minute bars and 420 wallets at three
sizes: 80, 800 and 8,000 trades. The phone view shows 96 bars at 360px; the
desktop view shows 120 bars at 720px. Three placements were compared:

- **stack:** one head per trade, stacked up from the bar's high, as in common
  meme-coin terminals;
- **merge:** the first version of this design;
- **this design:** the rules above.

Phone, 360px, with every wallet shown. The first number in each cell is
covered candles, the second is heads that cannot fit:

| Trades | stack | merge | this design |
|---|---|---|---|
| 72 / 80 | 80 of 96 covered, 0 off-plot | 0, 0 | 0, 0 |
| 661 / 800 | 96 of 96 covered, 139 off-plot | 0, 0 (2 piles of up to 354 trades, each spanning all 96 bars) | 0, 0 (10 piles) |
| 6,695 / 8,000 | 96 of 96 covered, 5,590 off-plot | 0, 0 (2 piles, 96 bars each) | 0, 0 (10 piles; the largest holds 1,659 trades) |

The headline numbers for this design:

- **Pile count:** at most 10 piles on the phone and 22 on desktop, from 80
  trades to 8,000.
- **Pile span:** the widest pile covers 21 bars on the phone (`per` = 21) and
  11 on desktop.
- **Overlap:** 0 heads overlapping, and the fold safety net was never needed.
- **Panning:** shifting the window by 1 to 24 bars left every pile that stayed
  fully in view unchanged (273 pile comparisons, 0 differences).
- **Speed:** layout took 1.7ms and the full redraw 2.2ms at 8,000 trades
  (desktop Chromium; expect several times that on a phone).
- **The first version:** besides collapsing into one pile per side, it
  produced one pair of overlapping heads at the plot edge (800 trades,
  default roles).

The concept page has these controls and recomputes the numbers on the
viewer's device.

### Still to observe once the layer is built

- Overlap: in a dev script, check that no head disc (halo included)
  intersects a candle's body or wick, and that no two piles' heads overlap.
  Run it at 360px and 720px on the concept's 9 trades and on the stress
  hour.
- Panning and zooming: piles fully in view keep their members while panning;
  zooming changes `per` and regroups.
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
