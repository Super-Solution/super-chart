// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 SUPER SOLUTION LABS INC

package server

import "github.com/Super-Solution/super-chart/backends/go/ta"

type input struct {
	Name string `json:"name"`
	// Default is the bar field read when the request names no source; empty means the input is required.
	Default string `json:"default,omitempty"`
}

type param struct {
	Name    string  `json:"name"`
	Default float64 `json:"default"`
	// Integer params are whole numbers of bars; a fractional value is rejected instead of truncated.
	Integer bool `json:"integer,omitempty"`
}

type spec struct {
	Name    string   `json:"fn"`
	Inputs  []input  `json:"inputs"`
	Params  []param  `json:"params"`
	Outputs []string `json:"outputs"`
	run     func(in map[string]ta.Series, p map[string]float64) map[string]ta.Series
}

func one(s ta.Series) map[string]ta.Series { return map[string]ta.Series{"value": s} }

var (
	srcIn   = []input{{"src", "close"}}
	hlcIn   = []input{{"high", "high"}, {"low", "low"}, {"close", "close"}}
	hlcvIn  = []input{{"high", "high"}, {"low", "low"}, {"close", "close"}, {"volume", "volume"}}
	pairIn  = []input{{"a", ""}, {"b", ""}}
	lenOnly = func(def float64) []param { return []param{{"len", def, false}} }
	barsLen = func(def float64) []param { return []param{{"len", def, true}} }
	value   = []string{"value"}
)

func windowed(name string, f func(ta.Series, float64) ta.Series) spec {
	return spec{name, srcIn, lenOnly(14), value, func(in map[string]ta.Series, p map[string]float64) map[string]ta.Series {
		return one(f(in["src"], p["len"]))
	}}
}

func lagged(name string, def float64, f func(ta.Series, int) ta.Series) spec {
	return spec{name, srcIn, barsLen(def), value, func(in map[string]ta.Series, p map[string]float64) map[string]ta.Series {
		return one(f(in["src"], int(p["len"])))
	}}
}

func crossing(name string, f func(a, b ta.Series) ta.Series) spec {
	return spec{name, pairIn, nil, value, func(in map[string]ta.Series, _ map[string]float64) map[string]ta.Series {
		return one(f(in["a"], in["b"]))
	}}
}

// catalog lists every indicator the server can run, in the order GET /v1/indicators reports them.
// It mirrors the kernels in ../ta and the Python server's catalog; keep the three in step.
var catalog = []spec{
	windowed("sma", ta.SMA),
	windowed("ema", ta.EMA),
	windowed("rma", ta.RMA),
	windowed("wma", ta.WMA),
	windowed("hma", ta.HMA),
	windowed("rsi", ta.RSI),
	windowed("stdev", ta.Stdev),
	windowed("dev", ta.Dev),
	windowed("highest", ta.Highest),
	windowed("lowest", ta.Lowest),
	{"vwma", []input{{"src", "close"}, {"volume", "volume"}}, lenOnly(14), value,
		func(in map[string]ta.Series, p map[string]float64) map[string]ta.Series {
			return one(ta.VWMA(in["src"], in["volume"], p["len"]))
		}},
	{"bollinger", srcIn, []param{{"len", 20, false}, {"mult", 2, false}}, []string{"basis", "upper", "lower"},
		func(in map[string]ta.Series, p map[string]float64) map[string]ta.Series {
			r := ta.Bollinger(in["src"], p["len"], p["mult"])
			return map[string]ta.Series{"basis": r.Basis, "upper": r.Upper, "lower": r.Lower}
		}},
	{"bbPercent", srcIn, []param{{"len", 20, false}, {"mult", 2, false}}, value,
		func(in map[string]ta.Series, p map[string]float64) map[string]ta.Series {
			return one(ta.BBPercent(in["src"], p["len"], p["mult"]))
		}},
	{"macd", srcIn, []param{{"fast", 12, false}, {"slow", 26, false}, {"signal", 9, false}}, []string{"dif", "dea", "hist"},
		func(in map[string]ta.Series, p map[string]float64) map[string]ta.Series {
			r := ta.MACD(in["src"], p["fast"], p["slow"], p["signal"])
			return map[string]ta.Series{"dif": r.Dif, "dea": r.Dea, "hist": r.Hist}
		}},
	{"trueRange", hlcIn, nil, value,
		func(in map[string]ta.Series, _ map[string]float64) map[string]ta.Series {
			return one(ta.TrueRange(in["high"], in["low"], in["close"]))
		}},
	{"atr", hlcIn, lenOnly(14), value,
		func(in map[string]ta.Series, p map[string]float64) map[string]ta.Series {
			return one(ta.ATR(in["high"], in["low"], in["close"], p["len"]))
		}},
	{"keltner", hlcIn, []param{{"len", 20, false}, {"mult", 2, false}, {"atrLen", 10, false}}, []string{"basis", "upper", "lower"},
		func(in map[string]ta.Series, p map[string]float64) map[string]ta.Series {
			r := ta.Keltner(in["high"], in["low"], in["close"], p["len"], p["mult"], p["atrLen"])
			return map[string]ta.Series{"basis": r.Basis, "upper": r.Upper, "lower": r.Lower}
		}},
	lagged("change", 1, ta.Change),
	lagged("mom", 10, ta.Mom),
	lagged("roc", 10, ta.ROC),
	crossing("crossover", ta.Crossover),
	crossing("crossunder", ta.Crossunder),
	crossing("cross", ta.Cross),
	{"cum", srcIn, nil, value, func(in map[string]ta.Series, _ map[string]float64) map[string]ta.Series {
		return one(ta.Cum(in["src"]))
	}},
	{"barssince", []input{{"cond", ""}}, nil, value, func(in map[string]ta.Series, _ map[string]float64) map[string]ta.Series {
		return one(ta.BarsSince(in["cond"]))
	}},
	{"obv", []input{{"close", "close"}, {"volume", "volume"}}, nil, value,
		func(in map[string]ta.Series, _ map[string]float64) map[string]ta.Series {
			return one(ta.OBV(in["close"], in["volume"]))
		}},
	{"vwap", hlcvIn, nil, value, func(in map[string]ta.Series, _ map[string]float64) map[string]ta.Series {
		return one(ta.VWAP(in["high"], in["low"], in["close"], in["volume"]))
	}},
	{"cci", hlcIn, lenOnly(20), value, func(in map[string]ta.Series, p map[string]float64) map[string]ta.Series {
		return one(ta.CCI(in["high"], in["low"], in["close"], p["len"]))
	}},
	{"mfi", hlcvIn, lenOnly(14), value, func(in map[string]ta.Series, p map[string]float64) map[string]ta.Series {
		return one(ta.MFI(in["high"], in["low"], in["close"], in["volume"], p["len"]))
	}},
	{"stochK", hlcIn, lenOnly(14), value, func(in map[string]ta.Series, p map[string]float64) map[string]ta.Series {
		return one(ta.StochK(in["high"], in["low"], in["close"], p["len"]))
	}},
	windowed("stoch", ta.Stoch),
	{"stochRsi", srcIn, []param{{"rsiLen", 14, false}, {"stochLen", 14, false}, {"kLen", 3, false}, {"dLen", 3, false}}, []string{"k", "d"},
		func(in map[string]ta.Series, p map[string]float64) map[string]ta.Series {
			r := ta.StochRSI(in["src"], p["rsiLen"], p["stochLen"], p["kLen"], p["dLen"])
			return map[string]ta.Series{"k": r.K, "d": r.D}
		}},
	{"sar", []input{{"high", "high"}, {"low", "low"}}, []param{{"start", 0.02, false}, {"inc", 0.02, false}, {"max", 0.2, false}}, value,
		func(in map[string]ta.Series, p map[string]float64) map[string]ta.Series {
			return one(ta.SAR(in["high"], in["low"], p["start"], p["inc"], p["max"]))
		}},
}

var byName = func() map[string]*spec {
	m := make(map[string]*spec, len(catalog))
	for i := range catalog {
		m[catalog[i].Name] = &catalog[i]
	}
	return m
}()

// Lists marshal as [] rather than null when empty.
func init() {
	for i := range catalog {
		if catalog[i].Params == nil {
			catalog[i].Params = []param{}
		}
	}
}
