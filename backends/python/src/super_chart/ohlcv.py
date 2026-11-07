# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright 2026 SUPER SOLUTION LABS INC
"""Indicators over price and volume: obv, vwap, cci, mfi, stoch_k, stoch, stoch_rsi, bb_percent, sar, keltner."""

from __future__ import annotations

from collections.abc import Sequence

from .moving import dev, highest, lowest
from .ta import Series, _nulls, atr, bollinger, ema, rsi, sma, sum_

Values = Sequence[float | None]


def _at(s: Values, i: int) -> float | None:
    return s[i] if 0 <= i < len(s) else None


def _or_zero(p: float | None) -> float:
    return 0.0 if p is None else p


def obv(close: Values, volume: Values) -> Series:
    """On-balance volume."""
    out = _nulls(len(close))
    acc = 0.0
    prev: float | None = None
    for i, c in enumerate(close):
        v = _or_zero(_at(volume, i))
        if c is None:
            continue
        if prev is not None:
            if c > prev:
                acc += v
            elif c < prev:
                acc += -v
        out[i] = acc
        prev = c
    return out


def vwap(high: Values, low: Values, close: Values, volume: Values) -> Series:
    """Cumulative volume-weighted average price of hlc3 from the first bar (no session reset)."""
    out = _nulls(len(close))
    pv = vol = 0.0
    for i, c in enumerate(close):
        h, lo = _at(high, i), _at(low, i)
        v = _or_zero(_at(volume, i))
        if h is None or lo is None or c is None:
            continue
        pv += ((h + lo + c) / 3) * v
        vol += v
        if vol != 0:
            out[i] = pv / vol
    return out


def _hlc3(high: Values, low: Values, close: Values) -> Series:
    out = _nulls(len(high))
    for i, h in enumerate(high):
        lo, c = _at(low, i), _at(close, i)
        if h is not None and lo is not None and c is not None:
            out[i] = (h + lo + c) / 3
    return out


def cci(high: Values, low: Values, close: Values, length: float) -> Series:
    """Commodity channel index over hlc3."""
    tp = _hlc3(high, low, close)
    basis, md = sma(tp, length), dev(tp, length)
    out = _nulls(len(tp))
    for i, t in enumerate(tp):
        b, d = basis[i], md[i]
        if t is not None and b is not None and d is not None and d != 0:
            out[i] = (t - b) / (0.015 * d)
    return out


def mfi(high: Values, low: Values, close: Values, volume: Values, length: float) -> Series:
    """Money flow index over hlc3."""
    n = len(close)
    tp = _hlc3(high, low, close)
    pos: Series = [0.0] * n
    neg: Series = [0.0] * n
    for i in range(1, n):
        t, p = tp[i], tp[i - 1]
        v = _or_zero(_at(volume, i))
        if t is None or p is None:
            continue
        if t > p:
            pos[i] = t * v
        elif t < p:
            neg[i] = t * v
    out = _nulls(n)
    for i, (sp, sn) in enumerate(zip(sum_(pos, length), sum_(neg, length), strict=True)):
        if sp is None or sn is None:
            continue
        out[i] = 100.0 if sn == 0 else 100 - 100 / (1 + sp / sn)
    return out


def stoch_k(high: Values, low: Values, close: Values, length: float) -> Series:
    """Raw stochastic %K; %D is sma(%K, d)."""
    hh, ll = highest(high, length), lowest(low, length)
    out = _nulls(len(close))
    for i, c in enumerate(close):
        top, bottom = hh[i], ll[i]
        if c is None or top is None or bottom is None:
            continue
        d = top - bottom
        out[i] = 0.0 if d == 0 else 100 * (c - bottom) / d
    return out


def stoch(src: Values, length: float) -> Series:
    """Stochastic of one series: 100 * (x - lowest) / (highest - lowest); 0 on a flat window."""
    return stoch_k(src, src, src, length)


def stoch_rsi(src: Values, rsi_len: float, stoch_len: float, k_len: float, d_len: float) -> dict[str, Series]:
    """TradingView stochastic RSI: k = sma(stoch(rsi(src, rsi_len), stoch_len), k_len), d = sma(k, d_len)."""
    k = sma(stoch(rsi(src, rsi_len), stoch_len), k_len)
    return {"k": k, "d": sma(k, d_len)}


def bb_percent(src: Values, length: float, mult: float = 2) -> Series:
    """Bollinger %B: (src - lower) / (upper - lower); None where the bands are flat."""
    bands = bollinger(src, length, mult)
    out = _nulls(len(src))
    for i, v in enumerate(src):
        u, lo = bands["upper"][i], bands["lower"][i]
        if v is not None and u is not None and lo is not None and u != lo:
            out[i] = (v - lo) / (u - lo)
    return out


def sar(high: Values, low: Values, start: float = 0.02, inc: float = 0.02, maximum: float = 0.2) -> Series:
    """Wilder's parabolic SAR, started from the first two bars."""
    n = len(high)
    out = _nulls(n)
    if n < 2 or len(low) < 2:
        return out
    h0, l0, h1, l1 = high[0], low[0], high[1], low[1]
    if h0 is None or l0 is None or h1 is None or l1 is None:
        return out
    is_long = h1 >= h0
    af = start
    ep, s = (h1, l0) if is_long else (l1, h0)
    for i in range(1, n):
        h, lo = high[i], _at(low, i)
        if h is None or lo is None:
            continue
        s = s + af * (ep - s)
        if is_long:
            if lo < s:
                is_long, s, ep, af = False, ep, lo, start
            elif h > ep:
                ep, af = h, min(af + inc, maximum)
        elif h > s:
            is_long, s, ep, af = True, ep, h, start
        elif lo < ep:
            ep, af = lo, min(af + inc, maximum)
        out[i] = s
    return out


def keltner(high: Values, low: Values, close: Values, length: float, mult: float, atr_len: float) -> dict[str, Series]:
    """Basis = ema(close, length); bands are basis plus or minus mult times atr(atr_len)."""
    basis, rng = ema(close, length), atr(high, low, close, atr_len)

    def band(sign: float) -> Series:
        return [None if b is None or r is None else b + (sign * mult) * r for b, r in zip(basis, rng, strict=True)]

    return {"basis": basis, "upper": band(1), "lower": band(-1)}
