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

`installChatPlugin` refuses an invalid plugin or a card-kind collision. Pass `tools` to offer the agent the seven
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

## Tools

| Tool | Authority | Does |
| --- | --- | --- |
| `chart_state` | `read` | symbol, period, chart type, indicators, annotations, bar count, replay |
| `chart_bars` | `read` | the last N loaded bars (≤ 500) |
| `chart_set_market` | `draft` | change symbol/period (needs a feed; inline-bar cards refuse) |
| `chart_annotate` | `draft` | merge or replace the agent's marks by key; returns `applied` / `rejected` with codes |
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

## Theme

The card follows `theme` (`light` or `dark`). When the host also passes `hostTheme`, the workspace chrome uses the
host's colours and fonts, and the canvas uses them where they are six-digit hex colours. A changed theme remounts
the chart.
