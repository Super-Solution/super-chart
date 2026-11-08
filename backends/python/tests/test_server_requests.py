# SPDX-License-Identifier: GPL-3.0-or-later
"""Request bodies that the Go server refuses must be refused here too, with the same error code."""

from __future__ import annotations

import pytest

from super_chart.server import ApiError, handle_compute

GOOD = '{"bars":{"close":[1,2,3]},"indicators":[{"fn":"sma","params":{"len":2}}]}'


def code_of(body: str | bytes) -> str:
    raw = body.encode() if isinstance(body, str) else body
    with pytest.raises(ApiError) as caught:
        handle_compute(raw)
    return caught.value.code


def test_a_good_request_still_works() -> None:
    assert handle_compute(GOOD.encode())["bars"] == 3


@pytest.mark.parametrize(
    "body",
    [
        "﻿" + GOOD,  # a BOM
        GOOD.encode("utf-16"),
        '{"bars":{"close":[1e400,1,2]},"indicators":[{"fn":"sma"}]}',  # overflows to infinity
        '{"bars":' + "[" * 100_000 + "]" * 100_000 + ',"indicators":[{"fn":"sma"}]}',  # recursion
        '{"bars":{"close":[1'
        + "0" * 400
        + ',1,2]},"indicators":[{"fn":"sma"}]}',  # a whole number too large for a double
        '{"x":' * 50_000 + "1" + "}" * 50_000,
    ],
)
def test_hostile_bodies_are_a_400_not_an_exception(body: str | bytes) -> None:
    assert code_of(body) in {"invalid_request", "invalid_bars"}
