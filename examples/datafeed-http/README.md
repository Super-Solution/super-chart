# HTTP datafeed example

A `Datafeed` for Super Chart over the HTTP contract in [`docs/DATAFEED-HTTP.md`](../../docs/DATAFEED-HTTP.md), and a
zero-dependency server that serves CSV files through the same contract.

```bash
node serve.mjs                      # http://127.0.0.1:8788, reads ./data
curl 'http://127.0.0.1:8788/v1/bars?ticker=SAMPLE-USD&period=1h&limit=3'
```

```ts
import { SuperChart } from '@supersolutions/super-chart-web'
import { createHttpDatafeed } from './httpDatafeed'

const datafeed = createHttpDatafeed({ baseUrl: 'http://127.0.0.1:8788' })
new SuperChart(host, { datafeed, symbol: { ticker: 'SAMPLE-USD', pricePrecision: 2 }, period: { multiplier: 1, timespan: 'hour', text: '1h' } })
```

| File | What it is |
| --- | --- |
| `httpDatafeed.ts` | `createHttpDatafeed({ baseUrl, token?, pollMs?, timeoutMs? })`: search, paged history, polling for the live bar; every request is cut off after `timeoutMs` (default 15 s) and a market keeps one poll timer however often it is re-subscribed |
| `serve.mjs` | the contract over `data/<TICKER>.<period>.csv` and `data/<TICKER>.marks.json` (`/v1/marks`); no auth, no rate limit, no TLS (an example) |
| `data/SAMPLE-USD.1h.csv`, `.1d.csv` | fictional random-walk bars, `timestamp` as ISO-8601 UTC or epoch milliseconds |
| `data/SAMPLE-USD.marks.json` | fictional events (a listing, a dividend, a split, earnings with guidance on one bar, a headline); `getMarks` on the adapter reads them through `/v1/marks` |
| `data/symbols.json` | the symbol list the server answers `/v1/symbols` with |
| `data/bars.response.json` | what a `/v1/bars` answer looks like |

The data is made up. Do not use it for anything but trying the chart.
