# super-chart-core (Python)

Technical-analysis kernels for Super Chart: `sma`, `ema`, `rma`, `wma`, `hma`, `vwma`, `rsi`, `macd`, `stdev`,
`dev`, `bollinger`, `bb_percent`, `true_range`, `atr`, `keltner`, `highest`, `lowest`, `change`, `mom`, `roc`,
`crossover`, `crossunder`, `cross`, `cum`, `barssince`, `obv`, `vwap`, `cci`, `mfi`, `stoch`, `stoch_k`,
`stoch_rsi` and `sar`. A series is a list of `float | None`. The TypeScript package in `packages/core` is the
reference; this port reproduces every case in [`../../conformance`](../../conformance/README.md). Pure standard
library, no dependencies.

```bash
pip install -e ".[dev]"
pytest                    # or: PYTHONPATH=src python -m unittest discover -s tests
ruff check . && mypy
```

Not covered: `linreg`, `correlation`, `valuewhen`, the pivot indicators and non-finite inputs (JSON cannot carry
them). See the conformance README for the exact scope.

GPL-3.0-or-later; a commercial licence is available from SUPER SOLUTION LABS INC (contact@supersolution.io).
