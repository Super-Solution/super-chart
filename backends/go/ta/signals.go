// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 SUPER SOLUTION LABS INC

package ta

// Change is src - src[length]. The length is a whole number of bars.
func Change(src Series, length int) Series {
	out := nulls(len(src))
	for i, v := range src {
		if i-length >= 0 && i-length < len(src) && v != nil && src[i-length] != nil {
			out[i] = val(*v - *src[i-length])
		}
	}
	return out
}

// Mom is momentum: src - src[length].
func Mom(src Series, length int) Series { return Change(src, length) }

// ROC is the rate of change in percent: 100 * (src - src[length]) / src[length].
func ROC(src Series, length int) Series {
	out := nulls(len(src))
	for i, v := range src {
		if i-length < 0 || i-length >= len(src) || v == nil || src[i-length] == nil || *src[i-length] == 0 {
			continue
		}
		p := *src[i-length]
		out[i] = val(float64(100*(*v-p)) / p)
	}
	return out
}

// crossing evaluates a rule over each bar given the previous and current values of both series.
func crossing(a, b Series, rule func(pa, pb, ca, cb float64) bool) Series {
	out := nulls(len(a))
	for i := 1; i < len(a); i++ {
		if a[i] == nil || i >= len(b) || b[i] == nil || a[i-1] == nil || b[i-1] == nil {
			continue
		}
		hit := 0.0
		if rule(*a[i-1], *b[i-1], *a[i], *b[i]) {
			hit = 1
		}
		out[i] = val(hit)
	}
	return out
}

// Crossover is 1 where a crosses above b, 0 where it does not, nil where a value is missing.
func Crossover(a, b Series) Series {
	return crossing(a, b, func(pa, pb, ca, cb float64) bool { return pa <= pb && ca > cb })
}

// Crossunder is 1 where a crosses below b.
func Crossunder(a, b Series) Series {
	return crossing(a, b, func(pa, pb, ca, cb float64) bool { return pa >= pb && ca < cb })
}

// Cross is a cross in either direction.
func Cross(a, b Series) Series {
	return crossing(a, b, func(pa, pb, ca, cb float64) bool { return (pa <= pb && ca > cb) || (pa >= pb && ca < cb) })
}

// Cum is the cumulative sum; a nil bar stays nil and does not reset the total.
func Cum(src Series) Series {
	out := nulls(len(src))
	acc := 0.0
	for i, v := range src {
		if v == nil {
			continue
		}
		acc += *v
		out[i] = val(acc)
	}
	return out
}

// BarsSince is the number of bars since cond was last true (0 on that bar), nil before the first time.
func BarsSince(cond Series) Series {
	out := nulls(len(cond))
	count := -1
	for i, c := range cond {
		switch {
		case c != nil && *c != 0:
			count = 0
		case count >= 0:
			count++
		}
		if count >= 0 {
			out[i] = val(float64(count))
		}
	}
	return out
}
