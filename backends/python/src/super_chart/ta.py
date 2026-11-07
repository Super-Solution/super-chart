# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright 2026 SUPER SOLUTION LABS INC
"""Technical-analysis kernels for Super Chart, in Python.

Ports of packages/core/src/ta.ts: sum, sma, ema, rma, rsi, macd, stdev, bollinger, true_range, atr.
A series is a list of float-or-None. Windows restart after a None, results are None until a window is
ready, and an unusable length (not a positive integer) gives all None, exactly like the reference.
conformance/indicators.v1.json is the shared test data.

The moving averages and extremes are in moving.py, the bar-to-bar signals in signals.py and the price and
volume indicators in ohlcv.py.

Not covered: the other indicators in ta.ts (linreg, correlation, valuewhen, pivots, ...).
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from typing import cast

Series = list[float | None]


def _nulls(n: int) -> Series:
    return [None] * n


def is_length(length: float) -> bool:
    return (
        isinstance(length, (int, float)) and not isinstance(length, bool) and float(length).is_integer() and length >= 1
    )


def _plain_sum(vals: Sequence[float], start: int, end: int) -> float:
    total = 0.0
    for j in range(start, end + 1):
        total += vals[j]
    return total


def sum_(src: Sequence[float | None], length: float) -> Series:
    """Rolling sum over `length` bars with Neumaier compensation, like the reference."""
    n = len(src)
    out = _nulls(n)
    if not is_length(length):
        return out
    length = int(length)
    vals = cast("Sequence[float]", src)  # window reads below only touch bars already seen to be non-None
    run, last_bad, valid = 0, -1, False
    s = c = 0.0
    since_seed = 0
    for i in range(n):
        v = src[i]
        if v is None:
            run, valid = 0, False
            continue
        run += 1
        if not math.isfinite(v):
            last_bad = i
        if run < length:
            continue
        if last_bad > i - length:
            out[i] = _plain_sum(vals, i - length + 1, i)
            valid = False
            continue
        since_seed += 1
        if not valid or since_seed >= length:
            s = c = 0.0
            for j in range(i - length + 1, i + 1):
                x = vals[j]
                t = s + x
                c += (s - t) + x if abs(s) >= abs(x) else (x - t) + s
                s = t
            since_seed = 0
            valid = True
        else:
            o = -vals[i - length]
            t = s + o
            c += (s - t) + o if abs(s) >= abs(o) else (o - t) + s
            s = t
            t = s + v
            c += (s - t) + v if abs(s) >= abs(v) else (v - t) + s
            s = t
        out[i] = s + c
    return out


def sma(src: Sequence[float | None], length: float) -> Series:
    out = sum_(src, length)
    for i, v in enumerate(out):
        if v is not None:
            out[i] = v / length
    return out


def _seeded_average(src: Sequence[float | None], length: float, step: Callable[[float, float, int], float]) -> Series:
    n = len(src)
    out = _nulls(n)
    if not is_length(length):
        return out
    length = int(length)
    prev: float | None = None
    seed_sum, seed_count = 0.0, 0
    for i in range(n):
        v = src[i]
        if v is None:
            continue
        if prev is None:
            seed_sum += v
            seed_count += 1
            if seed_count == length:
                prev = seed_sum / length
                out[i] = prev
        else:
            prev = step(prev, v, length)
            out[i] = prev
    return out


def ema(src: Sequence[float | None], length: float) -> Series:
    """Exponential moving average seeded with the average of the first `length` values."""
    return _seeded_average(src, length, lambda prev, v, n: (2 * v + (n - 1) * prev) / (n + 1))


def rma(src: Sequence[float | None], length: float) -> Series:
    """Wilder's moving average seeded with the average of the first `length` values."""
    return _seeded_average(src, length, lambda prev, v, n: (prev * (n - 1) + v) / n)


def _rsi_from(gain: float, loss: float) -> float:
    if loss == 0:
        return 100.0
    if gain == 0:
        return 0.0
    return 100 - 100 / (1 + gain / loss)


def rsi(src: Sequence[float | None], length: float) -> Series:
    """Wilder RSI: 100 when the average loss is 0, 0 when the average gain is 0."""
    n = len(src)
    out = _nulls(n)
    if not is_length(length):
        return out
    length = int(length)
    avg_gain = avg_loss = 0.0
    prev: float | None = None
    seeded = 0
    for i in range(n):
        v = src[i]
        if v is None:
            prev = None
            continue
        if prev is not None:
            change = v - prev
            gain, loss = max(change, 0.0), max(-change, 0.0)
            if seeded < length:
                avg_gain += gain
                avg_loss += loss
                seeded += 1
                if seeded == length:
                    avg_gain /= length
                    avg_loss /= length
                    out[i] = _rsi_from(avg_gain, avg_loss)
            else:
                avg_gain = (avg_gain * (length - 1) + gain) / length
                avg_loss = (avg_loss * (length - 1) + loss) / length
                out[i] = _rsi_from(avg_gain, avg_loss)
        prev = v
    return out


def macd(
    src: Sequence[float | None], fast: float = 12, slow: float = 26, signal: float = 9, hist_multiplier: float = 1
) -> dict[str, Series]:
    f, s = ema(src, fast), ema(src, slow)
    dif = [None if a is None or b is None else a - b for a, b in zip(f, s, strict=True)]
    dea = ema(dif, signal)
    hist = [None if a is None or b is None else (a - b) * hist_multiplier for a, b in zip(dif, dea, strict=True)]
    return {"dif": dif, "dea": dea, "hist": hist}


def stdev(src: Sequence[float | None], length: float) -> Series:
    """Population standard deviation over `length` bars (sliding Welford, re-seeded every window)."""
    n = len(src)
    out = _nulls(n)
    if not is_length(length):
        return out
    length = int(length)
    vals = cast("Sequence[float]", src)  # window reads below only touch bars already seen to be non-None
    run, last_bad, valid = 0, -1, False
    mean = m2 = 0.0
    since_seed = 0
    for i in range(n):
        v = src[i]
        if v is None:
            run, valid = 0, False
            continue
        run += 1
        if not math.isfinite(v):
            last_bad = i
        if run < length:
            continue
        reseed = last_bad > i - length or not valid
        if not reseed:
            since_seed += 1
            reseed = since_seed >= length
        if reseed:
            a = 0.0
            for j in range(i - length + 1, i + 1):
                a += vals[j]
            m = a / length
            q = 0.0
            for j in range(i - length + 1, i + 1):
                q += (vals[j] - m) ** 2
            out[i] = math.sqrt(q / length)
            valid = not (last_bad > i - length)
            if valid:
                mean, m2, since_seed = m, q, 0
            continue
        o = vals[i - length]
        nxt = mean + (v - o) / length
        m2 += (v - o) * (v - nxt + o - mean)
        mean = nxt
        out[i] = math.sqrt(max(m2, 0.0) / length)
    return out


def bollinger(src: Sequence[float | None], length: float, mult: float = 2) -> dict[str, Series]:
    basis, sd = sma(src, length), stdev(src, length)
    upper = [None if b is None or d is None else b + mult * d for b, d in zip(basis, sd, strict=True)]
    lower = [None if b is None or d is None else b - mult * d for b, d in zip(basis, sd, strict=True)]
    return {"basis": basis, "upper": upper, "lower": lower}


def true_range(high: Sequence[float | None], low: Sequence[float | None], close: Sequence[float | None]) -> Series:
    out: Series = []
    for i, h in enumerate(high):
        lo = low[i]
        prev_close = close[i - 1] if i > 0 else None
        if h is None or lo is None:
            out.append(None)
        elif prev_close is None:
            out.append(h - lo)
        else:
            out.append(max(h - lo, abs(h - prev_close), abs(lo - prev_close)))
    return out


def atr(
    high: Sequence[float | None], low: Sequence[float | None], close: Sequence[float | None], length: float
) -> Series:
    return rma(true_range(high, low, close), length)
