// Copyright 2026 SUPER SOLUTION LABS INC

package relay

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// errUpstream marks every failure of the data source. Its detail is for the operator's log only; it is
// never copied into a response.
var errUpstream = errors.New("data source unavailable")

var errInternal = errors.New("internal error")

// Instrument is one row of the source's instrument list.
type Instrument struct {
	ID          string  `json:"instrument_id"`
	Venue       string  `json:"venue"`
	Product     string  `json:"product"`
	Symbol      string  `json:"symbol"`
	Native      string  `json:"native"`
	Base        string  `json:"base"`
	Quote       string  `json:"quote"`
	TickSize    *string `json:"tick_size"`
	DisplayName *string `json:"display_name"`
	Enabled     bool    `json:"enabled"`
}

// Upstream is what the relay needs from the data source.
type Upstream interface {
	// Candles returns stored candles of one instrument, newest first, at most limit (<= MaxPage).
	// from is inclusive, to exclusive; nil means open.
	Candles(ctx context.Context, base Base, instrumentID string, from, to *int64, limit int) ([]Candle, error)
	Instruments(ctx context.Context) ([]Instrument, error)
}

// MaxPage is the most candles the source returns in one request.
const MaxPage = 1000

const maxBody = 16 << 20

// AggreClient reads Aggre's HTTP API with the relay's own key.
type AggreClient struct {
	base *url.URL
	key  string
	hc   *http.Client
	sem  chan struct{}
	rate *Bucket
}

type AggreOptions struct {
	BaseURL     string
	APIKey      string
	Timeout     time.Duration
	Concurrency int
	RPS         float64
	Transport   http.RoundTripper
}

func NewAggreClient(o AggreOptions) (*AggreClient, error) {
	u, err := url.Parse(o.BaseURL)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") {
		return nil, fmt.Errorf("aggre base URL must be an http(s) URL")
	}
	if u.Scheme == "http" && !isLoopback(u.Hostname()) {
		return nil, fmt.Errorf("aggre base URL must be https unless it is a loopback address")
	}
	if u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, fmt.Errorf("aggre base URL must not carry credentials, a query or a fragment")
	}
	if o.APIKey == "" {
		return nil, fmt.Errorf("aggre API key is empty")
	}
	if o.Timeout <= 0 {
		o.Timeout = 10 * time.Second
	}
	if o.Concurrency <= 0 {
		o.Concurrency = 8
	}
	if o.RPS <= 0 {
		o.RPS = 20
	}
	hc := &http.Client{
		Timeout:   o.Timeout,
		Transport: o.Transport,
		// The key must go only to the configured host: never follow a redirect.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	return &AggreClient{
		base: u, key: o.APIKey, hc: hc,
		sem:  make(chan struct{}, o.Concurrency),
		rate: NewBucket(o.RPS, int(math.Max(1, o.RPS)), nil),
	}, nil
}

func isLoopback(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (a *AggreClient) get(ctx context.Context, path string, q url.Values, out any) error {
	select {
	case a.sem <- struct{}{}:
		defer func() { <-a.sem }()
	case <-ctx.Done():
		return fmt.Errorf("%w: waiting for a slot: %v", errUpstream, ctx.Err())
	}
	if err := a.rate.Wait(ctx); err != nil {
		return fmt.Errorf("%w: waiting for rate budget: %v", errUpstream, err)
	}
	u := *a.base
	u.Path = u.Path + path
	u.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return fmt.Errorf("%w: %v", errUpstream, err)
	}
	req.Header.Set("Authorization", "Bearer "+a.key)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "super-chart-relay")
	resp, err := a.hc.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %s: %v", errUpstream, path, redact(err.Error(), a.key))
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil {
		return fmt.Errorf("%w: %s: reading body: %v", errUpstream, path, err)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%w: %s: status %d", errUpstream, path, resp.StatusCode)
	}
	if len(body) > maxBody {
		return fmt.Errorf("%w: %s: body over %d bytes", errUpstream, path, maxBody)
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("%w: %s: bad JSON: %v", errUpstream, path, err)
	}
	return nil
}

func redact(s, secret string) string {
	if secret == "" {
		return s
	}
	return strings.ReplaceAll(s, secret, "[redacted]")
}

type candleRow struct {
	Ts          *int64   `json:"ts"`
	Open        *float64 `json:"open"`
	High        *float64 `json:"high"`
	Low         *float64 `json:"low"`
	Close       *float64 `json:"close"`
	Volume      *float64 `json:"volume"`
	QuoteVolume *float64 `json:"quote_volume"`
	Version     *int64   `json:"version"`
}

func finite(v *float64) bool { return v != nil && !math.IsNaN(*v) && !math.IsInf(*v, 0) }

func (a *AggreClient) Candles(ctx context.Context, base Base, instrumentID string, from, to *int64, limit int) ([]Candle, error) {
	if limit < 1 || limit > MaxPage {
		return nil, fmt.Errorf("%w: page size %d", errInternal, limit)
	}
	q := url.Values{}
	q.Set("instrument_id", instrumentID)
	q.Set("order", "desc")
	q.Set("limit", strconv.Itoa(limit))
	if from != nil {
		q.Set("from", strconv.FormatInt(*from, 10))
	}
	if to != nil {
		q.Set("to", strconv.FormatInt(*to, 10))
	}
	var env struct {
		Data []candleRow `json:"data"`
	}
	if err := a.get(ctx, "/v1/finance/market/candles_"+string(base), q, &env); err != nil {
		return nil, err
	}
	out := make([]Candle, 0, len(env.Data))
	for i, r := range env.Data {
		if r.Ts == nil || *r.Ts < 0 || !finite(r.Open) || !finite(r.High) || !finite(r.Low) || !finite(r.Close) || !finite(r.Volume) {
			return nil, fmt.Errorf("%w: candle %d is malformed", errUpstream, i)
		}
		c := Candle{Ts: *r.Ts, Open: *r.Open, High: *r.High, Low: *r.Low, Close: *r.Close, Volume: *r.Volume}
		if finite(r.QuoteVolume) {
			c.QuoteVolume = r.QuoteVolume
		}
		if r.Version != nil {
			c.Version = *r.Version
		}
		out = append(out, c)
	}
	return out, nil
}

func (a *AggreClient) Instruments(ctx context.Context) ([]Instrument, error) {
	var env struct {
		Data []Instrument `json:"data"`
	}
	if err := a.get(ctx, "/v1/finance/market/instruments", url.Values{}, &env); err != nil {
		return nil, err
	}
	return env.Data, nil
}
