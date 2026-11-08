# SPDX-License-Identifier: GPL-3.0-or-later
"""The shared server contract, through the ASGI app: conformance cases over HTTP, and the pinned refusals.

``conformance/indicators-server.v1.json`` is also run by the Go server's tests, so the two stay in step.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest

from super_chart.server import BY_NAME, Config, create_app

ROOT = Path(__file__).resolve().parents[3] / "conformance"
BAR_FIELDS = ("open", "high", "low", "close", "volume")
INPUT_NAMES = {"high", "low", "close", "volume"}


def call(app: Any, body: bytes, headers: list[tuple[bytes, bytes]] | None = None) -> tuple[int, dict[str, Any]]:
    async def run() -> tuple[int, dict[str, Any]]:
        sent: list[dict[str, Any]] = []
        queue = [{"type": "http.request", "body": body, "more_body": False}]

        async def receive() -> dict[str, Any]:
            return queue.pop(0) if queue else {"type": "http.disconnect"}

        async def send(message: dict[str, Any]) -> None:
            sent.append(message)

        scope = {"type": "http", "method": "POST", "path": "/v1/indicators", "headers": headers or []}
        await app(scope, receive, send)
        status = next(m["status"] for m in sent if m["type"] == "http.response.start")
        payload = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
        return status, json.loads(payload)

    return asyncio.run(run())


def test_every_conformance_case_through_http() -> None:
    cases = json.loads((ROOT / "indicators.v1.json").read_text())["cases"]
    app = create_app(Config())
    assert len(cases) >= 300
    for index, case in enumerate(cases):
        spec = BY_NAME[case["fn"]]
        arrays = sorted(k for k, v in case["args"].items() if isinstance(v, list))
        columns: dict[str, Any] = {}
        inputs: dict[str, str] = {}
        for name in arrays:
            if name in INPUT_NAMES:
                columns[name], inputs[name] = case["args"][name], name
        for name in arrays:
            if name not in inputs:
                free = next(f for f in BAR_FIELDS if f not in columns)
                columns[free], inputs[name] = case["args"][name], free
        declared = {name: inputs[name] for name, _default in spec.inputs if name in inputs}
        params = {name: case["args"][name] for name, *_rest in spec.params if name in case["args"]}
        request = {"bars": columns, "indicators": [{"id": "x", "fn": case["fn"], "inputs": declared, "params": params}]}
        status, out = call(app, json.dumps(request).encode())
        assert status == 200, (index, case["fn"], out)
        got = out["results"][0]["series"]
        expect = case["expect"] if isinstance(case["expect"], dict) else {"value": case["expect"]}
        assert set(got) == set(expect), (index, case["fn"])
        for name, want in expect.items():
            assert len(got[name]) == len(want), (index, case["fn"], name)
            for k, (g, w) in enumerate(zip(got[name], want, strict=True)):
                if w is None:
                    assert g is None, (index, case["fn"], name, k, g)
                else:
                    ok = g is not None and abs(g - w) <= case["tolerance"] * max(1.0, abs(w))
                    assert ok, (index, case["fn"], name, k, g, w)


_CONTRACT = json.loads((ROOT / "indicators-server.v1.json").read_text())


@pytest.mark.parametrize("refusal", _CONTRACT["refusals"], ids=lambda r: r["name"])
def test_refusals_match_the_shared_contract(refusal: dict[str, Any]) -> None:
    cfg = _CONTRACT["config"]
    app = create_app(
        Config(max_bars=cfg["maxBars"], max_indicators=cfg["maxIndicators"], max_body_bytes=cfg["maxBodyBytes"])
    )
    status, out = call(app, refusal["body"].encode())
    assert (status, out["error"]["code"]) == (refusal["status"], refusal["code"])
