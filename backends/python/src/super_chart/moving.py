# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright 2026 SUPER SOLUTION LABS INC
"""Moving averages and rolling extremes: wma, hma, vwma, dev, highest, lowest.

Ports of the same-named kernels in packages/core/src/ta.ts. Inputs are finite numbers or None.
"""

from __future__ import annotations

import math
from collections import deque
from collections.abc import Sequence

from .ta import Series, _nulls, is_length, sum_

Values = Sequence[float | None]


def wma(src: Values, length: float) -> Series:
    """Weighted moving average (weights 1..length, newest heaviest), O(1) per bar, re-seeded every length bars."""
    n = len(src)
    out = _nulls(n)
    if not is_length(length):
        return out
    size = int(length)
    denom = size * (size + 1) / 2
    run = since_seed = 0
    valid = False
    total = num = 0.0
    for i in range(n):
        v = src[i]
        if v is None:
            run, valid = 0, False
            continue
        run += 1
        if run < size:
            continue
        if valid:
            since_seed += 1
        if not valid or since_seed >= size:
            total = num = 0.0
            for j in range(size):
                x = src[i - size + 1 + j]
                assert x is not None
                total += x
                num += x * (j + 1)
            since_seed = 0
            valid = True
        else:
            old = src[i - size]
            assert old is not None
            num = num - total + size * v  # every weight drops by one, the new bar enters with weight `size`
            total = total - old + v
        out[i] = num / denom
    return out


def hma(src: Values, length: float) -> Series:
    """Hull moving average: wma(2 * wma(src, length / 2) - wma(src, length), sqrt(length))."""
    if not is_length(length) or length < 2:
        return _nulls(len(src))
    half, full = wma(src, math.floor(length / 2)), wma(src, length)
    diff = [None if h is None or f is None else 2 * h - f for h, f in zip(half, full, strict=True)]
    return wma(diff, math.floor(math.sqrt(length) + 0.5))


def vwma(src: Values, volume: Values, length: float) -> Series:
    """Volume-weighted moving average; None where the window's volume sums to 0."""
    n = len(src)
    pv, vol = _nulls(n), _nulls(n)
    for i, v in enumerate(src):
        if v is None or i >= len(volume) or volume[i] is None:
            continue
        w = volume[i]
        assert w is not None
        pv[i] = v * w
        vol[i] = w
    num, den = sum_(pv, length), sum_(vol, length)
    return [None if a is None or b is None or b == 0 else a / b for a, b in zip(num, den, strict=True)]


def dev(src: Values, length: float) -> Series:
    """Mean absolute deviation from the window's mean (Pine ta.dev), O(n * length)."""
    n = len(src)
    out = _nulls(n)
    if not is_length(length):
        return out
    size = int(length)
    run = 0
    for i in range(n):
        if src[i] is None:
            run = 0
            continue
        run += 1
        if run < size:
            continue
        window = [x for x in src[i - size + 1 : i + 1] if x is not None]
        a = 0.0
        for x in window:
            a += x
        mean = a / size
        d = 0.0
        for x in window:
            d += abs(x - mean)
        out[i] = d / size
    return out


def _extreme(src: Values, length: float, highest: bool) -> Series:
    n = len(src)
    out = _nulls(n)
    if not is_length(length) or int(length) > n:
        return out
    size = int(length)
    queue: deque[int] = deque()  # indices, front first
    run = 0
    for i in range(n):
        v = src[i]
        if v is None:
            run = 0
            queue.clear()
            continue
        run += 1
        if queue and queue[0] <= i - size:
            queue.popleft()
        while queue:
            b = src[queue[-1]]
            assert b is not None
            if (highest and b <= v) or (not highest and b >= v):
                queue.pop()
            else:
                break
        queue.append(i)
        if run >= size:
            out[i] = src[queue[0]]
    return out


def highest(src: Values, length: float) -> Series:
    """Highest value over `length` bars."""
    return _extreme(src, length, True)


def lowest(src: Values, length: float) -> Series:
    """Lowest value over `length` bars."""
    return _extreme(src, length, False)
