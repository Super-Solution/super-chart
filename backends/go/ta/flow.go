// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 SUPER SOLUTION LABS INC

package ta

import "math"

// Volume flow, trend, momentum and reference-level indicators (ports of aroon ... chandelier in
// packages/core/src/ta.ts). A bar missing a price, or holding a value that is not finite, is a gap.

// fin reads s[i] when it is there and finite.
func fin(s Series, i int) (float64, bool) {
	if i < 0 || i >= len(s) || s[i] == nil {
		return 0, false
	}
	v := *s[i]
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0, false
	}
	return v, true
}

// barsSinceExtreme is the number of bars since the extreme of the last window values (0 is this bar), the
// most recent bar winning a tie. A gap restarts the window; the first output needs window finite values.
func barsSinceExtreme(src Series, window int, max bool) Series {
	n := len(src)
	out := nulls(n)
	if window < 1 {
		return out
	}
	queue := make([]int, n)
	head, tail, run := 0, 0, 0
	for i := 0; i < n; i++ {
		v, ok := fin(src, i)
		if !ok {
			head, tail, run = 0, 0, 0
			continue
		}
		run++
		for tail > head {
			last := *src[queue[tail-1]]
			if (max && last <= v) || (!max && last >= v) {
				tail--
				continue
			}
			break
		}
		queue[tail] = i
		tail++
		for queue[head] <= i-window {
			head++
		}
		if run >= window {
			out[i] = val(float64(i - queue[head]))
		}
	}
	return out
}

// AroonResult holds Aroon Up and Aroon Down.
type AroonResult struct{ Up, Down Series }

// Aroon is 100 * (length - barsSinceHigh) / length over the last length+1 bars, and the same for the low.
func Aroon(high, low Series, length float64) AroonResult {
	n := len(high)
	if !IsLength(length) {
		return AroonResult{Up: nulls(n), Down: nulls(n)}
	}
	score := func(bars Series) Series {
		out := nulls(len(bars))
		for i, k := range bars {
			if k != nil {
				out[i] = val(float64(100*(length-*k)) / length)
			}
		}
		return out
	}
	w := int(length) + 1
	return AroonResult{Up: score(barsSinceExtreme(high, w, true)), Down: score(barsSinceExtreme(low, w, false))}
}

// moneyFlow is the close's position in the range (-1 at the low, +1 at the high; 0 without a range) times
// volume. A missing volume counts as 0; a bar missing a high, low or close is a gap in both series.
func moneyFlow(high, low, close, volume Series) (flow, vol Series) {
	n := len(close)
	flow, vol = nulls(n), nulls(n)
	for i := 0; i < n; i++ {
		h, okH := fin(high, i)
		l, okL := fin(low, i)
		c, okC := fin(close, i)
		if !okH || !okL || !okC {
			continue
		}
		v, _ := fin(volume, i)
		m := 0.0
		if h != l {
			m = ((c - l) - (h - c)) / (h - l)
		}
		flow[i] = val(float64(m * v))
		vol[i] = val(v)
	}
	return flow, vol
}

// ADL is the accumulation/distribution line: the running total of money flow volume.
func ADL(high, low, close, volume Series) Series {
	flow, _ := moneyFlow(high, low, close, volume)
	out := nulls(len(flow))
	total := 0.0
	for i, f := range flow {
		if f == nil {
			continue
		}
		total += *f
		out[i] = val(total)
	}
	return out
}

// CMF is Chaikin money flow: money flow volume over volume, summed over length bars; nil without volume.
func CMF(high, low, close, volume Series, length float64) Series {
	flow, vol := moneyFlow(high, low, close, volume)
	a, b := Sum(flow, length), Sum(vol, length)
	out := nulls(len(a))
	for i := range a {
		if a[i] != nil && b[i] != nil && *b[i] != 0 {
			out[i] = val(*a[i] / *b[i])
		}
	}
	return out
}

// ForceIndex is the EMA of (close change) * volume.
func ForceIndex(close, volume Series, length float64) Series {
	n := len(close)
	raw := nulls(n)
	for i := 1; i < n; i++ {
		c, okC := fin(close, i)
		p, okP := fin(close, i-1)
		if !okC || !okP {
			continue
		}
		v, _ := fin(volume, i)
		raw[i] = val(float64((c - p) * v))
	}
	return EMA(raw, length)
}

// VortexResult holds VI+ and VI-.
type VortexResult struct{ Plus, Minus Series }

// Vortex is the vortex indicator: sum(|high - previous low|) / sum(TR) and sum(|low - previous high|) / sum(TR).
// A bar needs a finite high, low and close on itself and on the bar before.
func Vortex(high, low, close Series, length float64) VortexResult {
	n := len(close)
	up, down, rng := nulls(n), nulls(n), nulls(n)
	for i := 1; i < n; i++ {
		h, ok1 := fin(high, i)
		l, ok2 := fin(low, i)
		_, ok3 := fin(close, i)
		ph, ok4 := fin(high, i-1)
		pl, ok5 := fin(low, i-1)
		pc, ok6 := fin(close, i-1)
		if !ok1 || !ok2 || !ok3 || !ok4 || !ok5 || !ok6 {
			continue
		}
		up[i] = val(math.Abs(h - pl))
		down[i] = val(math.Abs(l - ph))
		rng[i] = val(math.Max(h-l, math.Max(math.Abs(h-pc), math.Abs(l-pc))))
	}
	tr := Sum(rng, length)
	ratio := func(s Series) Series {
		total := Sum(s, length)
		out := nulls(len(total))
		for i := range total {
			if total[i] != nil && tr[i] != nil && *tr[i] != 0 {
				out[i] = val(*total[i] / *tr[i])
			}
		}
		return out
	}
	return VortexResult{Plus: ratio(up), Minus: ratio(down)}
}

// TSIResult holds the true strength index and its signal.
type TSIResult struct{ TSI, Signal Series }

// TSI is 100 * EMA(EMA(change, long), short) / EMA(EMA(|change|, long), short) with an EMA signal; nil when flat.
func TSI(src Series, long, short, signal float64) TSIResult {
	n := len(src)
	move, size := nulls(n), nulls(n)
	for i := 1; i < n; i++ {
		c, okC := fin(src, i)
		p, okP := fin(src, i-1)
		if !okC || !okP {
			continue
		}
		move[i] = val(c - p)
		size[i] = val(math.Abs(c - p))
	}
	top := EMA(EMA(move, long), short)
	bottom := EMA(EMA(size, long), short)
	line := nulls(n)
	for i := range top {
		if top[i] != nil && bottom[i] != nil && *bottom[i] != 0 {
			line[i] = val(float64(100**top[i]) / *bottom[i])
		}
	}
	return TSIResult{TSI: line, Signal: EMA(line, signal)}
}

// Ultimate is the ultimate oscillator: buying pressure over true range for three windows, weighted 4, 2, 1, 0..100.
func Ultimate(high, low, close Series, a, b, c float64) Series {
	n := len(close)
	pressure, rng := nulls(n), nulls(n)
	for i := 1; i < n; i++ {
		h, ok1 := fin(high, i)
		l, ok2 := fin(low, i)
		cl, ok3 := fin(close, i)
		pc, ok4 := fin(close, i-1)
		if !ok1 || !ok2 || !ok3 || !ok4 {
			continue
		}
		floor, ceiling := math.Min(l, pc), math.Max(h, pc)
		pressure[i] = val(cl - floor)
		rng[i] = val(ceiling - floor)
	}
	var avg [3]Series
	for k, length := range []float64{a, b, c} {
		p, r := Sum(pressure, length), Sum(rng, length)
		out := nulls(n)
		for i := range p {
			if p[i] != nil && r[i] != nil && *r[i] != 0 {
				out[i] = val(*p[i] / *r[i])
			}
		}
		avg[k] = out
	}
	out := nulls(n)
	for i := range out {
		if avg[0][i] != nil && avg[1][i] != nil && avg[2][i] != nil {
			out[i] = val(float64(100*(float64(4**avg[0][i])+float64(2**avg[1][i])+*avg[2][i])) / 7)
		}
	}
	return out
}

// ZigZagResult holds the zigzag line and its confirmed pivots.
type ZigZagResult struct{ Line, Pivot Series }

// ZigZag is the percentage-reversal zigzag. It repaints: a pivot is only known once price has reversed by
// deviation percent, so earlier legs move as bars arrive and the last leg ends at the latest extreme.
func ZigZag(high, low Series, deviation float64) ZigZagResult {
	n := len(high)
	if len(low) < n {
		n = len(low)
	}
	line, pivot := nulls(len(high)), nulls(len(high))
	if !(deviation > 0) || math.IsInf(deviation, 0) {
		return ZigZagResult{Line: line, Pivot: pivot}
	}
	rise, fall := 1+deviation/100, 1-deviation/100
	type mark struct {
		index int
		value float64
	}
	var marks []mark
	direction := 0
	var topValue, bottomValue float64
	topIndex, bottomIndex := -1, -1
	for i := 0; i < n; i++ {
		h, okH := fin(high, i)
		l, okL := fin(low, i)
		if !okH || !okL {
			continue
		}
		if topIndex < 0 {
			topValue, topIndex, bottomValue, bottomIndex = h, i, l, i
			continue
		}
		switch direction {
		case 0:
			if h > topValue {
				topValue, topIndex = h, i
			}
			if l < bottomValue {
				bottomValue, bottomIndex = l, i
			}
			upTo, downTo := float64(bottomValue*rise), float64(topValue*fall)
			if topIndex > bottomIndex && topValue >= upTo {
				marks = append(marks, mark{bottomIndex, bottomValue})
				direction = 1
			} else if bottomIndex > topIndex && bottomValue <= downTo {
				marks = append(marks, mark{topIndex, topValue})
				direction = -1
			}
		case 1:
			if h > topValue {
				topValue, topIndex = h, i
			} else if l <= float64(topValue*fall) {
				marks = append(marks, mark{topIndex, topValue})
				direction, bottomValue, bottomIndex = -1, l, i
			}
		default:
			if l < bottomValue {
				bottomValue, bottomIndex = l, i
			} else if h >= float64(bottomValue*rise) {
				marks = append(marks, mark{bottomIndex, bottomValue})
				direction, topValue, topIndex = 1, h, i
			}
		}
	}
	if direction == 0 {
		return ZigZagResult{Line: line, Pivot: pivot}
	}
	confirmed := len(marks)
	if direction == 1 {
		marks = append(marks, mark{topIndex, topValue})
	} else {
		marks = append(marks, mark{bottomIndex, bottomValue})
	}
	for k := 0; k < confirmed; k++ {
		pivot[marks[k].index] = val(marks[k].value)
	}
	for k := 0; k+1 < len(marks); k++ {
		from, a := marks[k].index, marks[k].value
		to, b := marks[k+1].index, marks[k+1].value
		for i := from; i < to; i++ {
			if _, ok := fin(high, i); !ok {
				continue
			}
			if _, ok := fin(low, i); !ok {
				continue
			}
			line[i] = val(a + float64((b-a)*float64(i-from))/float64(to-from))
		}
		line[to] = val(b)
	}
	return ZigZagResult{Line: line, Pivot: pivot}
}

// PivotPointsResult holds the pivot and three resistance and support levels.
type PivotPointsResult struct{ PP, R1, R2, R3, S1, S2, S3 Series }

// PivotPoints computes the levels from the previous completed period. periods[i] is the period key of bar i; a
// new key starts a new period, and every bar of a period gets the levels of the period before it (nil for the
// first period and for a bar with a nil key). kind 0 is classic, 1 is Fibonacci (0.382, 0.618, 1.0 of the range).
func PivotPoints(high, low, close, periods Series, kind float64) PivotPointsResult {
	n := len(close)
	res := PivotPointsResult{nulls(n), nulls(n), nulls(n), nulls(n), nulls(n), nulls(n), nulls(n)}
	if kind != 0 && kind != 1 {
		return res
	}
	var key, h, l, c float64
	haveKey, anyBar, haveLevels := false, false, false
	var lv [7]float64
	for i := 0; i < n; i++ {
		if i >= len(periods) || periods[i] == nil {
			continue
		}
		p := *periods[i]
		if !haveKey || p != key {
			if anyBar {
				pp, rng := (h+l+c)/3, h-l
				if kind == 0 {
					lv = [7]float64{pp, float64(2*pp) - l, pp + rng, h + float64(2*(pp-l)), float64(2*pp) - h, pp - rng, l - float64(2*(h-pp))}
				} else {
					lv = [7]float64{pp, pp + float64(0.382*rng), pp + float64(0.618*rng), pp + rng, pp - float64(0.382*rng), pp - float64(0.618*rng), pp - rng}
				}
				haveLevels = true
			}
			key, haveKey, anyBar = p, true, false
		}
		bh, ok1 := fin(high, i)
		bl, ok2 := fin(low, i)
		bc, ok3 := fin(close, i)
		if ok1 && ok2 && ok3 {
			if !anyBar {
				h, l, anyBar = bh, bl, true
			} else {
				h, l = math.Max(h, bh), math.Min(l, bl)
			}
			c = bc
		}
		if haveLevels {
			res.PP[i], res.R1[i], res.R2[i], res.R3[i] = val(lv[0]), val(lv[1]), val(lv[2]), val(lv[3])
			res.S1[i], res.S2[i], res.S3[i] = val(lv[4]), val(lv[5]), val(lv[6])
		}
	}
	return res
}

// ChandelierResult holds the long and short exits.
type ChandelierResult struct{ Long, Short Series }

// Chandelier is highest(high, length) - mult*ATR (long exit) and lowest(low, length) + mult*ATR (short exit).
func Chandelier(high, low, close Series, length, mult float64) ChandelierResult {
	rng := ATR(high, low, close, length)
	top, bottom := Highest(high, length), Lowest(low, length)
	long, short := nulls(len(top)), nulls(len(top))
	for i := range top {
		if rng[i] == nil {
			continue
		}
		if top[i] != nil {
			long[i] = val(*top[i] - float64(mult**rng[i]))
		}
		if bottom[i] != nil {
			short[i] = val(*bottom[i] + float64(mult**rng[i]))
		}
	}
	return ChandelierResult{Long: long, Short: short}
}
