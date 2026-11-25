# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright 2026 SUPER SOLUTION LABS INC
"""HTTP server for the Super Chart indicators (standard library only).

    GET  /healthz         liveness
    GET  /v1/indicators   the catalog: every fn with its inputs, params, defaults and outputs
    POST /v1/indicators   price bars in, indicator series out

The server is stateless. The contract (request, response, error codes) is documented in
docs/INDICATORS-SERVER.md and is identical in the Go backend. Run it with ``python -m super_chart.server``, or
mount ``create_app()`` (a plain ASGI application) under uvicorn, hypercorn or any other ASGI server.
"""

from __future__ import annotations

import hmac
import json
import math
import os
import re
import signal
import sys
from collections.abc import Awaitable, Callable, Mapping, MutableMapping
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from . import (
    adl,
    aroon,
    atr,
    barssince,
    bb_percent,
    bollinger,
    cci,
    chandelier,
    change,
    cmf,
    cross,
    crossover,
    crossunder,
    cum,
    dev,
    ema,
    force_index,
    highest,
    hma,
    keltner,
    lowest,
    macd,
    mfi,
    mom,
    obv,
    rma,
    roc,
    rsi,
    sar,
    sma,
    stdev,
    stoch,
    stoch_k,
    stoch_rsi,
    true_range,
    tsi,
    ultimate,
    vortex,
    vwap,
    vwma,
    wma,
    zigzag,
)
from .ta import Series

__all__ = ["ApiError", "Config", "create_app", "handle_compute", "main", "serve"]

Scope = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[MutableMapping[str, Any]]]
Send = Callable[[MutableMapping[str, Any]], Awaitable[None]]

BAR_FIELDS = ("open", "high", "low", "close", "volume")
DERIVED = {
    "hl2": (("high", "low"), (1, 1)),
    "hlc3": (("high", "low", "close"), (1, 1, 1)),
    "ohlc4": (("open", "high", "low", "close"), (1, 1, 1, 1)),
    "hlcc4": (("high", "low", "close"), (1, 1, 2)),
}
SOURCES = [*BAR_FIELDS, *DERIVED]
ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.status, self.code, self.message = status, code, message


@dataclass(frozen=True)
class Config:
    """Bounds for one request. ``api_key``, when set, must arrive as ``Authorization: Bearer <key>``."""

    max_bars: int = 100_000
    max_indicators: int = 64
    max_body_bytes: int = 16 << 20
    api_key: str = ""


# --- catalog -----------------------------------------------------------------------------------------------------

Inputs = dict[str, Series]
Params = dict[str, float]
Outputs = dict[str, Series]


@dataclass(frozen=True)
class Spec:
    fn: str
    inputs: tuple[tuple[str, str], ...]  # (name, default source); an empty default means required
    params: tuple[tuple[str, float, bool], ...]  # (name, default, integer)
    outputs: tuple[str, ...]
    run: Callable[[Inputs, Params], Outputs]

    def describe(self) -> dict[str, Any]:
        return {
            "fn": self.fn,
            "inputs": [{"name": n, **({"default": d} if d else {})} for n, d in self.inputs],
            "params": [{"name": n, "default": v, **({"integer": True} if i else {})} for n, v, i in self.params],
            "outputs": list(self.outputs),
        }


def _one(series: Series) -> Outputs:
    return {"value": series}


SRC = (("src", "close"),)
HLC = (("high", "high"), ("low", "low"), ("close", "close"))
HLCV = (*HLC, ("volume", "volume"))
VALUE = ("value",)


def _windowed(name: str, f: Callable[[Series, float], Series]) -> Spec:
    return Spec(name, SRC, (("len", 14, False),), VALUE, lambda i, p: _one(f(i["src"], p["len"])))


def _lagged(name: str, default: int, f: Callable[[Series, int], Series]) -> Spec:
    return Spec(name, SRC, (("len", default, True),), VALUE, lambda i, p: _one(f(i["src"], int(p["len"]))))


def _crossing(name: str, f: Callable[[Series, Series], Series]) -> Spec:
    return Spec(name, (("a", ""), ("b", "")), (), VALUE, lambda i, p: _one(f(i["a"], i["b"])))


CATALOG: tuple[Spec, ...] = (
    _windowed("sma", sma),
    _windowed("ema", ema),
    _windowed("rma", rma),
    _windowed("wma", wma),
    _windowed("hma", hma),
    _windowed("rsi", rsi),
    _windowed("stdev", stdev),
    _windowed("dev", dev),
    _windowed("highest", highest),
    _windowed("lowest", lowest),
    Spec(
        "vwma",
        (("src", "close"), ("volume", "volume")),
        (("len", 14, False),),
        VALUE,
        lambda i, p: _one(vwma(i["src"], i["volume"], p["len"])),
    ),
    Spec(
        "bollinger",
        SRC,
        (("len", 20, False), ("mult", 2, False)),
        ("basis", "upper", "lower"),
        lambda i, p: bollinger(i["src"], p["len"], p["mult"]),
    ),
    Spec(
        "bbPercent",
        SRC,
        (("len", 20, False), ("mult", 2, False)),
        VALUE,
        lambda i, p: _one(bb_percent(i["src"], p["len"], p["mult"])),
    ),
    Spec(
        "macd",
        SRC,
        (("fast", 12, False), ("slow", 26, False), ("signal", 9, False)),
        ("dif", "dea", "hist"),
        lambda i, p: macd(i["src"], p["fast"], p["slow"], p["signal"]),
    ),
    Spec("trueRange", HLC, (), VALUE, lambda i, p: _one(true_range(i["high"], i["low"], i["close"]))),
    Spec("atr", HLC, (("len", 14, False),), VALUE, lambda i, p: _one(atr(i["high"], i["low"], i["close"], p["len"]))),
    Spec(
        "keltner",
        HLC,
        (("len", 20, False), ("mult", 2, False), ("atrLen", 10, False)),
        ("basis", "upper", "lower"),
        lambda i, p: keltner(i["high"], i["low"], i["close"], p["len"], p["mult"], p["atrLen"]),
    ),
    _lagged("change", 1, change),
    _lagged("mom", 10, mom),
    _lagged("roc", 10, roc),
    _crossing("crossover", crossover),
    _crossing("crossunder", crossunder),
    _crossing("cross", cross),
    Spec("cum", SRC, (), VALUE, lambda i, p: _one(cum(i["src"]))),
    Spec("barssince", (("cond", ""),), (), VALUE, lambda i, p: _one(barssince(i["cond"]))),
    Spec("obv", (("close", "close"), ("volume", "volume")), (), VALUE, lambda i, p: _one(obv(i["close"], i["volume"]))),
    Spec("vwap", HLCV, (), VALUE, lambda i, p: _one(vwap(i["high"], i["low"], i["close"], i["volume"]))),
    Spec("cci", HLC, (("len", 20, False),), VALUE, lambda i, p: _one(cci(i["high"], i["low"], i["close"], p["len"]))),
    Spec(
        "mfi",
        HLCV,
        (("len", 14, False),),
        VALUE,
        lambda i, p: _one(mfi(i["high"], i["low"], i["close"], i["volume"], p["len"])),
    ),
    Spec(
        "stochK",
        HLC,
        (("len", 14, False),),
        VALUE,
        lambda i, p: _one(stoch_k(i["high"], i["low"], i["close"], p["len"])),
    ),
    _windowed("stoch", stoch),
    Spec(
        "stochRsi",
        SRC,
        (("rsiLen", 14, False), ("stochLen", 14, False), ("kLen", 3, False), ("dLen", 3, False)),
        ("k", "d"),
        lambda i, p: stoch_rsi(i["src"], p["rsiLen"], p["stochLen"], p["kLen"], p["dLen"]),
    ),
    Spec(
        "sar",
        (("high", "high"), ("low", "low")),
        (("start", 0.02, False), ("inc", 0.02, False), ("max", 0.2, False)),
        VALUE,
        lambda i, p: _one(sar(i["high"], i["low"], p["start"], p["inc"], p["max"])),
    ),
    Spec(
        "aroon",
        (("high", "high"), ("low", "low")),
        (("len", 14, False),),
        ("up", "down"),
        lambda i, p: aroon(i["high"], i["low"], p["len"]),
    ),
    Spec(
        "cmf",
        HLCV,
        (("len", 20, False),),
        VALUE,
        lambda i, p: _one(cmf(i["high"], i["low"], i["close"], i["volume"], p["len"])),
    ),
    Spec("adl", HLCV, (), VALUE, lambda i, p: _one(adl(i["high"], i["low"], i["close"], i["volume"]))),
    Spec(
        "forceIndex",
        (("close", "close"), ("volume", "volume")),
        (("len", 13, False),),
        VALUE,
        lambda i, p: _one(force_index(i["close"], i["volume"], p["len"])),
    ),
    Spec(
        "vortex",
        HLC,
        (("len", 14, False),),
        ("plus", "minus"),
        lambda i, p: vortex(i["high"], i["low"], i["close"], p["len"]),
    ),
    Spec(
        "tsi",
        SRC,
        (("long", 25, False), ("short", 13, False), ("signal", 13, False)),
        ("tsi", "signal"),
        lambda i, p: tsi(i["src"], p["long"], p["short"], p["signal"]),
    ),
    Spec(
        "ultimate",
        HLC,
        (("fast", 7, False), ("mid", 14, False), ("slow", 28, False)),
        VALUE,
        lambda i, p: _one(ultimate(i["high"], i["low"], i["close"], p["fast"], p["mid"], p["slow"])),
    ),
    Spec(
        "zigzag",
        (("high", "high"), ("low", "low")),
        (("deviation", 5, False),),
        ("line", "pivot"),
        lambda i, p: zigzag(i["high"], i["low"], p["deviation"]),
    ),
    Spec(
        "chandelier",
        HLC,
        (("len", 22, False), ("mult", 3, False)),
        ("long", "short"),
        lambda i, p: chandelier(i["high"], i["low"], i["close"], p["len"], p["mult"]),
    ),
)
BY_NAME = {s.fn: s for s in CATALOG}


def catalog_payload() -> dict[str, Any]:
    return {"version": 1, "indicators": [s.describe() for s in CATALOG], "sources": SOURCES}


# --- request parsing ---------------------------------------------------------------------------------------------


def _bad(code: str, message: str, status: int = 400) -> ApiError:
    return ApiError(status, code, message)


def _reject_constant(name: str) -> Any:
    raise ValueError(f"{name} is not valid JSON")


def _finite_float(text: str) -> float:
    value = float(text)
    if not math.isfinite(value):  # 1e400 is inf to Python; the Go decoder refuses it, so does this one
        raise ValueError("number out of range")
    return value


def _finite_int(text: str) -> int:
    value = int(text)
    try:
        float(value)
    except OverflowError:  # a whole number too large for a double
        raise ValueError("number out of range") from None
    return value


def _fields(obj: Mapping[str, Any], allowed: tuple[str, ...], where: str, strict: bool) -> dict[str, Any]:
    """Match member names case-insensitively, like the Go decoder does, and optionally refuse unknown ones."""
    out: dict[str, Any] = {}
    for key, value in obj.items():
        low = key.lower()
        if low in allowed:
            out[low] = value
        elif strict:
            raise _bad("invalid_request", f"unknown field {key!r} in {where}")
    return out


def _number(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise TypeError
    return float(value)


def _series(value: Any, name: str) -> Series:
    if not isinstance(value, list):
        raise _bad("invalid_bars", f"bars.{name} must be an array of numbers or null")
    out: Series = []
    for v in value:
        if v is None:
            out.append(None)
        else:
            try:
                out.append(_number(v))
            except TypeError:
                raise _bad("invalid_bars", f"bars.{name} must hold numbers or null") from None
    return out


class Bars:
    def __init__(self, n: int, fields: dict[str, Series]) -> None:
        self.n, self.fields = n, fields

    def get(self, name: str) -> Series | None:
        if name in self.fields:
            return self.fields[name]
        if name in DERIVED:
            parts, weights = DERIVED[name]
            comps = [self.fields.get(p) for p in parts]
            if any(c is None for c in comps):
                return None
            total = sum(weights)
            out: Series = []
            for i in range(self.n):
                acc: float | None = 0.0
                for comp, weight in zip(comps, weights, strict=True):
                    v = None if comp is None else comp[i]
                    acc = None if acc is None or v is None else acc + weight * v
                out.append(None if acc is None else acc / total)
            return out
        return None


def parse_bars(raw: Any, max_bars: int) -> Bars:
    if raw is None:
        raise _bad("invalid_request", '"bars" is required')
    fields: dict[str, Series] = {}
    if isinstance(raw, dict):
        cols = _fields(raw, BAR_FIELDS, "bars", strict=False)
        n: int | None = None
        for name in BAR_FIELDS:
            if cols.get(name) is None:
                continue
            series = _series(cols[name], name)
            if n is None:
                n = len(series)
            elif len(series) != n:
                raise _bad("bars_length_mismatch", f'"{name}" has {len(series)} values, expected {n}')
            fields[name] = series
        count = n or 0
    elif isinstance(raw, list):
        count = len(raw)
        for name in BAR_FIELDS:
            fields[name] = []
        for row in raw:
            if row is not None and not isinstance(row, dict):
                raise _bad("invalid_bars", "each bar must be an object with numeric fields")
            vals = _fields(row or {}, BAR_FIELDS, "bar", strict=False)
            for name in BAR_FIELDS:
                v = vals.get(name)
                try:
                    fields[name].append(None if v is None else _number(v))
                except TypeError:
                    raise _bad("invalid_bars", f"bar field {name!r} must be a number or null") from None
    else:
        raise _bad("invalid_bars", "bars must be an object of arrays or an array of objects")
    if count > max_bars:
        raise ApiError(413, "too_many_bars", f"{count} bars is over the limit of {max_bars}")
    return Bars(count, fields)


def _resolve(bars: Bars, done: dict[str, dict[str, Series]], source: str) -> Series:
    if source in BAR_FIELDS or source in DERIVED:
        series = bars.get(source)
        if series is None:
            raise _bad("missing_bars_field", f"the bars carry no data for {source!r}")
        return series
    ident, dot, output = source.partition(".")
    prev = done.get(ident)
    if prev is None:
        raise _bad("unknown_source", f"{source!r} is neither a bar field nor an earlier indicator id")
    if not dot:
        if len(prev) != 1:
            raise _bad("ambiguous_source", f"{ident!r} has several outputs; name one as {ident}.<output>")
        return next(iter(prev.values()))
    if output not in prev:
        raise _bad("unknown_source", f"{ident!r} has no output {output!r}")
    return prev[output]


def _finite(series: Series) -> Series:
    """NaN and infinities become null: JSON cannot carry them, and null already means "no value"."""
    return [v if v is not None and math.isfinite(v) else None for v in series]


def handle_compute(body: bytes, cfg: Config | None = None) -> dict[str, Any]:
    """Run one POST /v1/indicators request body and return the response document, or raise ApiError."""
    cfg = cfg or Config()
    try:
        # Decode as UTF-8 first: json.loads(bytes) would also accept a BOM and UTF-16/32, which the Go server refuses.
        req = json.loads(
            body.decode("utf-8"), parse_constant=_reject_constant, parse_float=_finite_float, parse_int=_finite_int
        )
    except ValueError as exc:
        raise _bad("invalid_request", f"the body is not valid JSON: {exc}") from None
    except RecursionError:
        raise _bad("invalid_request", "the body is not valid JSON: nested too deeply") from None
    if not isinstance(req, dict):
        raise _bad("invalid_request", "the request must be a JSON object")
    top = _fields(req, ("bars", "indicators"), "the request", strict=True)
    inds = top.get("indicators")
    if not isinstance(inds, list) or not inds:
        raise _bad("invalid_request", '"indicators" must list at least one indicator')
    if len(inds) > cfg.max_indicators:
        raise ApiError(413, "too_many_indicators", f"{len(inds)} indicators is over the limit of {cfg.max_indicators}")
    bars = parse_bars(top.get("bars"), cfg.max_bars)

    done: dict[str, dict[str, Series]] = {}
    results: list[dict[str, Any]] = []
    for i, raw in enumerate(inds):
        if not isinstance(raw, dict):
            raise _bad("invalid_request", f"indicators[{i}] must be an object")
        ind = _fields(raw, ("id", "fn", "inputs", "params"), f"indicators[{i}]", strict=True)
        fn = ind.get("fn", "")
        spec = BY_NAME.get(fn) if isinstance(fn, str) else None
        if spec is None:
            raise _bad("unknown_indicator", f"indicators[{i}]: unknown fn {fn!r}")
        ident = ind.get("id") or spec.fn
        if not isinstance(ident, str) or not ID_PATTERN.fullmatch(ident):
            raise _bad("invalid_id", f"indicators[{i}]: id {ident!r} must be 1-64 letters, digits, _ or -")
        if ident in BAR_FIELDS or ident in DERIVED or ident in done:
            raise _bad("duplicate_id", f"indicators[{i}]: id {ident!r} is already used")
        where = f"indicators[{i}] ({ident})"

        given_inputs = ind.get("inputs") or {}
        if not isinstance(given_inputs, dict):
            raise _bad("invalid_request", f'{where}: "inputs" must map input names to source names')
        known = {n for n, _ in spec.inputs}
        for name, source in given_inputs.items():
            if name not in known:
                raise _bad("invalid_input", f"{where}: {spec.fn!r} has no input {name!r}")
            if not isinstance(source, str):
                raise _bad("invalid_input", f"{where}: input {name!r} must be a source name")
        inputs: Inputs = {}
        for name, default in spec.inputs:
            source = given_inputs.get(name) or default
            if not source:
                raise _bad("missing_input", f"{where}: input {name!r} is required")
            try:
                inputs[name] = _resolve(bars, done, source)
            except ApiError as exc:
                raise ApiError(exc.status, exc.code, f"{where}: input {name!r}: {exc.message}") from None

        given_params = ind.get("params") or {}
        if not isinstance(given_params, dict):
            raise _bad("invalid_request", f'{where}: "params" must map param names to numbers')
        known_params = {n for n, _, _ in spec.params}
        for name in given_params:
            if name not in known_params:
                raise _bad("invalid_param", f"{where}: {spec.fn!r} has no param {name!r}")
        params: Params = {}
        for name, fallback, integer in spec.params:
            if name in given_params:
                try:
                    value = _number(given_params[name])
                except TypeError:
                    raise _bad("invalid_param", f"{where}: {name!r} must be a finite number") from None
            else:
                value = float(fallback)
            if not math.isfinite(value):
                raise _bad("invalid_param", f"{where}: {name!r} must be a finite number")
            if integer and (value < 0 or value != math.floor(value)):
                raise _bad("invalid_param", f"{where}: {name!r} must be a whole number of bars, 0 or more")
            params[name] = value

        series = {k: _finite(v) for k, v in spec.run(inputs, params).items()}
        done[ident] = series
        results.append({"id": ident, "fn": spec.fn, "series": series})
    return {"version": 1, "bars": bars.n, "results": results}


# --- routing -----------------------------------------------------------------------------------------------------


def _authorized(cfg: Config, authorization: str) -> bool:
    if not cfg.api_key:
        return True
    prefix = "Bearer "
    return authorization.startswith(prefix) and hmac.compare_digest(
        authorization[len(prefix) :].encode(), cfg.api_key.encode()
    )


def _error_doc(e: ApiError) -> dict[str, Any]:
    return {"error": {"code": e.code, "message": e.message}}


def dispatch(
    cfg: Config, method: str, path: str, authorization: str, body: bytes, too_large: bool
) -> tuple[int, dict[str, Any], dict[str, str]]:
    """Route one request. Returns the status, the JSON document and any extra headers."""
    if path == "/healthz":
        if method not in ("GET", "HEAD"):
            return 405, _error_doc(ApiError(405, "method_not_allowed", "use GET, HEAD")), {"Allow": "GET, HEAD"}
        return 200, {"status": "ok"}, {}
    if path != "/v1/indicators":
        return 404, _error_doc(ApiError(404, "not_found", "no such route")), {}
    if not _authorized(cfg, authorization):
        return 401, _error_doc(ApiError(401, "unauthorized", "a valid bearer token is required")), {}
    if method == "GET":
        return 200, catalog_payload(), {}
    if method != "POST":
        return 405, _error_doc(ApiError(405, "method_not_allowed", "use GET, POST")), {"Allow": "GET, POST"}
    if too_large:
        e = ApiError(413, "body_too_large", f"the request body is over {cfg.max_body_bytes} bytes")
        return 413, _error_doc(e), {}
    try:
        return 200, handle_compute(body, cfg), {}
    except ApiError as e:
        return e.status, _error_doc(e), {}


def _encode(doc: dict[str, Any]) -> bytes:
    return json.dumps(doc, separators=(",", ":"), allow_nan=False).encode()


# --- ASGI --------------------------------------------------------------------------------------------------------


def create_app(cfg: Config | None = None) -> Callable[[Scope, Receive, Send], Awaitable[None]]:
    """A plain ASGI application serving the three routes."""
    cfg = cfg or Config()

    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "lifespan":
            while True:
                message = await receive()
                if message["type"] == "lifespan.startup":
                    await send({"type": "lifespan.startup.complete"})
                elif message["type"] == "lifespan.shutdown":
                    await send({"type": "lifespan.shutdown.complete"})
                    return
        if scope["type"] != "http":
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        body, too_large = b"", False
        while True:
            message = await receive()
            if message["type"] != "http.request":
                continue
            if not too_large:
                body += message.get("body", b"")
                too_large = len(body) > cfg.max_body_bytes
            if not message.get("more_body", False):
                break
        status, doc, extra = dispatch(
            cfg, scope["method"], scope["path"], headers.get("authorization", ""), b"" if too_large else body, too_large
        )
        payload = _encode(doc)
        out = [
            (b"content-type", b"application/json"),
            (b"cache-control", b"no-store"),
            (b"content-length", str(len(payload)).encode()),
            *((k.lower().encode(), v.encode()) for k, v in extra.items()),
        ]
        await send({"type": "http.response.start", "status": status, "headers": out})
        await send({"type": "http.response.body", "body": b"" if scope["method"] == "HEAD" else payload})

    return app


# --- stdlib server -----------------------------------------------------------------------------------------------


def _handler(cfg: Config) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "super-chart-server"

        def _respond(self, method: str) -> None:
            path = self.path.split("?", 1)[0]
            length = self.headers.get("Content-Length")
            if method == "POST" and self.headers.get("Transfer-Encoding"):
                self._send(411, _error_doc(ApiError(411, "length_required", "send a Content-Length")), {})
                self.close_connection = True
                return
            size = int(length) if length and length.isdigit() else 0
            too_large = size > cfg.max_body_bytes
            body = b"" if too_large else self.rfile.read(size)
            if too_large:
                self.close_connection = True
            status, doc, extra = dispatch(cfg, method, path, self.headers.get("Authorization", ""), body, too_large)
            self._send(status, doc, extra, head=method == "HEAD")

        def _send(self, status: int, doc: dict[str, Any], extra: dict[str, str], head: bool = False) -> None:
            payload = _encode(doc)
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            for k, v in extra.items():
                self.send_header(k, v)
            self.end_headers()
            if not head:
                self.wfile.write(payload)

        def do_GET(self) -> None:  # noqa: N802
            self._respond("GET")

        def do_HEAD(self) -> None:  # noqa: N802
            self._respond("HEAD")

        def do_POST(self) -> None:  # noqa: N802
            self._respond("POST")

        def do_PUT(self) -> None:  # noqa: N802
            self._respond("PUT")

        def do_DELETE(self) -> None:  # noqa: N802
            self._respond("DELETE")

        def do_PATCH(self) -> None:  # noqa: N802
            self._respond("PATCH")

        def log_message(self, format: str, *args: Any) -> None:
            sys.stderr.write(f"{self.address_string()} {format % args}\n")

    return Handler


def serve(cfg: Config | None = None, host: str = "", port: int = 8787) -> None:
    """Serve until SIGINT or SIGTERM."""
    cfg = cfg or Config()
    httpd = ThreadingHTTPServer((host, port), _handler(cfg))
    httpd.daemon_threads = True

    def stop(_signum: int, _frame: Any) -> None:
        # shutdown() waits for serve_forever() to return, so it must run on another thread.
        import threading

        threading.Thread(target=httpd.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    print(f"super-chart-server listening on {host or '*'}:{port}", file=sys.stderr)
    if not cfg.api_key:
        print("warning: SUPERCHART_API_KEY is not set; the server accepts any caller", file=sys.stderr)
    try:
        httpd.serve_forever()
    finally:
        httpd.server_close()


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "")
    if not raw:
        return default
    if not raw.isdigit() or int(raw) <= 0:
        raise SystemExit(f"{name} must be a positive integer, got {raw!r}")
    return int(raw)


def main() -> None:
    """Entry point. Environment: SUPERCHART_ADDR (default :8787), SUPERCHART_API_KEY, SUPERCHART_MAX_BARS,
    SUPERCHART_MAX_INDICATORS, SUPERCHART_MAX_BODY_BYTES."""
    addr = os.environ.get("SUPERCHART_ADDR", ":8787")
    host, _, port = addr.rpartition(":")
    if not port.isdigit():
        raise SystemExit(f"SUPERCHART_ADDR must look like host:port, got {addr!r}")
    cfg = Config(
        max_bars=_env_int("SUPERCHART_MAX_BARS", 100_000),
        max_indicators=_env_int("SUPERCHART_MAX_INDICATORS", 64),
        max_body_bytes=_env_int("SUPERCHART_MAX_BODY_BYTES", 16 << 20),
        api_key=os.environ.get("SUPERCHART_API_KEY", ""),
    )
    serve(cfg, host, int(port))


if __name__ == "__main__":
    main()
