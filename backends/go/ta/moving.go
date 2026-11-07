// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 SUPER SOLUTION LABS INC

package ta

import "math"

// The kernels below assume finite inputs (JSON cannot carry NaN or infinity). The explicit float64
// conversions around products stop the compiler fusing a multiply into the next add, which would
// change the last bit of a result on some architectures.

// WMA is the weighted moving average (weights 1..length, the newest heaviest), slid in O(1) per bar
// and re-seeded from the window every length bars so rounding cannot accumulate.
func WMA(src Series, length float64) Series {
	n := len(src)
	out := nulls(n)
	if !IsLength(length) {
		return out
	}
	l := int(length)
	denom := float64(l*(l+1)) / 2
	run, sinceSeed := 0, 0
	valid := false
	var s, num float64
	reseed := func(i int) {
		s, num = 0, 0
		for j := 0; j < l; j++ {
			x := *src[i-l+1+j]
			s += x
			num += float64(x * float64(j+1))
		}
		sinceSeed = 0
		valid = true
	}
	for i := 0; i < n; i++ {
		v := src[i]
		if v == nil {
			run, valid = 0, false
			continue
		}
		run++
		if run < l {
			continue
		}
		switch {
		case !valid:
			reseed(i)
		default:
			sinceSeed++
			if sinceSeed >= l {
				reseed(i)
			} else {
				// Every weight drops by one and the new bar enters with weight l.
				num = num - s + float64(float64(l)**v)
				s = s - *src[i-l] + *v
			}
		}
		out[i] = val(num / denom)
	}
	return out
}

// HMA is the Hull moving average: WMA(2*WMA(src, length/2) - WMA(src, length), sqrt(length)).
func HMA(src Series, length float64) Series {
	if !IsLength(length) || length < 2 {
		return nulls(len(src))
	}
	half, full := WMA(src, math.Floor(length/2)), WMA(src, length)
	diff := combine(half, full, func(h, f float64) float64 { return 2*h - f })
	return WMA(diff, math.Floor(math.Sqrt(length)+0.5))
}

// VWMA is the volume-weighted moving average; nil where the window's volume sums to 0.
func VWMA(src, volume Series, length float64) Series {
	n := len(src)
	pv, vol := nulls(n), nulls(n)
	for i, v := range src {
		if v == nil || i >= len(volume) || volume[i] == nil {
			if v != nil && i < len(volume) {
				vol[i] = volume[i]
			}
			continue
		}
		pv[i] = val(*v * *volume[i])
		vol[i] = volume[i]
	}
	num, den := Sum(pv, length), Sum(vol, length)
	out := nulls(n)
	for i := range num {
		if num[i] != nil && den[i] != nil && *den[i] != 0 {
			out[i] = val(*num[i] / *den[i])
		}
	}
	return out
}

// Dev is the mean absolute deviation from the window's mean (Pine ta.dev), O(n*length).
func Dev(src Series, length float64) Series {
	n := len(src)
	out := nulls(n)
	if !IsLength(length) {
		return out
	}
	l := int(length)
	run := 0
	for i := 0; i < n; i++ {
		if src[i] == nil {
			run = 0
			continue
		}
		run++
		if run < l {
			continue
		}
		a := 0.0
		for j := i - l + 1; j <= i; j++ {
			a += *src[j]
		}
		m := a / float64(l)
		d := 0.0
		for j := i - l + 1; j <= i; j++ {
			d += math.Abs(*src[j] - m)
		}
		out[i] = val(d / float64(l))
	}
	return out
}

// extreme is a rolling maximum or minimum with a monotonic deque, O(1) amortised per bar.
func extreme(src Series, length float64, max bool) Series {
	n := len(src)
	out := nulls(n)
	if !IsLength(length) || int(length) > n {
		return out
	}
	l := int(length)
	dq := make([]int, 0, l) // indices, front first
	run := 0
	for i := 0; i < n; i++ {
		v := src[i]
		if v == nil {
			run = 0
			dq = dq[:0]
			continue
		}
		run++
		if len(dq) > 0 && dq[0] <= i-l {
			dq = dq[1:]
		}
		for len(dq) > 0 {
			b := *src[dq[len(dq)-1]]
			if (max && b <= *v) || (!max && b >= *v) {
				dq = dq[:len(dq)-1]
				continue
			}
			break
		}
		dq = append(dq, i)
		if run >= l {
			out[i] = val(*src[dq[0]])
		}
	}
	return out
}

// Highest is the highest value over length bars.
func Highest(src Series, length float64) Series { return extreme(src, length, true) }

// Lowest is the lowest value over length bars.
func Lowest(src Series, length float64) Series { return extreme(src, length, false) }
