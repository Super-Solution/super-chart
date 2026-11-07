// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 SUPER SOLUTION LABS INC

package ta

import "math"

func at(s Series, i int) *float64 {
	if i < 0 || i >= len(s) {
		return nil
	}
	return s[i]
}

func orZero(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

// OBV is on-balance volume.
func OBV(close, volume Series) Series {
	out := nulls(len(close))
	acc := 0.0
	var prev *float64
	for i, c := range close {
		v := orZero(at(volume, i))
		if c == nil {
			continue
		}
		if prev != nil {
			switch {
			case *c > *prev:
				acc += v
			case *c < *prev:
				acc += -v
			}
		}
		out[i] = val(acc)
		prev = c
	}
	return out
}

// VWAP is the cumulative volume-weighted average price of hlc3 from the first bar (no session reset).
func VWAP(high, low, close, volume Series) Series {
	out := nulls(len(close))
	pv, vol := 0.0, 0.0
	for i, c := range close {
		h, l := at(high, i), at(low, i)
		v := orZero(at(volume, i))
		if h == nil || l == nil || c == nil {
			continue
		}
		pv += float64(((*h + *l + *c) / 3) * v)
		vol += v
		if vol != 0 {
			out[i] = val(pv / vol)
		}
	}
	return out
}

func hlc3(high, low, close Series) Series {
	out := nulls(len(high))
	for i, h := range high {
		l, c := at(low, i), at(close, i)
		if h != nil && l != nil && c != nil {
			out[i] = val((*h + *l + *c) / 3)
		}
	}
	return out
}

// CCI is the commodity channel index over hlc3.
func CCI(high, low, close Series, length float64) Series {
	tp := hlc3(high, low, close)
	basis, md := SMA(tp, length), Dev(tp, length)
	out := nulls(len(tp))
	for i, t := range tp {
		if t != nil && basis[i] != nil && md[i] != nil && *md[i] != 0 {
			out[i] = val((*t - *basis[i]) / float64(0.015**md[i]))
		}
	}
	return out
}

// MFI is the money flow index over hlc3.
func MFI(high, low, close, volume Series, length float64) Series {
	n := len(close)
	tp := hlc3(high, low, close)
	pos, neg := make(Series, n), make(Series, n)
	for i := range pos {
		pos[i], neg[i] = val(0), val(0)
	}
	for i := 1; i < n; i++ {
		t, p := tp[i], tp[i-1]
		v := orZero(at(volume, i))
		if t == nil || p == nil {
			continue
		}
		if *t > *p {
			pos[i] = val(float64(*t * v))
		} else if *t < *p {
			neg[i] = val(float64(*t * v))
		}
	}
	sp, sn := Sum(pos, length), Sum(neg, length)
	out := nulls(len(sp))
	for i := range sp {
		if sp[i] == nil || sn[i] == nil {
			continue
		}
		if *sn[i] == 0 {
			out[i] = val(100)
		} else {
			out[i] = val(100 - 100/(1 + *sp[i] / *sn[i]))
		}
	}
	return out
}

// StochK is the raw stochastic %K; %D is SMA(%K, d).
func StochK(high, low, close Series, length float64) Series {
	hh, ll := Highest(high, length), Lowest(low, length)
	out := nulls(len(close))
	for i, c := range close {
		if c == nil || hh[i] == nil || ll[i] == nil {
			continue
		}
		d := *hh[i] - *ll[i]
		if d == 0 {
			out[i] = val(0)
		} else {
			out[i] = val(float64(100*(*c-*ll[i])) / d)
		}
	}
	return out
}

// Stoch is the stochastic of one series: 100 * (x - lowest) / (highest - lowest); 0 on a flat window.
func Stoch(src Series, length float64) Series { return StochK(src, src, src, length) }

// StochRSIResult holds %K and %D.
type StochRSIResult struct{ K, D Series }

// StochRSI is the TradingView stochastic RSI: k = SMA(Stoch(RSI(src, rsiLen), stochLen), kLen), d = SMA(k, dLen).
func StochRSI(src Series, rsiLen, stochLen, kLen, dLen float64) StochRSIResult {
	k := SMA(Stoch(RSI(src, rsiLen), stochLen), kLen)
	return StochRSIResult{K: k, D: SMA(k, dLen)}
}

// BBPercent is Bollinger %B: (src - lower) / (upper - lower); nil where the bands are flat.
func BBPercent(src Series, length, mult float64) Series {
	b := Bollinger(src, length, mult)
	out := nulls(len(src))
	for i, v := range src {
		u, l := b.Upper[i], b.Lower[i]
		if v != nil && u != nil && l != nil && *u != *l {
			out[i] = val((*v - *l) / (*u - *l))
		}
	}
	return out
}

// SAR is Wilder's parabolic SAR, started from the first two bars.
func SAR(high, low Series, start, inc, max float64) Series {
	n := len(high)
	out := nulls(n)
	if n < 2 || low == nil || len(low) < 2 || high[0] == nil || low[0] == nil || high[1] == nil || low[1] == nil {
		return out
	}
	h0, l0, h1, l1 := *high[0], *low[0], *high[1], *low[1]
	isLong := h1 >= h0
	af := start
	ep, s := l1, h0
	if isLong {
		ep, s = h1, l0
	}
	for i := 1; i < n; i++ {
		h, l := high[i], at(low, i)
		if h == nil || l == nil {
			continue
		}
		s = s + float64(af*(ep-s))
		if isLong {
			if *l < s {
				isLong, s, ep, af = false, ep, *l, start
			} else if *h > ep {
				ep, af = *h, math.Min(af+inc, max)
			}
		} else {
			if *h > s {
				isLong, s, ep, af = true, ep, *h, start
			} else if *l < ep {
				ep, af = *l, math.Min(af+inc, max)
			}
		}
		out[i] = val(s)
	}
	return out
}

// BandsResult is a basis with an upper and a lower band.
type BandsResult struct{ Basis, Upper, Lower Series }

// Keltner is basis = EMA(close, length), basis plus or minus mult times ATR(atrLen).
func Keltner(high, low, close Series, length, mult, atrLen float64) BandsResult {
	basis, rng := EMA(close, length), ATR(high, low, close, atrLen)
	band := func(sign float64) Series {
		out := nulls(len(basis))
		for i, b := range basis {
			if b != nil && rng[i] != nil {
				out[i] = val(*b + float64(float64(sign*mult)**rng[i]))
			}
		}
		return out
	}
	return BandsResult{Basis: basis, Upper: band(1), Lower: band(-1)}
}
