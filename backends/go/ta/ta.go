// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 SUPER SOLUTION LABS INC

// Package ta holds the Super Chart technical-analysis kernels in Go.
//
// Ports of packages/core/src/ta.ts: the 33 kernels listed in conformance/README.md (moving averages,
// oscillators, bands, signals, volume indicators and SAR). A Series is a slice of nullable floats (nil is
// null). Windows restart after a nil, results are nil until a window is ready, and an unusable length (not a
// positive integer) gives all nil, exactly like the reference. conformance/indicators.v1.json is the shared test data.
//
// Not covered: the other indicators in ta.ts (linreg, correlation, valuewhen, the pivots, ...).
package ta

import "math"

// Series is a list of values where nil means no value.
type Series []*float64

func val(x float64) *float64 { return &x }

func nulls(n int) Series { return make(Series, n) }

// IsLength reports whether length is a usable window: a positive integer.
func IsLength(length float64) bool {
	return length >= 1 && length == math.Floor(length) && !math.IsInf(length, 0)
}

func plainSum(src Series, from, to int) float64 {
	a := 0.0
	for j := from; j <= to; j++ {
		a += *src[j]
	}
	return a
}

func neumaier(s, c, x float64) (float64, float64) {
	t := s + x
	if math.Abs(s) >= math.Abs(x) {
		c += (s - t) + x
	} else {
		c += (x - t) + s
	}
	return t, c
}

// Sum is the rolling sum over length bars with Neumaier compensation, like the reference.
func Sum(src Series, length float64) Series {
	n := len(src)
	out := nulls(n)
	if !IsLength(length) {
		return out
	}
	l := int(length)
	run, lastBad, valid, sinceSeed := 0, -1, false, 0
	s, c := 0.0, 0.0
	for i := 0; i < n; i++ {
		v := src[i]
		if v == nil {
			run, valid = 0, false
			continue
		}
		run++
		if math.IsNaN(*v) || math.IsInf(*v, 0) {
			lastBad = i
		}
		if run < l {
			continue
		}
		if lastBad > i-l {
			out[i] = val(plainSum(src, i-l+1, i))
			valid = false
			continue
		}
		sinceSeed++
		if !valid || sinceSeed >= l {
			s, c = 0, 0
			for j := i - l + 1; j <= i; j++ {
				s, c = neumaier(s, c, *src[j])
			}
			sinceSeed = 0
			valid = true
		} else {
			s, c = neumaier(s, c, -*src[i-l])
			s, c = neumaier(s, c, *v)
		}
		out[i] = val(s + c)
	}
	return out
}

// SMA is the simple moving average.
func SMA(src Series, length float64) Series {
	out := Sum(src, length)
	for i, v := range out {
		if v != nil {
			out[i] = val(*v / length)
		}
	}
	return out
}

func seededAverage(src Series, length float64, step func(prev, v, n float64) float64) Series {
	out := nulls(len(src))
	if !IsLength(length) {
		return out
	}
	l := int(length)
	var prev *float64
	seedSum, seedCount := 0.0, 0
	for i, v := range src {
		if v == nil {
			continue
		}
		if prev == nil {
			seedSum += *v
			seedCount++
			if seedCount == l {
				prev = val(seedSum / float64(l))
				out[i] = val(*prev)
			}
		} else {
			prev = val(step(*prev, *v, float64(l)))
			out[i] = val(*prev)
		}
	}
	return out
}

// EMA is the exponential moving average seeded with the average of the first length values.
func EMA(src Series, length float64) Series {
	return seededAverage(src, length, func(prev, v, n float64) float64 { return (2*v + (n-1)*prev) / (n + 1) })
}

// RMA is Wilder's moving average seeded with the average of the first length values.
func RMA(src Series, length float64) Series {
	return seededAverage(src, length, func(prev, v, n float64) float64 { return (prev*(n-1) + v) / n })
}

func rsiFrom(gain, loss float64) float64 {
	if loss == 0 {
		return 100
	}
	if gain == 0 {
		return 0
	}
	return 100 - 100/(1+gain/loss)
}

// RSI is Wilder's RSI: 100 when the average loss is 0, 0 when the average gain is 0.
func RSI(src Series, length float64) Series {
	out := nulls(len(src))
	if !IsLength(length) {
		return out
	}
	l := int(length)
	avgGain, avgLoss := 0.0, 0.0
	var prev *float64
	seeded := 0
	for i, v := range src {
		if v == nil {
			prev = nil
			continue
		}
		if prev != nil {
			change := *v - *prev
			gain, loss := math.Max(change, 0), math.Max(-change, 0)
			if seeded < l {
				avgGain += gain
				avgLoss += loss
				seeded++
				if seeded == l {
					avgGain /= float64(l)
					avgLoss /= float64(l)
					out[i] = val(rsiFrom(avgGain, avgLoss))
				}
			} else {
				avgGain = (avgGain*float64(l-1) + gain) / float64(l)
				avgLoss = (avgLoss*float64(l-1) + loss) / float64(l)
				out[i] = val(rsiFrom(avgGain, avgLoss))
			}
		}
		prev = v
	}
	return out
}

// MACDResult holds the three MACD series.
type MACDResult struct{ Dif, Dea, Hist Series }

func combine(a, b Series, f func(x, y float64) float64) Series {
	out := nulls(len(a))
	for i := range a {
		if a[i] != nil && b[i] != nil {
			out[i] = val(f(*a[i], *b[i]))
		}
	}
	return out
}

// MACD is dif = ema(fast) - ema(slow), dea = ema(dif, signal), hist = dif - dea.
func MACD(src Series, fast, slow, signal float64) MACDResult {
	dif := combine(EMA(src, fast), EMA(src, slow), func(x, y float64) float64 { return x - y })
	dea := EMA(dif, signal)
	hist := combine(dif, dea, func(x, y float64) float64 { return x - y })
	return MACDResult{dif, dea, hist}
}

// Stdev is the population standard deviation over length bars (sliding Welford, re-seeded every window).
func Stdev(src Series, length float64) Series {
	n := len(src)
	out := nulls(n)
	if !IsLength(length) {
		return out
	}
	l := int(length)
	run, lastBad, valid, sinceSeed := 0, -1, false, 0
	mean, m2 := 0.0, 0.0
	for i := 0; i < n; i++ {
		v := src[i]
		if v == nil {
			run, valid = 0, false
			continue
		}
		run++
		if math.IsNaN(*v) || math.IsInf(*v, 0) {
			lastBad = i
		}
		if run < l {
			continue
		}
		reseed := lastBad > i-l || !valid
		if !reseed {
			sinceSeed++
			reseed = sinceSeed >= l
		}
		if reseed {
			a := 0.0
			for j := i - l + 1; j <= i; j++ {
				a += *src[j]
			}
			m := a / float64(l)
			q := 0.0
			for j := i - l + 1; j <= i; j++ {
				d := *src[j] - m
				q += d * d
			}
			out[i] = val(math.Sqrt(q / float64(l)))
			valid = !(lastBad > i-l)
			if valid {
				mean, m2, sinceSeed = m, q, 0
			}
			continue
		}
		o := *src[i-l]
		next := mean + (*v-o)/float64(l)
		m2 += (*v - o) * (*v - next + o - mean)
		mean = next
		out[i] = val(math.Sqrt(math.Max(m2, 0) / float64(l)))
	}
	return out
}

// BollingerResult holds the three Bollinger series.
type BollingerResult struct{ Basis, Upper, Lower Series }

// Bollinger is basis = SMA, upper and lower = basis plus or minus mult times the population stdev.
func Bollinger(src Series, length, mult float64) BollingerResult {
	basis, sd := SMA(src, length), Stdev(src, length)
	return BollingerResult{
		Basis: basis,
		Upper: combine(basis, sd, func(b, d float64) float64 { return b + mult*d }),
		Lower: combine(basis, sd, func(b, d float64) float64 { return b - mult*d }),
	}
}

// TrueRange is the true range; the first bar (no previous close) is high - low.
func TrueRange(high, low, close Series) Series {
	out := nulls(len(high))
	for i, h := range high {
		lo := low[i]
		if h == nil || lo == nil {
			continue
		}
		if i == 0 || close[i-1] == nil {
			out[i] = val(*h - *lo)
			continue
		}
		pc := *close[i-1]
		out[i] = val(math.Max(*h-*lo, math.Max(math.Abs(*h-pc), math.Abs(*lo-pc))))
	}
	return out
}

// ATR is the average true range: RMA of the true range.
func ATR(high, low, close Series, length float64) Series {
	return RMA(TrueRange(high, low, close), length)
}
