// Copyright 2026 SUPER SOLUTION LABS INC

package relay

import (
	"context"
	"fmt"
	"strconv"
	"time"
)

const (
	DefaultLimit = 500
	MaxLimit     = 5000
	// DefaultMaxCandles caps the stored candles one request may read to build aggregated bars.
	DefaultMaxCandles = 20_000
)

// BarsQuery is a validated /v1/bars request.
type BarsQuery struct {
	Entry  *Entry
	Period Period
	From   *int64 // inclusive
	To     *int64 // exclusive
	Limit  int
}

// BarsResult is what /v1/bars answers.
type BarsResult struct {
	Bars   []Bar
	NoData bool
}

// Service turns datafeed requests into reads of stored candles.
type Service struct {
	Up         Upstream
	MaxCandles int
}

// fetchNative reads up to want candles of the base size, newest first within [from, to), paging the source.
// exhausted is true when the source has nothing older in that range.
func (s *Service) fetchNative(ctx context.Context, base Base, id string, from, to *int64, want int) (candles []Candle, exhausted bool, err error) {
	cursor := to
	for len(candles) < want {
		page := min(want-len(candles), MaxPage)
		got, err := s.Up.Candles(ctx, base, id, from, cursor, page)
		if err != nil {
			return nil, false, err
		}
		candles = append(candles, got...)
		if len(got) < page {
			return dedupeNewest(candles), true, nil
		}
		oldest := got[0].Ts
		for _, c := range got {
			if c.Ts < oldest {
				oldest = c.Ts
			}
		}
		if cursor != nil && oldest >= *cursor {
			return nil, false, fmt.Errorf("%w: the source did not advance", errUpstream)
		}
		next := oldest
		cursor = &next
	}
	return dedupeNewest(candles), false, nil
}

// dedupeNewest returns the candles oldest first without repeated open times.
func dedupeNewest(in []Candle) []Candle { return dedupe(in) }

// Bars answers a history request. The newest Limit bars of the range come back, oldest first.
func (s *Service) Bars(ctx context.Context, q BarsQuery) (BarsResult, error) {
	p := q.Period
	if q.From != nil && q.To != nil && *q.From >= *q.To {
		return BarsResult{Bars: []Bar{}}, nil
	}
	if p.Native() {
		candles, exhausted, err := s.fetchNative(ctx, p.Base, q.Entry.InstrumentID, q.From, q.To, q.Limit)
		if err != nil {
			return BarsResult{}, err
		}
		bars := make([]Bar, 0, len(candles))
		for _, c := range candles {
			bars = append(bars, candleBar(c))
		}
		if len(bars) > q.Limit {
			bars = bars[len(bars)-q.Limit:]
		}
		return BarsResult{Bars: bars, NoData: exhausted && q.From == nil}, nil
	}

	ratio := int(p.Ratio())
	want := min(q.Limit*ratio+ratio, s.maxCandles())
	var from, to *int64
	if q.From != nil {
		a := p.Align(*q.From)
		from = &a
	}
	if q.To != nil {
		a := p.AlignUp(*q.To)
		to = &a
	}
	candles, exhausted, err := s.fetchNative(ctx, p.Base, q.Entry.InstrumentID, from, to, want)
	if err != nil {
		return BarsResult{}, err
	}
	bars := aggregate(p, candles)
	// Without the candles before the oldest one read, the first bar may be partial: leave it out.
	if !exhausted && len(bars) > 0 && bars[0].Timestamp < candles[0].Ts {
		bars = bars[1:]
	}
	if q.From != nil {
		for len(bars) > 0 && bars[0].Timestamp < *q.From {
			bars = bars[1:]
		}
	}
	cut := len(bars) > q.Limit
	if cut {
		bars = bars[len(bars)-q.Limit:]
	}
	if bars == nil {
		bars = []Bar{}
	}
	return BarsResult{Bars: bars, NoData: exhausted && q.From == nil && !cut}, nil
}

func (s *Service) maxCandles() int {
	if s.MaxCandles > 0 {
		return s.MaxCandles
	}
	return DefaultMaxCandles
}

// cacheTTL is how long an answer may be reused. A page that ends before the previous closed bar does not
// change; anything else is reused only briefly, which also collapses clients that poll the live bar.
func cacheTTL(p Period, to *int64, now time.Time) (ttl time.Duration, immutable bool) {
	if to != nil && *to <= p.Align(now.UnixMilli())-p.Ms {
		return time.Hour, true
	}
	ttl = time.Duration(p.Ms/60) * time.Millisecond
	return min(max(ttl, 2*time.Second), 30*time.Second), false
}

func cacheKey(q BarsQuery) string {
	opt := func(v *int64) string {
		if v == nil {
			return "-"
		}
		return strconv.FormatInt(*v, 10)
	}
	return q.Entry.InstrumentID + "|" + q.Period.Token + "|" + opt(q.From) + "|" + opt(q.To) + "|" + strconv.Itoa(q.Limit)
}
