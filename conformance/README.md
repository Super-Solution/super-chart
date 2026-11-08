# Conformance data

Language-neutral test data for the Super Chart kernels. The TypeScript implementation in
`packages/core/src/ta.ts` is the reference; every other backend must reproduce these cases.

| File | What it pins |
| --- | --- |
| `indicators.v1.json` | 341 cases for 33 kernels: `sma`, `ema`, `rma`, `wma`, `hma`, `vwma`, `rsi`, `macd`, `stdev`, `dev`, `bollinger`, `bbPercent`, `trueRange`, `atr`, `keltner`, `highest`, `lowest`, `change`, `mom`, `roc`, `crossover`, `crossunder`, `cross`, `cum`, `barssince`, `obv`, `vwap`, `cci`, `mfi`, `stoch`, `stochK`, `stochRsi` and `sar`. Several lengths and series sizes, series with leading and interior nulls, unusable lengths (0, negative, fractional) which give all nulls, empty and too-short series, the RSI edge cases (flat, only gains, only losses), and a SAR run that reaches its acceleration cap |

| `indicators-server.v1.json` | 22 requests both indicator servers must refuse, each with its HTTP status and error code (bad JSON, unknown members, unknown function/param/input/source, fractional bar counts, duplicate or shadowing ids, ragged columns, and the bar, indicator and body-size limits), run with the limits it names. The Go and Python server tests both read it |

Series hold numbers or `null`. Each case carries its own tolerance: compare a value with
`abs(got - want) <= tolerance * max(1, abs(want))`, and `null` must match `null`. Doubles round-trip exactly
through JSON, so ports that follow the same operation order agree to about 1e-12.

```bash
node scripts/export-conformance.mjs            # regenerate from the TypeScript reference
node scripts/export-conformance.mjs --check    # fail if the file drifted from ta.ts
(cd backends/go && go test ./... && go test -bench . ./ta)   # Go port (kernels and server), with benchmarks
(cd backends/python && PYTHONPATH=src python -m pytest)       # Python port (kernels and server)
```

Not in the data: `linreg`, `correlation`, `valuewhen`, the pivot indicators, and non-finite inputs (JSON cannot
carry NaN or infinity), so the ports assume finite numbers or `null`.

If an indicator changes on purpose, regenerate, review the diff, and update every port. The Rust backend is
closed source and lives in a private repository; it tests against this same file.
