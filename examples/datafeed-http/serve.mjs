// A reference server for docs/DATAFEED-HTTP.md that reads CSV files. Zero dependencies, Node 22.
// Usage: node serve.mjs [dataDir] [port]     files: <TICKER>.<period>.csv  (timestamp,open,high,low,close[,volume])
// It does no authentication, rate limiting or TLS: it is an example, put a real gateway in front of anything shared.
import { createServer } from 'node:http'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] ?? new URL('./data', import.meta.url).pathname
const port = Number(process.argv[3] ?? process.env.PORT ?? 8788)
const MAX_LIMIT = 5000, DEFAULT_LIMIT = 500, PERIOD = /^[1-9][0-9]{0,3}[smhdwMy]$/

const series = new Map() // `${ticker}|${period}` -> bars, oldest first
for (const file of readdirSync(dir)) {
  const match = /^(.+)\.([1-9][0-9]*[smhdwMy])\.csv$/.exec(file)
  if (!match) continue
  const [header, ...lines] = readFileSync(join(dir, file), 'utf8').trim().split(/\r?\n/)
  const columns = header.split(',').map(name => name.trim())
  const bars = lines.map(line => {
    const cells = line.split(',')
    const row = Object.fromEntries(columns.map((name, i) => [name, cells[i]]))
    const t = /^-?\d+$/.test(row.timestamp) ? Number(row.timestamp) : Date.parse(row.timestamp)
    return { timestamp: t, open: +row.open, high: +row.high, low: +row.low, close: +row.close, ...(row.volume === undefined ? {} : { volume: +row.volume }) }
  }).sort((a, b) => a.timestamp - b.timestamp)
  series.set(`${match[1]}|${match[2]}`, bars)
}
const symbols = JSON.parse(readFileSync(join(dir, 'symbols.json'), 'utf8')).symbols

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers })
  res.end(JSON.stringify(body))
}
const fail = (res, status, code, message) => send(res, status, { error: { code, message } })
const integer = (text, fallback) => (text === null ? fallback : /^-?\d{1,16}$/.test(text) ? Number(text) : NaN)

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (req.method === 'OPTIONS') return res.writeHead(204, { allow: 'GET, HEAD, OPTIONS' }).end()
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'method_not_allowed', 'Use GET.')
  if (url.pathname === '/healthz') return send(res, 200, { status: 'ok' })
  if (url.pathname === '/v1/symbols') {
    const search = (url.searchParams.get('search') ?? '').toLowerCase()
    const limit = integer(url.searchParams.get('limit'), 50)
    if (!(limit >= 1 && limit <= 200)) return fail(res, 400, 'bad_request', 'limit must be 1 to 200.')
    const found = symbols.filter(s => `${s.ticker} ${s.name ?? ''}`.toLowerCase().includes(search)).slice(0, limit)
    return send(res, 200, { symbols: found })
  }
  if (url.pathname === '/v1/bars') {
    const ticker = url.searchParams.get('ticker'), period = url.searchParams.get('period')
    if (!ticker) return fail(res, 400, 'bad_request', 'ticker is required.')
    if (!period || !PERIOD.test(period)) return fail(res, 400, 'invalid_period', 'period is a number and a unit: 1m, 5m, 1h, 1d, 1w, 1M.')
    const bars = series.get(`${ticker}|${period}`)
    if (!bars) return fail(res, symbols.some(s => s.ticker === ticker) ? 400 : 404, symbols.some(s => s.ticker === ticker) ? 'invalid_period' : 'unknown_symbol', `No ${period} data for ${ticker}.`)
    const from = integer(url.searchParams.get('from'), 0), to = integer(url.searchParams.get('to'), Infinity), limit = integer(url.searchParams.get('limit'), DEFAULT_LIMIT)
    if (Number.isNaN(from) || Number.isNaN(to)) return fail(res, 400, 'bad_request', 'from and to are epoch milliseconds.')
    if (!(limit >= 1 && limit <= MAX_LIMIT)) return fail(res, 400, 'bad_request', `limit must be 1 to ${MAX_LIMIT}.`)
    const inRange = bars.filter(b => b.timestamp >= from && b.timestamp < to)
    const page = inRange.slice(-limit) // the newest `limit` bars, oldest first
    const first = page[0]?.timestamp
    const noData = first === undefined || !bars.some(b => b.timestamp < first)
    const newest = bars.at(-1)?.timestamp
    const cache = page.length > 0 && newest !== undefined && page.at(-1).timestamp < newest ? 'public, max-age=3600' : 'no-store'
    return send(res, 200, { ticker, period, bars: page, noData }, { 'cache-control': cache })
  }
  fail(res, 404, 'not_found', 'Unknown route.')
}).listen(port, '127.0.0.1', () => console.error(`datafeed example: http://127.0.0.1:${port}  (${series.size} series from ${dir})`))
