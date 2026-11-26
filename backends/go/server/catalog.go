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
// It mirrors the kernels in ../ta and the Python server's catalog; keep the three in step. PivotPoints is a kernel
// but not a catalog entry: it needs a period key per bar and a request carries no timestamps.
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
	{"aroon", []input{{"high", "high"}, {"low", "low"}}, lenOnly(14), []string{"up", "down"},
		func(in map[string]ta.Series, p map[string]float64) map[string]ta.Series {
			r := ta.Aroon(in["high"], in["low"], p["len"])
			return map[string]ta.Series{"up": r.Up, "down": r.Down}
		}},
	{"cmf", hlcvIn, lenOnly(20), value, func(in map[string]ta.Series, p map[string]float64) map[string]ta.Series {
		return one(ta.CMF(in["high"], in["low"], in["close"], in["volume"], p["len"]))
	}},
	{"adl", hlcvIn, nil, value, func(in map[string]ta.Series, _ map[string]float64) map[string]ta.Series {
		return one(ta.ADL(in["high"], in["low"], in["close"], in["volume"]))
	}},
	{"forceIndex", []input{{"close", "close"}, {"volume", "volume"}}, lenOnly(13), value,
		func(in map[string]ta.Series, p map[string]float64) map[string]ta.Series {
			return one(ta.ForceIndex(in["close"], in["volume"], p["len"]))
		}},
	{"vortex", hlcIn, lenOnly(14), []string{"plus", "minus"}, func(in map[string]ta.Series, p map[string]float64) map[string]ta.Series {
		r := ta.Vortex(in["high"], in["low"], in["close"], p["len"])
		return map[string]ta.Series{"plus": r.Plus, "minus": r.Minus}
	}},
	{"tsi", srcIn, []param{{"long", 25, false}, {"short", 13, false}, {"signal", 13, false}}, []string{"tsi", "signal"},
		func(in map[string]ta.Series, p map[string]float64) map[string]ta.Series {
			r := ta.TSI(in["src"], p["long"], p["short"], p["signal"])
			return map[string]ta.Series{"tsi": r.TSI, "signal": r.Signal}
		}},
	{"ultimate", hlcIn, []param{{"fast", 7, false}, {"mid", 14, false}, {"slow", 28, false}}, value,
		func(in map[string]ta.Series, p map[string]float64) map[string]ta.Series {
			return one(ta.Ultimate(in["high"], in["low"], in["close"], p["fast"], p["mid"], p["slow"]))
		}},
	{"zigzag", []input{{"high", "high"}, {"low", "low"}}, []param{{"deviation", 5, false}}, []string{"line", "pivot"},
		func(in map[string]ta.Series, p map[string]float64) map[string]ta.Series {
			r := ta.ZigZag(in["high"], in["low"], p["deviation"])
			return map[string]ta.Series{"line": r.Line, "pivot": r.Pivot}
		}},
	{"chandelier", hlcIn, []param{{"len", 22, false}, {"mult", 3, false}}, []string{"long", "short"},
		func(in map[string]ta.Series, p map[string]float64) map[string]ta.Series {
			r := ta.Chandelier(in["high"], in["low"], in["close"], p["len"], p["mult"])
			return map[string]ta.Series{"long": r.Long, "short": r.Short}
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
