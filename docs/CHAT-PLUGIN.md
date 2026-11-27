# Chart in chat

`@supersolutions/super-chart-chat-plugin` implements the `ChatPlugin` contract of
`@supersolutions/super-protocol`. It replaces the removed `/commands` palette: the
agent acts through tools, the user acts on the chart itself.

## Install

```ts
import { installChatPlugin } from '@supersolutions/super-chat-plugin'
import { createChartChatPlugin } from '@supersolutions/super-chart-chat-plugin'

const plugin = createChartChatPlugin({
  resolveFeed: id => feeds[id],            // optional
  onChange: (chartId, snapshot) => save(chartId, snapshot) // optional
})
installChatPlugin(cardRegistry, plugin, { tools: toolRegistry })
```

`installChatPlugin` refuses an invalid plugin or a card-kind collision. Pass `tools` to offer the agent the nine
tools below; without it only the card is installed.

## The card

`super-chart.chart` (`validateChartCardSpec` in `super-protocol/chart`):

```jsonc
{
  "kind": "super-chart.chart",
  "id": "btc",                       // optional; lets tools address this chart
  "symbol": { "ticker": "BTCUSDT", "pricePrecision": 2 },
  "period": { "multiplier": 1, "timespan": "hour", "text": "1h" },
  "bars": [ { "timestamp": 1767225600000, "open": 1, "high": 2, "low": 0.5, "close": 1.5, "volume": 10 } ],
  // or: "feed": { "id": "binance" }  (a datafeed the host registered)
  "chartType": "candles",            // candles | hollow-candles | ohlc | line | area | baseline | heikin-ashi
  "indicators": [ { "name": "MA", "params": [20] }, { "name": "RSI" } ],
  "annotations": [ { "key": "support", "kind": "level", "anchors": [ { "time": 1767225600000, "price": 98 } ], "tone": "bull" } ],
  "height": 420
}
```

Exactly one of `bars` (at most 20,000, sorted, unique timestamps) or `feed`.
While the spec is still streaming the card shows a placeholder. A changed spec for
the same market and data updates indicators, annotations and chart type in place
(viewport and the user's drawings stay); a changed market, data or height remounts.
One bad indicator is reported under the chart and does not blank it.

## Where the card is shown

A host that shows cards in more than one place (super-protocol 0.4 `CardMountContext.placement`) gets a chart that fits each:

| placement | what the chart does |
| --- | --- |
| `inline` (or none) | The chat card as before: `height` (default 420 px), full chrome. |
| `panel` | Fills the side panel (at least 360 px tall) and ignores `height`: every tool, for drawing and replay. The manifest declares a `panel` capability for `super-chart.chart`. |
| `document` | Inside an editor document: `height` (default 360 px), no drawing bar, tool rail or replay footer, since a report is read. Print shows the block's alt text. |

Moving a card between places rebuilds the chart; indicators and marks come back the same way they do on a remount. The placement is read structurally, so the plugin still runs on hosts with protocol 0.3.

## Tools

| Tool | Authority | Does |
| --- | --- | --- |
| `chart_state` | `read` | symbol, period, chart type, indicators, annotations, bar count, replay |
| `chart_bars` | `read` | the last N loaded bars (≤ 500) |
| `chart_levels` | `read` | up to five support and five resistance prices from the recent bars, nearest the last close first, with touch counts; draw lines at these, not at guesses |
| `chart_swings` | `read` | the latest swing highs and lows (time and price of real bars, alternating) and the last leg; anchor trend lines, fibonacci and plans on these |
| `chart_set_market` | `draft` | change symbol/period (needs a feed; inline-bar cards refuse) |
| `chart_annotate` | `draft` | merge or replace the agent's marks by key; returns `applied` / `rejected` with codes, and a `ref:` link per mark |
| `chart_indicators` | `draft` | add/remove indicators; returns what is shown and what is available |
| `chart_replay` | `draft` | start, step, or read bar replay |
| `chart_clear_annotations` | `act` | remove some or all of the agent's marks |

Authority decides which capability presets offer a tool: `read` is in `observer`, `draft` and `executor`; `draft`
is in `draft` and `executor`; `act` is in `executor` only. `draft` tools change only the chart on screen.

Every tool takes an optional `chartId` (default: the most recent chart on screen)
and fails with a message that lists the charts on screen.

## Verified and not verified

Walked in Chromium against the built packages: mounting inline bars, level, zone and
marker rendering, all seven tools, indicator rejection, replay (marks beyond the
replay cursor are hidden by the engine), chart-type change, destroy releasing the
chart id. Not covered: `feed` references against a live feed, `chart_set_market`
against a real multi-symbol feed, long-running streaming updates, screen readers.

## Remounting

A chat host may remount a card, for example when a turn finishes. The agent's marks and indicators come back with
the same card. A changed market and the replay position do not: the card returns to the market in its spec.

## Theme

The card follows `theme` (`light` or `dark`). When the host also passes `hostTheme`, the workspace chrome uses the
host's colours and fonts, and the canvas uses them where they are six-digit hex colours. A changed theme remounts
the chart.

## Marks the agent can draw

`chart_annotate` takes seven kinds. The first three are basic; the rest are drawn by the chart's templates and every
anchor of them needs a price.

| Kind | Anchors | Draws |
| --- | --- | --- |
| `level` | 1 | a horizontal price line |
| `zone` | 2 | a price band over a time range |
| `marker` | 1 | a labelled point |
| `trend` | 2 | a line through two points |
| `ray` | 2 | the same line, extended to the right |
| `fibonacci` | 2 | retracement levels between two points; `params.levels` is a comma list such as `"0,0.5,1"` |
| `plan` | 3 | entry, target and stop in that order, with the risk-reward ratio |

Scalar `params` are accepted on `trend`, `ray`, `fibonacci` and `plan` only. A mark the engine refuses is reported
under `rejected` with its code; the others still apply.

## Getting marks right

Models draw wrong marks for three reasons: wrong units, prices that were never on this chart, and marks that land where no one
can see them. The tools say so instead of hiding it.

- `chart_state` returns `data`: the first and last bar time, the price range of the 500 most recent bars and the last close.
  The tool descriptions tell the agent to read it before marking.
- Times are milliseconds. A mark whose anchor times are all plausible Unix *seconds* (between 1e8 and 1e11) is corrected by
  ×1000 and the result carries `warnings` with code `time_in_seconds`.
- `chart_annotate` returns `notShown`: for each applied mark that is not on screen, its `status` and a `why` (before the first
  loaded bar, after the last bar, above or below the recent price range, outside the current view). The agent should fix
  those, not tell the reader they are drawn.
- `warnings` also carries `invalid_plan` (a `plan` whose stop is on the target's side of the entry, which the chart draws as a
  note, not a plan) and `flat_range` (a `zone` or `fibonacci` with the same price at both ends), and `near_duplicate` (a `level` within 0.1% of another in the same call: one line, one label).
- `chart_swings` gives the swing points and the last leg, so a trend line or retracement starts and ends on real turning bars.
- `chart_levels` gives the support and resistance prices price has turned at, so lines go where the chart shows a reason.
- A level whose chip would sit under the legend puts the chip at the right end of its line instead.
- Labels that would overlap move sideways so each stays level with its own price; the axis price tags stack with connectors.

## Words that point at the chart

A message can point at a mark, and the reader sees it light up. The agent writes a Markdown link whose address is a
card reference (`ref.ts` in super-protocol, `docs/CARD-REFS.md` there):

```md
Price held [the support level](ref:btc?key=support) twice. [The March rally](ref:btc?from=1772323200000&to=1774915200000&low=92&high=110) ...
```

`chart_annotate` and `chart_state` return the link for each mark in `refs`. A chart whose id has characters a
reference cannot carry (a space, say) has no `refs`; give the card a plain id such as `btc`.

The card answers `ref(ref, event)` on its mount handle:

| Link | `enter` (hover, focus) | `activate` (click, Enter, tap) |
| --- | --- | --- |
| `ref:btc` | nothing to show; answers with the chart's name | focuses the chart and scrolls the card into view |
| `ref:btc?key=support` | draws that mark bolder, with a glow | the same, and brings it into view if the view has moved away |
| `ref:btc?from=<ms>&to=<ms>` | shades that time range (a violet band) | the same, and centres the range if it is not in view |
| `...&low=<price>&high=<price>` | the band covers that price range only | the same |

`leave`, or `ref(null, ...)`, clears every highlight. A highlight never changes the stored marks or the agent's state.
The answer is `{ ok: true, label }`, where `label` is a short phrase a host can announce, or `{ ok: false, code, reason }`:
`ref_no_match` when there is no such mark or the range is outside the loaded bars, `ref_invalid` when the link's params
do not make sense for a chart. Only bars already loaded can be shown; `activate` never fetches history. A range wider
than the view is shaded where it is visible and centred, not zoomed to fit.

Under the card: `EngineAnnotations.setEmphasis(keys, layer?)`, `setRangeHighlight(range)` and `getAnnotationSpan(key)`
do the drawing and are available to any host that uses the web package directly.

### Protocol 0.3.0

The reference shapes and the four new kinds come from `@supersolutions/super-protocol` 0.3.0, which the plugin
depends on.
