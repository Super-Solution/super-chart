// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 SUPER SOLUTION LABS INC

package ta

import (
	"math"
	"testing"
)

// benchBars builds a deterministic price series of n bars with a few gaps.
func benchBars(n int) (high, low, closes, volume Series) {
	high, low, closes, volume = make(Series, n), make(Series, n), make(Series, n), make(Series, n)
	for i := 0; i < n; i++ {
		base := 100 + 10*math.Sin(float64(i)/17) + float64(i%7)
		if i%997 == 500 {
			continue
		}
		high[i], low[i], closes[i], volume[i] = val(base+1.5), val(base-1.5), val(base), val(1000+float64(i%13)*10)
	}
	return
}

func BenchmarkKernels(b *testing.B) {
	high, low, closes, volume := benchBars(100_000)
	cases := []struct {
		name string
		run  func()
	}{
		{"SMA20", func() { SMA(closes, 20) }},
		{"EMA20", func() { EMA(closes, 20) }},
		{"RSI14", func() { RSI(closes, 14) }},
		{"Stdev20", func() { Stdev(closes, 20) }},
		{"MACD", func() { MACD(closes, 12, 26, 9) }},
		{"ATR14", func() { ATR(high, low, closes, 14) }},
		{"WMA20", func() { WMA(closes, 20) }},
		{"HMA20", func() { HMA(closes, 20) }},
		{"Highest20", func() { Highest(closes, 20) }},
		{"CCI20", func() { CCI(high, low, closes, 20) }},
		{"MFI14", func() { MFI(high, low, closes, volume, 14) }},
		{"SAR", func() { SAR(high, low, 0.02, 0.02, 0.2) }},
	}
	for _, c := range cases {
		b.Run(c.name, func(b *testing.B) {
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				c.run()
			}
		})
	}
}
