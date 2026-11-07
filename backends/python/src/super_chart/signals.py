# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright 2026 SUPER SOLUTION LABS INC
"""Bar-to-bar signals: change, mom, roc, crossover, crossunder, cross, cum, barssince."""

from __future__ import annotations

from collections.abc import Callable, Sequence

from .ta import Series, _nulls

Values = Sequence[float | None]


def change(src: Values, length: int = 1) -> Series:
    """src - src[length]. The length is a whole number of bars."""
    out = _nulls(len(src))
    for i, v in enumerate(src):
        if 0 <= i - length < len(src):
            p = src[i - length]
            if v is not None and p is not None:
                out[i] = v - p
    return out


def mom(src: Values, length: int = 1) -> Series:
    """Momentum: src - src[length]."""
    return change(src, length)


def roc(src: Values, length: int = 1) -> Series:
    """Rate of change in percent: 100 * (src - src[length]) / src[length]."""
    out = _nulls(len(src))
    for i, v in enumerate(src):
        if not 0 <= i - length < len(src):
            continue
        p = src[i - length]
        if v is None or p is None or p == 0:
            continue
        out[i] = 100 * (v - p) / p
    return out


def _crossing(a: Values, b: Values, rule: Callable[[float, float, float, float], bool]) -> Series:
    out = _nulls(len(a))
    for i in range(1, len(a)):
        if i >= len(b):
            continue
        pa, pb, ca, cb = a[i - 1], b[i - 1], a[i], b[i]
        if pa is None or pb is None or ca is None or cb is None:
            continue
        out[i] = 1.0 if rule(pa, pb, ca, cb) else 0.0
    return out


def crossover(a: Values, b: Values) -> Series:
    """1 where a crosses above b, 0 where it does not, None where a value is missing."""
    return _crossing(a, b, lambda pa, pb, ca, cb: pa <= pb and ca > cb)


def crossunder(a: Values, b: Values) -> Series:
    """1 where a crosses below b."""
    return _crossing(a, b, lambda pa, pb, ca, cb: pa >= pb and ca < cb)


def cross(a: Values, b: Values) -> Series:
    """1 where a crosses b in either direction."""
    return _crossing(a, b, lambda pa, pb, ca, cb: (pa <= pb and ca > cb) or (pa >= pb and ca < cb))


def cum(src: Values) -> Series:
    """Cumulative sum; a None bar stays None and does not reset the total."""
    out = _nulls(len(src))
    acc = 0.0
    for i, v in enumerate(src):
        if v is None:
            continue
        acc += v
        out[i] = acc
    return out


def barssince(cond: Values) -> Series:
    """Bars since `cond` was last non-zero (0 on that bar); None before the first time."""
    out = _nulls(len(cond))
    count = -1
    for i, c in enumerate(cond):
        if c is not None and c != 0:
            count = 0
        elif count >= 0:
            count += 1
        if count >= 0:
            out[i] = float(count)
    return out
