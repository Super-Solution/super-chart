// Copyright 2026 SUPER SOLUTION LABS INC

package relay

import "sort"

// Bar is one bar in the datafeed contract (docs/DATAFEED-HTTP.md). Only these members are ever sent.
type Bar struct {
	Timestamp int64    `json:"timestamp"`
	Open      float64  `json:"open"`
	High      float64  `json:"high"`
	Low       float64  `json:"low"`
	Close     float64  `json:"close"`
	Volume    float64  `json:"volume"`
	Turnover  *float64 `json:"turnover,omitempty"`
}

// Candle is one stored candle as the data source returns it.
type Candle struct {
	Ts          int64
	Open        float64
	High        float64
	Low         float64
	Close       float64
	Volume      float64
	QuoteVolume *float64
	Version     int64
}

// dedupe sorts candles oldest first and keeps the highest version of a repeated open time.
func dedupe(in []Candle) []Candle {
	sort.SliceStable(in, func(i, j int) bool {
		if in[i].Ts != in[j].Ts {
			return in[i].Ts < in[j].Ts
		}
		return in[i].Version < in[j].Version
	})
	out := in[:0]
	for _, c := range in {
		if n := len(out); n > 0 && out[n-1].Ts == c.Ts {
			out[n-1] = c
			continue
		}
		out = append(out, c)
	}
	return out
}

func candleBar(c Candle) Bar {
	return Bar{Timestamp: c.Ts, Open: c.Open, High: c.High, Low: c.Low, Close: c.Close, Volume: c.Volume, Turnover: c.QuoteVolume}
}

// aggregate folds candles (oldest first, unique open times) into bars of the period. A bar's open is its
// first candle's open, the close its last candle's close; turnover is sent only when every candle has one.
func aggregate(p Period, candles []Candle) []Bar {
	var out []Bar
	var turnoverOK bool
	var turnover float64
	flush := func() {
		if n := len(out); n > 0 {
			if turnoverOK {
				t := turnover
				out[n-1].Turnover = &t
			} else {
				out[n-1].Turnover = nil
			}
		}
	}
	for _, c := range candles {
		start := p.Align(c.Ts)
		if n := len(out); n == 0 || out[n-1].Timestamp != start {
			flush()
			out = append(out, Bar{Timestamp: start, Open: c.Open, High: c.High, Low: c.Low, Close: c.Close, Volume: c.Volume})
			turnoverOK, turnover = c.QuoteVolume != nil, 0
			if c.QuoteVolume != nil {
				turnover = *c.QuoteVolume
			}
			continue
		}
		b := &out[len(out)-1]
		if c.High > b.High {
			b.High = c.High
		}
		if c.Low < b.Low {
			b.Low = c.Low
		}
		b.Close = c.Close
		b.Volume += c.Volume
		if c.QuoteVolume == nil {
			turnoverOK = false
		} else if turnoverOK {
			turnover += *c.QuoteVolume
		}
	}
	flush()
	return out
}
