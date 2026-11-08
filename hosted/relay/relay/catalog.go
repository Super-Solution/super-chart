// Copyright 2026 SUPER SOLUTION LABS INC

package relay

import (
	"context"
	"errors"
	"log/slog"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// SymbolInfo is the contract's symbol description. Only these members are ever sent.
type SymbolInfo struct {
	Ticker         string `json:"ticker"`
	Name           string `json:"name,omitempty"`
	Exchange       string `json:"exchange,omitempty"`
	Market         string `json:"market,omitempty"`
	Type           string `json:"type,omitempty"`
	PriceCurrency  string `json:"priceCurrency,omitempty"`
	PricePrecision *int   `json:"pricePrecision,omitempty"`
	Timezone       string `json:"timezone,omitempty"`
}

// Entry is a servable instrument.
type Entry struct {
	InstrumentID string
	Venue        string
	Product      string
	Info         SymbolInfo
	search       string
}

var (
	errUnknownSymbol = errors.New("unknown symbol")
	errAmbiguous     = errors.New("ambiguous symbol")
)

var decimalText = regexp.MustCompile(`^[0-9]+(\.[0-9]+)?$`)

func precisionOf(tick *string) *int {
	if tick == nil || !decimalText.MatchString(*tick) {
		return nil
	}
	_, frac, _ := strings.Cut(*tick, ".")
	frac = strings.TrimRight(frac, "0")
	n := len(frac)
	return &n
}

// Catalog is the set of instruments the relay serves: the source's enabled instruments, narrowed to the
// venues and products the operator allows. An empty allow-list serves nothing.
type Catalog struct {
	mu       sync.RWMutex
	entries  []*Entry
	byTicker map[string][]*Entry
	loaded   bool
	venues   map[string]bool
	products map[string]bool
}

func NewCatalog(venues, products []string) *Catalog {
	return &Catalog{venues: upperSet(venues), products: upperSet(products), byTicker: map[string][]*Entry{}}
}

// Replace installs a new instrument list.
func (c *Catalog) Replace(list []Instrument) {
	var entries []*Entry
	by := map[string][]*Entry{}
	for _, in := range list {
		venue, product := strings.ToUpper(in.Venue), strings.ToUpper(in.Product)
		if !in.Enabled || in.ID == "" || in.Native == "" || !c.venues[venue] || !c.products[product] {
			continue
		}
		name := in.Base + "/" + in.Quote
		if in.Base == "" || in.Quote == "" {
			name = in.Native
		}
		if in.DisplayName != nil && *in.DisplayName != "" {
			name = *in.DisplayName
		}
		e := &Entry{InstrumentID: in.ID, Venue: venue, Product: product, Info: SymbolInfo{
			Ticker: in.Native, Name: name, Exchange: venue, Market: strings.ToLower(product), Type: "crypto",
			PriceCurrency: in.Quote, PricePrecision: precisionOf(in.TickSize), Timezone: "UTC",
		}}
		e.search = strings.ToLower(in.Native + " " + name)
		entries = append(entries, e)
		by[in.Native] = append(by[in.Native], e)
	}
	sort.Slice(entries, func(i, j int) bool {
		a, b := entries[i], entries[j]
		if a.Venue != b.Venue {
			return a.Venue < b.Venue
		}
		if a.Product != b.Product {
			return a.Product < b.Product
		}
		return a.Info.Ticker < b.Info.Ticker
	})
	c.mu.Lock()
	c.entries, c.byTicker, c.loaded = entries, by, true
	c.mu.Unlock()
}

func (c *Catalog) Loaded() bool { c.mu.RLock(); defer c.mu.RUnlock(); return c.loaded }

func (c *Catalog) Len() int { c.mu.RLock(); defer c.mu.RUnlock(); return len(c.entries) }

// Search returns up to limit entries the token may read whose ticker or name contains the text.
func (c *Catalog) Search(text string, limit int, tok *Token) []*Entry {
	text = strings.ToLower(strings.TrimSpace(text))
	c.mu.RLock()
	defer c.mu.RUnlock()
	out := []*Entry{}
	for _, e := range c.entries {
		if len(out) >= limit {
			break
		}
		if tok.Allows(e.Venue, e.Product) && strings.Contains(e.search, text) {
			out = append(out, e)
		}
	}
	return out
}

// Resolve finds the one entry a ticker (and optional market and exchange) names, comparing exactly.
func (c *Catalog) Resolve(ticker, market, exchange string) (*Entry, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	var hit *Entry
	for _, e := range c.byTicker[ticker] {
		if (market != "" && e.Info.Market != market) || (exchange != "" && e.Info.Exchange != exchange) {
			continue
		}
		if hit != nil {
			return nil, errAmbiguous
		}
		hit = e
	}
	if hit == nil {
		return nil, errUnknownSymbol
	}
	return hit, nil
}

// Refresh loads the list now and then every interval until ctx ends. A failed refresh keeps the last list
// and is retried after retry (doubling up to a minute), so a source that was down at start does not leave
// the relay empty for a whole interval.
func (c *Catalog) Refresh(ctx context.Context, up Upstream, every, retry time.Duration, log *slog.Logger) {
	load := func() bool {
		cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		list, err := up.Instruments(cctx)
		if err != nil {
			log.Error("instrument refresh failed", "error", err.Error())
			return false
		}
		c.Replace(list)
		log.Info("instrument list loaded", "served", c.Len(), "source", len(list))
		return true
	}
	wait := every
	if !load() {
		wait = retry
	}
	for {
		t := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			t.Stop()
			return
		case <-t.C:
		}
		if load() {
			wait = every
		} else {
			wait = min(wait*2, time.Minute, every)
		}
	}
}
