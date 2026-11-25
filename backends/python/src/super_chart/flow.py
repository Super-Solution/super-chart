# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright 2026 SUPER SOLUTION LABS INC
"""Volume flow, trend, momentum and reference-level indicators.

aroon, adl, cmf, force_index, vortex, tsi, ultimate, zigzag, pivot_points and chandelier: ports of the matching
functions in packages/core/src/ta.ts. A bar missing a price, or holding a value that is not finite, is a gap.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

from .moving import highest, lowest
from .ta import Series, _nulls, atr, ema, is_length, sum_

Values = Sequence[float | None]


def _fin(s: Values, i: int) -> float | None:
    v = s[i] if 0 <= i < len(s) else None
    return v if v is not None and math.isfinite(v) else None


def _bars_since_extreme(src: Values, window: int, maximum: bool) -> Series:
    """Bars since the extreme of the last `window` values (0 is this bar), the newest bar winning a tie."""
    n = len(src)
    out = _nulls(n)
    if window < 1:
        return out
    queue = [0] * n
    head = tail = run = 0
    for i in range(n):
        v = _fin(src, i)
        if v is None:
            head = tail = run = 0
            continue
        run += 1
        while tail > head:
            last = src[queue[tail - 1]]
            assert last is not None
            if (last <= v) if maximum else (last >= v):
                tail -= 1
            else:
                break
        queue[tail] = i
        tail += 1
        while queue[head] <= i - window:
            head += 1
        if run >= window:
            out[i] = float(i - queue[head])
    return out


def aroon(high: Values, low: Values, length: float) -> dict[str, Series]:
    """Aroon Up/Down: 100 * (length - bars since the high/low) / length over the last length + 1 bars."""
    n = len(high)
    if not is_length(length):
        return {"up": _nulls(n), "down": _nulls(n)}

    def score(bars: Series) -> Series:
        return [None if k is None else 100 * (length - k) / length for k in bars]

    window = int(length) + 1
    return {
        "up": score(_bars_since_extreme(high, window, True)),
        "down": score(_bars_since_extreme(low, window, False)),
    }


def _money_flow(high: Values, low: Values, close: Values, volume: Values) -> tuple[Series, Series]:
    """Close position in the range (-1 at the low, +1 at the high, 0 without a range) times volume, and the volume."""
    n = len(close)
    flow, vol = _nulls(n), _nulls(n)
    for i in range(n):
        h, lo, c = _fin(high, i), _fin(low, i), _fin(close, i)
        if h is None or lo is None or c is None:
            continue
        v = _fin(volume, i) or 0.0
        multiplier = 0.0 if h == lo else ((c - lo) - (h - c)) / (h - lo)
        flow[i] = multiplier * v
        vol[i] = v
    return flow, vol


def adl(high: Values, low: Values, close: Values, volume: Values) -> Series:
    """Accumulation/distribution line: the running total of money flow volume."""
    flow, _ = _money_flow(high, low, close, volume)
    out = _nulls(len(flow))
    total = 0.0
    for i, f in enumerate(flow):
        if f is None:
            continue
        total += f
        out[i] = total
    return out


def cmf(high: Values, low: Values, close: Values, volume: Values, length: float) -> Series:
    """Chaikin money flow: money flow volume over volume, summed over `length` bars; None without volume."""
    flow, vol = _money_flow(high, low, close, volume)
    a, b = sum_(flow, length), sum_(vol, length)
    return [None if x is None or y is None or y == 0 else x / y for x, y in zip(a, b, strict=True)]


def force_index(close: Values, volume: Values, length: float) -> Series:
    """Force index: the EMA of (close change) * volume."""
    n = len(close)
    raw = _nulls(n)
    for i in range(1, n):
        c, p = _fin(close, i), _fin(close, i - 1)
        if c is None or p is None:
            continue
        raw[i] = (c - p) * (_fin(volume, i) or 0.0)
    return ema(raw, length)


def vortex(high: Values, low: Values, close: Values, length: float) -> dict[str, Series]:
    """Vortex indicator VI+ and VI-; a bar needs a finite high, low and close on itself and the bar before."""
    n = len(close)
    up, down, rng = _nulls(n), _nulls(n), _nulls(n)
    for i in range(1, n):
        h, lo, c = _fin(high, i), _fin(low, i), _fin(close, i)
        ph, pl, pc = _fin(high, i - 1), _fin(low, i - 1), _fin(close, i - 1)
        if h is None or lo is None or c is None or ph is None or pl is None or pc is None:
            continue
        up[i] = abs(h - pl)
        down[i] = abs(lo - ph)
        rng[i] = max(h - lo, abs(h - pc), abs(lo - pc))
    tr = sum_(rng, length)

    def ratio(s: Series) -> Series:
        total = sum_(s, length)
        return [None if x is None or t is None or t == 0 else x / t for x, t in zip(total, tr, strict=True)]

    return {"plus": ratio(up), "minus": ratio(down)}


def tsi(src: Values, long: float = 25, short: float = 13, signal: float = 13) -> dict[str, Series]:
    """True strength index with its EMA signal; None where the market did not move."""
    n = len(src)
    move, size = _nulls(n), _nulls(n)
    for i in range(1, n):
        c, p = _fin(src, i), _fin(src, i - 1)
        if c is None or p is None:
            continue
        move[i] = c - p
        size[i] = abs(c - p)
    top = ema(ema(move, long), short)
    bottom = ema(ema(size, long), short)
    line = [None if x is None or y is None or y == 0 else 100 * x / y for x, y in zip(top, bottom, strict=True)]
    return {"tsi": line, "signal": ema(line, signal)}


def ultimate(high: Values, low: Values, close: Values, a: float = 7, b: float = 14, c: float = 28) -> Series:
    """Ultimate oscillator: buying pressure over true range for three windows, weighted 4, 2 and 1, 0..100."""
    n = len(close)
    pressure, rng = _nulls(n), _nulls(n)
    for i in range(1, n):
        h, lo, cl, pc = _fin(high, i), _fin(low, i), _fin(close, i), _fin(close, i - 1)
        if h is None or lo is None or cl is None or pc is None:
            continue
        floor, ceiling = min(lo, pc), max(h, pc)
        pressure[i] = cl - floor
        rng[i] = ceiling - floor
    windows: list[Series] = []
    for length in (a, b, c):
        p, r = sum_(pressure, length), sum_(rng, length)
        windows.append([None if x is None or y is None or y == 0 else x / y for x, y in zip(p, r, strict=True)])
    return [
        None if x is None or y is None or z is None else 100 * (4 * x + 2 * y + z) / 7
        for x, y, z in zip(*windows, strict=True)
    ]


def zigzag(high: Values, low: Values, deviation: float = 5) -> dict[str, Series]:
    """Percentage-reversal zigzag. It repaints: a pivot is known only after price reverses by `deviation` percent,
    so earlier legs move as bars arrive and the last leg ends at the latest extreme."""
    n = min(len(high), len(low))
    line, pivot = _nulls(len(high)), _nulls(len(high))
    if not (math.isfinite(deviation) and deviation > 0):
        return {"line": line, "pivot": pivot}
    rise, fall = 1 + deviation / 100, 1 - deviation / 100
    marks: list[tuple[int, float]] = []
    direction = 0
    top_value = bottom_value = 0.0
    top_index = bottom_index = -1
    for i in range(n):
        h, lo = _fin(high, i), _fin(low, i)
        if h is None or lo is None:
            continue
        if top_index < 0:
            top_value, top_index, bottom_value, bottom_index = h, i, lo, i
            continue
        if direction == 0:
            if h > top_value:
                top_value, top_index = h, i
            if lo < bottom_value:
                bottom_value, bottom_index = lo, i
            if top_index > bottom_index and top_value >= bottom_value * rise:
                marks.append((bottom_index, bottom_value))
                direction = 1
            elif bottom_index > top_index and bottom_value <= top_value * fall:
                marks.append((top_index, top_value))
                direction = -1
        elif direction == 1:
            if h > top_value:
                top_value, top_index = h, i
            elif lo <= top_value * fall:
                marks.append((top_index, top_value))
                direction, bottom_value, bottom_index = -1, lo, i
        elif lo < bottom_value:
            bottom_value, bottom_index = lo, i
        elif h >= bottom_value * rise:
            marks.append((bottom_index, bottom_value))
            direction, top_value, top_index = 1, h, i
    if direction == 0:
        return {"line": line, "pivot": pivot}
    confirmed = len(marks)
    marks.append((top_index, top_value) if direction == 1 else (bottom_index, bottom_value))
    for index, value in marks[:confirmed]:
        pivot[index] = value
    for (start, a), (end, b) in zip(marks, marks[1:], strict=False):
        for i in range(start, end):
            if _fin(high, i) is None or _fin(low, i) is None:
                continue
            line[i] = a + (b - a) * (i - start) / (end - start)
        line[end] = b
    return {"line": line, "pivot": pivot}


def pivot_points(high: Values, low: Values, close: Values, periods: Values, kind: float = 0) -> dict[str, Series]:
    """Pivot points from the previous completed period; `periods[i]` is the period key of bar i.

    A new key starts a new period and every bar of a period gets the levels of the period before it (None for the
    first period and for a bar with a None key). kind 0 is classic, 1 is Fibonacci (0.382, 0.618, 1.0 of the range).
    """
    n = len(close)
    names = ("pp", "r1", "r2", "r3", "s1", "s2", "s3")
    out = {name: _nulls(n) for name in names}
    if kind not in (0, 1):
        return out
    key: float | None = None
    h = lo = c = 0.0
    any_bar = False
    levels: list[float] | None = None
    for i in range(n):
        p = periods[i] if i < len(periods) else None
        if p is None:
            continue
        if p != key:
            if any_bar:
                pp, rng = (h + lo + c) / 3, h - lo
                if kind == 0:
                    levels = [pp, 2 * pp - lo, pp + rng, h + 2 * (pp - lo), 2 * pp - h, pp - rng, lo - 2 * (h - pp)]
                else:
                    levels = [
                        pp,
                        pp + 0.382 * rng,
                        pp + 0.618 * rng,
                        pp + rng,
                        pp - 0.382 * rng,
                        pp - 0.618 * rng,
                        pp - rng,
                    ]
            key, any_bar = p, False
        bh, bl, bc = _fin(high, i), _fin(low, i), _fin(close, i)
        if bh is not None and bl is not None and bc is not None:
            if not any_bar:
                h, lo, any_bar = bh, bl, True
            else:
                h, lo = max(h, bh), min(lo, bl)
            c = bc
        if levels is not None:
            for name, level in zip(names, levels, strict=True):
                out[name][i] = level
    return out


def chandelier(high: Values, low: Values, close: Values, length: float = 22, mult: float = 3) -> dict[str, Series]:
    """Highest high minus `mult` times ATR (long exit) and lowest low plus `mult` times ATR (short exit)."""
    rng = atr(high, low, close, length)
    top, bottom = highest(high, length), lowest(low, length)
    return {
        "long": [None if x is None or r is None else x - mult * r for x, r in zip(top, rng, strict=True)],
        "short": [None if x is None or r is None else x + mult * r for x, r in zip(bottom, rng, strict=True)],
    }
