// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 SUPER SOLUTION LABS INC

package ta

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"testing"
)

type args struct {
	Src    Series  `json:"src"`
	Len    float64 `json:"len"`
	Mult   float64 `json:"mult"`
	Fast   float64 `json:"fast"`
	Slow   float64 `json:"slow"`
	Signal float64 `json:"signal"`
	High   Series  `json:"high"`
	Low    Series  `json:"low"`
	Close  Series  `json:"close"`
	Volume Series  `json:"volume"`
	A      Series  `json:"a"`
	B      Series  `json:"b"`
	Cond   Series  `json:"cond"`

	RSILen   float64 `json:"rsiLen"`
	StochLen float64 `json:"stochLen"`
	KLen     float64 `json:"kLen"`
	DLen     float64 `json:"dLen"`
	Start    float64 `json:"start"`
	Inc      float64 `json:"inc"`
	Max      float64 `json:"max"`
	ATRLen   float64 `json:"atrLen"`

	Periods   Series  `json:"periods"`
	Kind      float64 `json:"kind"`
	Deviation float64 `json:"deviation"`
	Long      float64 `json:"long"`
	Short     float64 `json:"short"`
	Mid       float64 `json:"mid"`
}

type testCase struct {
	Fn        string          `json:"fn"`
	Args      args            `json:"args"`
	Tolerance float64         `json:"tolerance"`
	Expect    json.RawMessage `json:"expect"`
}

func run(c testCase) map[string]Series {
	a := c.Args
	switch c.Fn {
	case "sma":
		return map[string]Series{"": SMA(a.Src, a.Len)}
	case "ema":
		return map[string]Series{"": EMA(a.Src, a.Len)}
	case "rma":
		return map[string]Series{"": RMA(a.Src, a.Len)}
	case "rsi":
		return map[string]Series{"": RSI(a.Src, a.Len)}
	case "stdev":
		return map[string]Series{"": Stdev(a.Src, a.Len)}
	case "bollinger":
		r := Bollinger(a.Src, a.Len, a.Mult)
		return map[string]Series{"basis": r.Basis, "upper": r.Upper, "lower": r.Lower}
	case "macd":
		r := MACD(a.Src, a.Fast, a.Slow, a.Signal)
		return map[string]Series{"dif": r.Dif, "dea": r.Dea, "hist": r.Hist}
	case "trueRange":
		return map[string]Series{"": TrueRange(a.High, a.Low, a.Close)}
	case "atr":
		return map[string]Series{"": ATR(a.High, a.Low, a.Close, a.Len)}
	case "wma":
		return map[string]Series{"": WMA(a.Src, a.Len)}
	case "hma":
		return map[string]Series{"": HMA(a.Src, a.Len)}
	case "vwma":
		return map[string]Series{"": VWMA(a.Src, a.Volume, a.Len)}
	case "dev":
		return map[string]Series{"": Dev(a.Src, a.Len)}
	case "highest":
		return map[string]Series{"": Highest(a.Src, a.Len)}
	case "lowest":
		return map[string]Series{"": Lowest(a.Src, a.Len)}
	case "change":
		return map[string]Series{"": Change(a.Src, int(a.Len))}
	case "mom":
		return map[string]Series{"": Mom(a.Src, int(a.Len))}
	case "roc":
		return map[string]Series{"": ROC(a.Src, int(a.Len))}
	case "crossover":
		return map[string]Series{"": Crossover(a.A, a.B)}
	case "crossunder":
		return map[string]Series{"": Crossunder(a.A, a.B)}
	case "cross":
		return map[string]Series{"": Cross(a.A, a.B)}
	case "cum":
		return map[string]Series{"": Cum(a.Src)}
	case "barssince":
		return map[string]Series{"": BarsSince(a.Cond)}
	case "obv":
		return map[string]Series{"": OBV(a.Close, a.Volume)}
	case "vwap":
		return map[string]Series{"": VWAP(a.High, a.Low, a.Close, a.Volume)}
	case "cci":
		return map[string]Series{"": CCI(a.High, a.Low, a.Close, a.Len)}
	case "mfi":
		return map[string]Series{"": MFI(a.High, a.Low, a.Close, a.Volume, a.Len)}
	case "stochK":
		return map[string]Series{"": StochK(a.High, a.Low, a.Close, a.Len)}
	case "stoch":
		return map[string]Series{"": Stoch(a.Src, a.Len)}
	case "stochRsi":
		r := StochRSI(a.Src, a.RSILen, a.StochLen, a.KLen, a.DLen)
		return map[string]Series{"k": r.K, "d": r.D}
	case "bbPercent":
		return map[string]Series{"": BBPercent(a.Src, a.Len, a.Mult)}
	case "sar":
		return map[string]Series{"": SAR(a.High, a.Low, a.Start, a.Inc, a.Max)}
	case "keltner":
		r := Keltner(a.High, a.Low, a.Close, a.Len, a.Mult, a.ATRLen)
		return map[string]Series{"basis": r.Basis, "upper": r.Upper, "lower": r.Lower}
	case "aroon":
		r := Aroon(a.High, a.Low, a.Len)
		return map[string]Series{"up": r.Up, "down": r.Down}
	case "cmf":
		return map[string]Series{"": CMF(a.High, a.Low, a.Close, a.Volume, a.Len)}
	case "adl":
		return map[string]Series{"": ADL(a.High, a.Low, a.Close, a.Volume)}
	case "forceIndex":
		return map[string]Series{"": ForceIndex(a.Close, a.Volume, a.Len)}
	case "vortex":
		r := Vortex(a.High, a.Low, a.Close, a.Len)
		return map[string]Series{"plus": r.Plus, "minus": r.Minus}
	case "tsi":
		r := TSI(a.Src, a.Long, a.Short, a.Signal)
		return map[string]Series{"tsi": r.TSI, "signal": r.Signal}
	case "ultimate":
		return map[string]Series{"": Ultimate(a.High, a.Low, a.Close, a.Fast, a.Mid, a.Slow)}
	case "zigzag":
		r := ZigZag(a.High, a.Low, a.Deviation)
		return map[string]Series{"line": r.Line, "pivot": r.Pivot}
	case "pivotPoints":
		r := PivotPoints(a.High, a.Low, a.Close, a.Periods, a.Kind)
		return map[string]Series{"pp": r.PP, "r1": r.R1, "r2": r.R2, "r3": r.R3, "s1": r.S1, "s2": r.S2, "s3": r.S3}
	case "chandelier":
		r := Chandelier(a.High, a.Low, a.Close, a.Len, a.Mult)
		return map[string]Series{"long": r.Long, "short": r.Short}
	}
	panic("unknown function " + c.Fn)
}

func compare(got, want Series, tolerance float64) error {
	if len(got) != len(want) {
		return fmt.Errorf("length %d, want %d", len(got), len(want))
	}
	for i := range want {
		switch {
		case want[i] == nil || got[i] == nil:
			if want[i] != got[i] {
				return fmt.Errorf("[%d]: %v, want %v", i, show(got[i]), show(want[i]))
			}
		case math.Abs(*got[i]-*want[i]) > tolerance*math.Max(1, math.Abs(*want[i])):
			return fmt.Errorf("[%d]: %v, want %v", i, *got[i], *want[i])
		}
	}
	return nil
}

func show(p *float64) any {
	if p == nil {
		return "null"
	}
	return *p
}

func TestConformance(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "conformance", "indicators.v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	var data struct {
		Cases []testCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &data); err != nil {
		t.Fatal(err)
	}
	if len(data.Cases) < 300 {
		t.Fatalf("only %d cases", len(data.Cases))
	}
	for i, c := range data.Cases {
		got := run(c)
		var want map[string]Series
		var single Series
		if json.Unmarshal(c.Expect, &single) == nil {
			want = map[string]Series{"": single}
		} else if err := json.Unmarshal(c.Expect, &want); err != nil {
			t.Fatal(err)
		}
		if len(got) != len(want) {
			t.Errorf("case %d (%s): %d series, want %d", i, c.Fn, len(got), len(want))
			continue
		}
		for name, series := range want {
			if err := compare(got[name], series, c.Tolerance); err != nil {
				t.Errorf("case %d (%s %s): %v", i, c.Fn, name, err)
			}
		}
	}
}
