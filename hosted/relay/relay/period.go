// Copyright 2026 SUPER SOLUTION LABS INC
// Hosted relay: not part of the open-source chart packages. See ../README.md.

package relay

import (
	"regexp"
	"strings"
)

const (
	minuteMs = int64(60_000)
	hourMs   = 60 * minuteMs
	dayMs    = 24 * hourMs
	weekMs   = 7 * dayMs
	// 1970-01-01 was a Thursday; weeks open on Monday 00:00 UTC, three days earlier.
	weekOffsetMs = 3 * dayMs
)

// Base is the stored candle size a period is read from.
type Base string

const (
	Base1m Base = "1m"
	Base1h Base = "1h"
	Base1d Base = "1d"
)

func (b Base) ms() int64 {
	switch b {
	case Base1m:
		return minuteMs
	case Base1h:
		return hourMs
	default:
		return dayMs
	}
}

// Period is a bar size the relay offers.
type Period struct {
	Token string
	Ms    int64
	Base  Base
}

// Native reports whether the period is stored as it is (no aggregation).
func (p Period) Native() bool { return p.Ms == p.Base.ms() }

// Ratio is how many stored candles make one bar.
func (p Period) Ratio() int64 { return p.Ms / p.Base.ms() }

// Align returns the open time of the bar that contains t. Minute, hour and day bars are aligned to
// UTC midnight; week bars open on Monday 00:00 UTC.
func (p Period) Align(t int64) int64 {
	if p.Ms == weekMs {
		return floorDiv(t+weekOffsetMs, weekMs)*weekMs - weekOffsetMs
	}
	return floorDiv(t, p.Ms) * p.Ms
}

// AlignUp returns the smallest bar open time that is >= t.
func (p Period) AlignUp(t int64) int64 {
	a := p.Align(t)
	if a == t {
		return t
	}
	return a + p.Ms
}

func floorDiv(a, b int64) int64 {
	q := a / b
	if (a%b != 0) && ((a < 0) != (b < 0)) {
		q--
	}
	return q
}

var shape = regexp.MustCompile(`^[1-9][0-9]{0,3}[smhdwMy]$`)

var offered = func() map[string]Period {
	m := map[string]Period{}
	add := func(token string, ms int64, base Base) { m[token] = Period{Token: token, Ms: ms, Base: base} }
	add("1m", minuteMs, Base1m)
	for _, n := range []int64{3, 5, 15, 30} {
		add(itoa(n)+"m", n*minuteMs, Base1m)
	}
	add("1h", hourMs, Base1h)
	for _, n := range []int64{2, 4, 6, 12} {
		add(itoa(n)+"h", n*hourMs, Base1h)
	}
	add("1d", dayMs, Base1d)
	add("1w", weekMs, Base1d)
	return m
}()

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

// ParsePeriod validates a contract period token. ok is false when the token is malformed or not offered.
func ParsePeriod(token string) (Period, bool) {
	if !shape.MatchString(token) {
		return Period{}, false
	}
	p, ok := offered[token]
	return p, ok
}

// OfferedPeriods lists the tokens the relay serves, for error messages and docs.
func OfferedPeriods() string {
	order := []string{"1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "1w"}
	return strings.Join(order, ", ")
}
