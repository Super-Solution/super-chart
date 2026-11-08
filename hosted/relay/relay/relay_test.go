package relay

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestPeriods(t *testing.T) {
	for _, tok := range []string{"1m", "5m", "15m", "30m", "1h", "4h", "12h", "1d", "1w"} {
		if _, ok := ParsePeriod(tok); !ok {
			t.Errorf("%s should be offered", tok)
		}
	}
	for _, tok := range []string{"", "0m", "7m", "1M", "1y", "1s", "2d", "10", "m", "1m ", "01m", "99999m", "1w1"} {
		if _, ok := ParsePeriod(tok); ok {
			t.Errorf("%q should not be offered", tok)
		}
	}
	w, _ := ParsePeriod("1w")
	mon := time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC)
	for d := 0; d < 7; d++ {
		got := w.Align(mon.AddDate(0, 0, d).Add(13 * time.Hour).UnixMilli())
		if got != mon.UnixMilli() {
			t.Fatalf("day %d of the week aligned to %v, want Monday %v", d, time.UnixMilli(got).UTC(), mon)
		}
	}
	if got := w.Align(mon.Add(-time.Millisecond).UnixMilli()); got != mon.AddDate(0, 0, -7).UnixMilli() {
		t.Fatalf("the millisecond before Monday belongs to the previous week, got %v", time.UnixMilli(got).UTC())
	}
	m5, _ := ParsePeriod("5m")
	if m5.AlignUp(t0) != t0 || m5.AlignUp(t0+1) != t0+5*minuteMs || m5.Align(-1) != -5*minuteMs {
		t.Fatal("align/alignUp around the boundary")
	}
}

func TestAggregate(t *testing.T) {
	p, _ := ParsePeriod("5m")
	var cs []Candle
	for i := 0; i < 7; i++ {
		c := minuteCandle("x", i)
		q := c["quote_volume"].(float64)
		cs = append(cs, Candle{Ts: c["ts"].(int64), Open: c["open"].(float64), High: c["high"].(float64), Low: c["low"].(float64), Close: c["close"].(float64), Volume: c["volume"].(float64), QuoteVolume: &q})
	}
	bars := aggregate(p, cs)
	if len(bars) != 2 {
		t.Fatalf("7 minutes make a full 5m bar and a forming one, got %d", len(bars))
	}
	b := bars[0]
	wantHigh, wantLow, vol, tv := -1.0, 1e9, 0.0, 0.0
	for _, c := range cs[:5] {
		wantHigh, wantLow = math.Max(wantHigh, c.High), math.Min(wantLow, c.Low)
		vol += c.Volume
		tv += *c.QuoteVolume
	}
	if b.Timestamp != t0 || b.Open != cs[0].Open || b.Close != cs[4].Close || b.High != wantHigh || b.Low != wantLow || b.Volume != vol || b.Turnover == nil || *b.Turnover != tv {
		t.Fatalf("first bar wrong: %+v", b)
	}
	if bars[1].Timestamp != t0+5*minuteMs || bars[1].Open != cs[5].Open || bars[1].Close != cs[6].Close {
		t.Fatalf("forming bar wrong: %+v", bars[1])
	}
	// one candle without turnover removes turnover from its bar only
	cs[2].QuoteVolume = nil
	bars = aggregate(p, cs)
	if bars[0].Turnover != nil || bars[1].Turnover == nil {
		t.Fatal("turnover must be dropped from a bar with a missing part, and kept elsewhere")
	}
}

func TestAuthentication(t *testing.T) {
	h := newHarness(t, []string{"OKX"})
	for name, tc := range map[string]struct{ token, header string }{
		"none":    {},
		"unknown": {token: "nope"},
		"expired": {token: "secret-expired"},
		"basic":   {header: "Basic c2VjcmV0LWFsbA=="},
		"huge":    {token: strings.Repeat("a", 5000)},
	} {
		var status int
		var body []byte
		var hdr http.Header
		if tc.header != "" {
			status, hdr, body = h.get(t, "/v1/symbols", "", "Authorization", tc.header)
		} else {
			status, hdr, body = h.get(t, "/v1/symbols", tc.token)
		}
		if status != 401 || errCode(t, body) != "unauthorized" || hdr.Get("WWW-Authenticate") == "" {
			t.Errorf("%s: want 401 unauthorized, got %d %s", name, status, body)
		}
	}
	if status, _, _ := h.get(t, "/healthz", ""); status != 200 {
		t.Errorf("healthz needs no credentials, got %d", status)
	}
	if status, _, _ := h.get(t, "/v1/bars?ticker=BTC-USDT&period=1m", ""); status != 401 {
		t.Errorf("bars needs credentials, got %d", status)
	}
	// the key is never accepted in the URL
	if status, _, _ := h.get(t, "/v1/symbols?token=secret-all", ""); status != 401 {
		t.Errorf("a token in the URL must not authenticate, got %d", status)
	}
}

func TestRateLimitPerToken(t *testing.T) {
	h := newHarness(t, []string{"OKX"})
	for i := 0; i < 2; i++ {
		if status, _, _ := h.get(t, "/v1/symbols", "secret-slow"); status != 200 {
			t.Fatalf("request %d within the burst: %d", i, status)
		}
	}
	status, hdr, body := h.get(t, "/v1/symbols", "secret-slow")
	if status != 429 || errCode(t, body) != "rate_limited" || hdr.Get("Retry-After") != "1" {
		t.Fatalf("want 429 rate_limited with Retry-After 1, got %d %v %s", status, hdr, body)
	}
	if status, _, _ := h.get(t, "/v1/symbols", "secret-all"); status != 200 {
		t.Fatal("another token is unaffected")
	}
	h.clock.Advance(1100 * time.Millisecond)
	if status, _, _ := h.get(t, "/v1/symbols", "secret-slow"); status != 200 {
		t.Fatal("the bucket refills")
	}
}

func TestSymbolsScopeAndSearch(t *testing.T) {
	h := newHarness(t, []string{"OKX", "HYPERLIQUID"})
	list := func(token, q string) []SymbolInfo {
		status, _, body := h.get(t, "/v1/symbols"+q, token)
		if status != 200 {
			t.Fatalf("%d %s", status, body)
		}
		var r struct{ Symbols []SymbolInfo }
		if err := json.Unmarshal(body, &r); err != nil {
			t.Fatal(err)
		}
		return r.Symbols
	}
	all := list("secret-all", "")
	// BITGET is not an allowed venue, the disabled instrument is not served
	if len(all) != 3 {
		t.Fatalf("want OKX spot, OKX perp, Hyperliquid perp, got %+v", all)
	}
	spot := all[len(all)-1] // sorted HYPERLIQUID, OKX PERP, OKX SPOT
	if spot.Exchange != "OKX" || spot.Market != "spot" || spot.Ticker != "BTC-USDT" || spot.PricePrecision == nil || *spot.PricePrecision != 1 || spot.PriceCurrency != "USDT" || spot.Timezone != "UTC" {
		t.Fatalf("spot symbol info: %+v", spot)
	}
	if hl := all[0]; hl.PricePrecision != nil {
		t.Fatalf("no tick size means no precision: %+v", hl)
	}
	if got := list("secret-okx", ""); len(got) != 2 {
		t.Fatalf("a venue-scoped token sees only OKX: %+v", got)
	}
	if got := list("secret-all", "?search=perpetual"); len(got) != 1 || got[0].Name != "BTC perpetual" {
		t.Fatalf("search by name: %+v", got)
	}
	if got := list("secret-all", "?limit=1"); len(got) != 1 {
		t.Fatalf("limit: %+v", got)
	}
	if got := list("secret-all", "?search=zzz"); got == nil || len(got) != 0 {
		t.Fatalf("no match is an empty list: %v", got)
	}
	for _, q := range []string{"?limit=0", "?limit=201", "?limit=x", "?extra=1", "?limit=1&limit=2"} {
		if status, _, body := h.get(t, "/v1/symbols"+q, "secret-all"); status != 400 || errCode(t, body) != "bad_request" {
			t.Errorf("%s: %d %s", q, status, body)
		}
	}
}

func TestFailClosedWithoutAllowedVenues(t *testing.T) {
	h := newHarness(t, nil)
	if h.cat.Len() != 0 {
		t.Fatal("an empty allow-list must serve nothing")
	}
	status, _, body := h.get(t, "/v1/bars?ticker=BTC-USDT&period=1m", "secret-all")
	if status != 404 || errCode(t, body) != "unknown_symbol" {
		t.Fatalf("%d %s", status, body)
	}
	if h.fake.calls.Load() != 0 {
		t.Fatal("nothing may be read from the source for an unserved symbol")
	}
}

func TestBarsNativeNewestFirstPageAndOrder(t *testing.T) {
	h := newHarness(t, []string{"OKX"})
	b := h.bars(t, "ticker=BTC-USDT&market=spot&exchange=OKX&period=1m&limit=10")
	if b.Ticker != "BTC-USDT" || b.Period != "1m" || len(b.Bars) != 10 || b.NoData {
		t.Fatalf("%+v", b)
	}
	// the data ends at the 3599th minute; the newest 10 come back oldest first
	for i, bar := range b.Bars {
		want := t0 + int64(3590+i)*minuteMs
		if int64(bar["timestamp"].(float64)) != want {
			t.Fatalf("bar %d at %v, want %v", i, bar["timestamp"], want)
		}
	}
	// only the contract's members
	allowed := map[string]bool{"timestamp": true, "open": true, "high": true, "low": true, "close": true, "volume": true, "turnover": true}
	for k := range b.Bars[0] {
		if !allowed[k] {
			t.Errorf("member %q is not part of the contract", k)
		}
	}
}

func TestBarsPagesThroughTheSource(t *testing.T) {
	h := newHarness(t, []string{"OKX"})
	b := h.bars(t, "ticker=BTC-USDT&market=spot&period=1m&limit=2500")
	if len(b.Bars) != 2500 {
		t.Fatalf("got %d bars", len(b.Bars))
	}
	if calls := h.fake.calls.Load(); calls != 3 {
		t.Fatalf("2500 candles at 1000 a page is 3 requests, got %d", calls)
	}
	for i := 1; i < len(b.Bars); i++ {
		if b.Bars[i]["timestamp"].(float64)-b.Bars[i-1]["timestamp"].(float64) != float64(minuteMs) {
			t.Fatalf("gap or disorder at %d", i)
		}
	}
	if b.Bars[2499]["timestamp"].(float64) != float64(t0+3599*minuteMs) {
		t.Fatal("the newest bar is last")
	}
}

func TestBarsRangeAndNoData(t *testing.T) {
	h := newHarness(t, []string{"OKX"})
	from, to := t0+10*minuteMs, t0+20*minuteMs
	b := h.bars(t, fmt.Sprintf("ticker=BTC-USDT&market=spot&period=1m&from=%d&to=%d", from, to))
	if len(b.Bars) != 10 || int64(b.Bars[0]["timestamp"].(float64)) != from || int64(b.Bars[9]["timestamp"].(float64)) != to-minuteMs {
		t.Fatalf("from is inclusive, to exclusive: %d bars %v", len(b.Bars), b.Bars[0]["timestamp"])
	}
	if b.NoData {
		t.Fatal("a from was given, so older data may exist")
	}
	// scroll back past the start: everything before t0+5m is 5 bars, then nothing older
	b = h.bars(t, fmt.Sprintf("ticker=BTC-USDT&market=spot&period=1m&to=%d&limit=100", t0+5*minuteMs))
	if len(b.Bars) != 5 || !b.NoData {
		t.Fatalf("want 5 bars and noData, got %d %v", len(b.Bars), b.NoData)
	}
	b = h.bars(t, fmt.Sprintf("ticker=BTC-USDT&market=spot&period=1m&to=%d", t0))
	if len(b.Bars) != 0 || !b.NoData || b.Bars == nil {
		t.Fatalf("before the first bar: an empty list and noData, got %+v", b)
	}
	b = h.bars(t, fmt.Sprintf("ticker=BTC-USDT&market=spot&period=1m&from=%d&to=%d", t0+3*minuteMs, t0+3*minuteMs))
	if len(b.Bars) != 0 {
		t.Fatal("an empty range is an empty answer")
	}
}

func TestBarsDerivedMatchesTheSourceRollup(t *testing.T) {
	h := newHarness(t, []string{"OKX"})
	// 4h is not stored; the relay folds stored hours. The source's own 1h candles are the reference.
	for _, tc := range []struct {
		period string
		ms     int64
	}{{"5m", 5 * minuteMs}, {"15m", 15 * minuteMs}, {"2h", 2 * hourMs}, {"4h", 4 * hourMs}, {"12h", 12 * hourMs}} {
		b := h.bars(t, fmt.Sprintf("ticker=BTC-USDT&market=spot&period=%s&limit=5000", tc.period))
		if len(b.Bars) == 0 {
			t.Fatalf("%s: no bars", tc.period)
		}
		per := int(tc.ms / minuteMs)
		for _, bar := range b.Bars {
			j := int((int64(bar["timestamp"].(float64)) - t0) / tc.ms)
			// a candle of this size from the same 1m data, but only the minutes that exist
			want := foldCandles(okxBTC, tc.ms, j, 3600)
			for _, k := range []string{"open", "high", "low", "close", "volume"} {
				if bar[k].(float64) != want[k].(float64) {
					t.Fatalf("%s bar %d %s = %v, want %v", tc.period, j, k, bar[k], want[k])
				}
			}
			if bar["turnover"].(float64) != want["quote_volume"].(float64) {
				t.Fatalf("%s bar %d turnover", tc.period, j)
			}
		}
		// the last bar is the forming one: it holds the minutes that exist so far
		last := b.Bars[len(b.Bars)-1]
		if int64(last["timestamp"].(float64)) != t0+(int64(3599)/int64(per))*tc.ms {
			t.Fatalf("%s: last bar opens at %v", tc.period, last["timestamp"])
		}
	}
}

func TestBarsDerivedRespectsFromToAndCutting(t *testing.T) {
	h := newHarness(t, []string{"OKX"})
	// from in the middle of a bar: that bar opened before from, so it is not in range
	from := t0 + 7*minuteMs
	b := h.bars(t, fmt.Sprintf("ticker=BTC-USDT&market=spot&period=5m&from=%d&to=%d", from, t0+30*minuteMs))
	if len(b.Bars) == 0 || int64(b.Bars[0]["timestamp"].(float64)) != t0+10*minuteMs {
		t.Fatalf("first bar should be the one opening at 10m, got %v", b.Bars[0]["timestamp"])
	}
	// to in the middle of a bar: the bar opened before to and is complete
	b = h.bars(t, fmt.Sprintf("ticker=BTC-USDT&market=spot&period=5m&to=%d&limit=3", t0+27*minuteMs))
	got := []int64{}
	for _, bar := range b.Bars {
		got = append(got, (int64(bar["timestamp"].(float64))-t0)/minuteMs)
	}
	if fmt.Sprint(got) != "[15 20 25]" {
		t.Fatalf("newest 3 bars opening before 27m: %v", got)
	}
	last := b.Bars[2]
	want := foldCandles(okxBTC, 5*minuteMs, 5, 3600)
	if last["close"].(float64) != want["close"].(float64) || last["volume"].(float64) != want["volume"].(float64) {
		t.Fatalf("the bar opening at 25m must hold all five of its minutes: %v vs %v", last, want)
	}
	// reaching the start of the data: the first bar is kept and noData is set
	b = h.bars(t, fmt.Sprintf("ticker=BTC-USDT&market=spot&period=1h&to=%d&limit=5000", t0+3*hourMs))
	if len(b.Bars) != 3 || !b.NoData {
		t.Fatalf("%d bars noData=%v", len(b.Bars), b.NoData)
	}
}

func TestBarsDerivedDropsPartialOldestWhenCapped(t *testing.T) {
	h := newHarness(t, []string{"OKX"})
	h.srv.Service.MaxCandles = 1000 // 1000 one-minute candles ~ 16.7 hours
	b := h.bars(t, "ticker=BTC-USDT&market=spot&period=30m&limit=5000")
	if b.NoData {
		t.Fatal("the cap cut the history: do not claim there is nothing older")
	}
	first := int64(b.Bars[0]["timestamp"].(float64))
	if first%(30*minuteMs) != 0 {
		t.Fatal("bars are aligned")
	}
	for _, bar := range b.Bars {
		ts := int64(bar["timestamp"].(float64))
		j := int((ts - t0) / (30 * minuteMs))
		want := foldCandles(okxBTC, 30*minuteMs, j, 3600)
		if bar["volume"].(float64) != want["volume"].(float64) {
			t.Fatalf("bar %d is partial: volume %v, want %v", j, bar["volume"], want["volume"])
		}
	}
}

func TestWeeklyBarsOpenOnMonday(t *testing.T) {
	h := newHarness(t, []string{"OKX"})
	// the source has two stored days (Mon, Tue); a week bar folds them
	b := h.bars(t, "ticker=BTC-USDT&market=spot&period=1w")
	if len(b.Bars) != 1 || int64(b.Bars[0]["timestamp"].(float64)) != t0 {
		t.Fatalf("%+v", b.Bars)
	}
	d0, d1 := foldCandles(okxBTC, dayMs, 0, 3600), foldCandles(okxBTC, dayMs, 1, 3600)
	if b.Bars[0]["volume"].(float64) != d0["volume"].(float64)+d1["volume"].(float64) || b.Bars[0]["open"].(float64) != d0["open"].(float64) || b.Bars[0]["close"].(float64) != d1["close"].(float64) {
		t.Fatalf("%+v", b.Bars[0])
	}
}

func TestBarsParameterErrors(t *testing.T) {
	h := newHarness(t, []string{"OKX", "HYPERLIQUID"})
	cases := []struct {
		q      string
		status int
		code   string
	}{
		{"period=1m", 400, "bad_request"},
		{"ticker=BTC-USDT", 400, "invalid_period"},
		{"ticker=BTC-USDT&period=7m", 400, "invalid_period"},
		{"ticker=BTC-USDT&period=1M", 400, "invalid_period"},
		{"ticker=BTC-USDT&period=1m&limit=0", 400, "bad_request"},
		{"ticker=BTC-USDT&period=1m&limit=5001", 400, "bad_request"},
		{"ticker=BTC-USDT&period=1m&limit=1e3", 400, "bad_request"},
		{"ticker=BTC-USDT&period=1m&from=-1", 400, "bad_request"},
		{"ticker=BTC-USDT&period=1m&from=abc", 400, "bad_request"},
		{"ticker=BTC-USDT&period=1m&from=99999999999999999", 400, "bad_request"},
		{"ticker=BTC-USDT&period=1m&from=20&to=10", 400, "bad_request"},
		{"ticker=BTC-USDT&period=1m&secret=1", 400, "bad_request"},
		{"ticker=BTC-USDT&ticker=BTC&period=1m", 400, "bad_request"},
		{"ticker=NOPE&period=1m", 404, "unknown_symbol"},
		{"ticker=BTC-USDT&period=1m", 400, "bad_request"}, // OKX spot and perp both: ambiguous
		{"ticker=BTC-USDT&period=1m&market=futures", 404, "unknown_symbol"},
		{"ticker=btc-usdt&period=1m&market=spot", 404, "unknown_symbol"}, // tickers compare exactly
	}
	for _, tc := range cases {
		status, _, body := h.get(t, "/v1/bars?"+tc.q, "secret-all")
		if status != tc.status || errCode(t, body) != tc.code {
			t.Errorf("%s: want %d %s, got %d %s", tc.q, tc.status, tc.code, status, body)
		}
	}
	if status, _, body := h.get(t, "/v1/bars?ticker=BTC&period=1m", "secret-okx"); status != 403 || errCode(t, body) != "forbidden" {
		t.Errorf("a token scoped to OKX may not read Hyperliquid: %d %s", status, body)
	}
	if status, _, body := h.get(t, "/v1/nope", "secret-all"); status != 404 || errCode(t, body) != "not_found" {
		t.Errorf("%d %s", status, body)
	}
	req, _ := http.NewRequest("POST", h.relay.URL+"/v1/bars", nil)
	if resp, _ := http.DefaultClient.Do(req); resp.StatusCode != 405 {
		t.Errorf("POST: %d", resp.StatusCode)
	}
}

func TestSourceNeverLeaksIntoResponses(t *testing.T) {
	h := newHarness(t, []string{"OKX"})
	h.fake.mu.Lock()
	h.fake.fail, h.fake.failMsg = 500, "boom "+marker+" "+testKey
	h.fake.mu.Unlock()
	status, hdr, body := h.get(t, "/v1/bars?ticker=BTC-USDT&market=spot&period=1m", "secret-all")
	if status != 503 || errCode(t, body) != "upstream_unavailable" || hdr.Get("Retry-After") == "" {
		t.Fatalf("%d %s", status, body)
	}
	dump := fmt.Sprint(hdr) + string(body)
	for _, s := range []string{marker, testKey, "aggre", "Aggre", h.fake.srv.URL, "okx", "OKX:SPOT"} {
		if strings.Contains(dump, s) {
			t.Fatalf("response leaks %q: %s", s, dump)
		}
	}
	// a good answer carries nothing but the contract either
	h.fake.mu.Lock()
	h.fake.fail = 0
	h.fake.mu.Unlock()
	status, hdr, body = h.get(t, "/v1/bars?ticker=BTC-USDT&market=spot&period=1m&limit=3", "secret-all")
	dump = fmt.Sprint(hdr) + string(body)
	for _, s := range []string{marker, testKey, "instrument_id", "version", "quote_volume", "meta", "next_cursor", "fetchedAt"} {
		if strings.Contains(dump, s) {
			t.Fatalf("response leaks %q: %s", s, dump)
		}
	}
	if status != 200 {
		t.Fatal(status)
	}
}

func TestUpstreamAuthFailureIsOurProblemNotTheClients(t *testing.T) {
	h := newHarness(t, []string{"OKX"})
	up, _ := NewAggreClient(AggreOptions{BaseURL: h.fake.srv.URL, APIKey: "wrong-key", RPS: 1000})
	h.srv.Service.Up = up
	status, _, body := h.get(t, "/v1/bars?ticker=BTC-USDT&market=spot&period=1m", "secret-all")
	if status != 503 || errCode(t, body) != "upstream_unavailable" {
		t.Fatalf("the source refusing our key must not look like the client's 401: %d %s", status, body)
	}
}

func TestRedirectsAreNotFollowed(t *testing.T) {
	var leaked sync.Map
	evil := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		leaked.Store("auth", r.Header.Get("Authorization"))
		w.WriteHeader(200)
	}))
	defer evil.Close()
	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, evil.URL+"/x", http.StatusFound)
	}))
	defer redirector.Close()
	up, _ := NewAggreClient(AggreOptions{BaseURL: redirector.URL, APIKey: testKey, RPS: 1000})
	if _, err := up.Instruments(context.Background()); err == nil {
		t.Fatal("a redirect is a failure")
	}
	if _, ok := leaked.Load("auth"); ok {
		t.Fatal("the key was sent to the redirect target")
	}
}

func TestCachingAndCollapsing(t *testing.T) {
	h := newHarness(t, []string{"OKX"})
	h.fake.delay = 100 * time.Millisecond
	path := "/v1/bars?ticker=BTC-USDT&market=spot&period=1m&limit=20"
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if status, _, _ := h.get(t, path, "secret-all"); status != 200 {
				t.Errorf("status %d", status)
			}
		}()
	}
	wg.Wait()
	if c := h.fake.calls.Load(); c != 1 {
		t.Fatalf("20 identical requests at once should read the source once, got %d", c)
	}
	h.get(t, path, "secret-all")
	if c := h.fake.calls.Load(); c != 1 {
		t.Fatalf("a repeat within the TTL is served from memory, got %d source reads", c)
	}
	h.clock.Advance(3 * time.Second)
	h.get(t, path, "secret-all")
	if c := h.fake.calls.Load(); c != 2 {
		t.Fatalf("after the TTL the source is read again, got %d", c)
	}
	// the live bar is never cached by clients
	_, hdr, _ := h.get(t, path, "secret-all")
	if hdr.Get("Cache-Control") != "no-store" {
		t.Fatalf("a page with the forming bar: %q", hdr.Get("Cache-Control"))
	}
	// a page that ends long before now is immutable, but only for the one browser
	old := fmt.Sprintf("/v1/bars?ticker=BTC-USDT&market=spot&period=1m&limit=20&to=%d", t0+500*minuteMs)
	_, hdr, _ = h.get(t, old, "secret-all")
	if cc := hdr.Get("Cache-Control"); cc != "private, max-age=3600" {
		t.Fatalf("history cache control %q: shared caches must not hold entitled data", cc)
	}
	if !strings.Contains(strings.Join(hdr.Values("Vary"), ","), "Authorization") {
		t.Fatal("Vary: Authorization")
	}
	// a failure is not cached
	h.fake.mu.Lock()
	h.fake.fail = 502
	h.fake.mu.Unlock()
	fresh := "/v1/bars?ticker=BTC-USDT&market=spot&period=5m&limit=7"
	if status, _, _ := h.get(t, fresh, "secret-all"); status != 503 {
		t.Fatal("expected 503")
	}
	h.fake.mu.Lock()
	h.fake.fail = 0
	h.fake.mu.Unlock()
	if status, _, _ := h.get(t, fresh, "secret-all"); status != 200 {
		t.Fatal("a failure must not be remembered")
	}
}

func TestCacheIsBoundedAndExpires(t *testing.T) {
	ck := &clock{t: time.Unix(1000, 0)}
	c := NewCache(1000, ck.Now)
	for i := 0; i < 50; i++ {
		c.Set(fmt.Sprintf("k%02d", i), CacheEntry{Body: make([]byte, 100)}, time.Minute)
	}
	if c.Bytes() > 1000 {
		t.Fatalf("over budget: %d", c.Bytes())
	}
	if _, ok := c.Get("k49"); !ok {
		t.Fatal("the newest entry stays")
	}
	if _, ok := c.Get("k00"); ok {
		t.Fatal("the oldest entry is evicted")
	}
	c.Set("big", CacheEntry{Body: make([]byte, 600)}, time.Minute)
	if _, ok := c.Get("big"); ok {
		t.Fatal("one response may not take over the cache")
	}
	ck.Advance(2 * time.Minute)
	if _, ok := c.Get("k49"); ok {
		t.Fatal("expired")
	}
}

func TestCORS(t *testing.T) {
	h := newHarness(t, []string{"OKX"}, "https://chart.example.com")
	_, hdr, _ := h.get(t, "/v1/symbols", "secret-all", "Origin", "https://chart.example.com")
	if hdr.Get("Access-Control-Allow-Origin") != "https://chart.example.com" || !strings.Contains(strings.Join(hdr.Values("Vary"), ","), "Origin") {
		t.Fatalf("%v", hdr)
	}
	_, hdr, _ = h.get(t, "/v1/symbols", "secret-all", "Origin", "https://evil.example.com")
	if hdr.Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("an origin that is not listed gets no CORS header")
	}
	req, _ := http.NewRequest("OPTIONS", h.relay.URL+"/v1/bars", nil)
	req.Header.Set("Origin", "https://chart.example.com")
	req.Header.Set("Access-Control-Request-Method", "GET")
	req.Header.Set("Access-Control-Request-Headers", "authorization")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 204 || !strings.Contains(resp.Header.Get("Access-Control-Allow-Headers"), "Authorization") || resp.Header.Get("Access-Control-Allow-Origin") != "https://chart.example.com" {
		t.Fatalf("preflight: %d %v", resp.StatusCode, resp.Header)
	}
	if resp.Header.Get("Access-Control-Allow-Credentials") != "" {
		t.Fatal("never allow credentials")
	}
}

func TestReadyz(t *testing.T) {
	h := newHarness(t, []string{"OKX"})
	if status, _, _ := h.get(t, "/readyz", ""); status != 200 {
		t.Fatal(status)
	}
	h.cat.mu.Lock()
	h.cat.loaded = false
	h.cat.mu.Unlock()
	if status, _, _ := h.get(t, "/readyz", ""); status != 503 {
		t.Fatal("not ready before the instrument list is loaded")
	}
	if status, _, body := h.get(t, "/v1/bars?ticker=BTC-USDT&market=spot&period=1m", "secret-all"); status != 503 || errCode(t, body) != "upstream_unavailable" {
		t.Fatalf("%d %s", status, body)
	}
}

func TestTokenFileValidation(t *testing.T) {
	h1 := sha("a")
	bad := map[string]string{
		"empty":        `{"tokens":[]}`,
		"unknown":      `{"tokens":[{"id":"a","sha256":"` + h1 + `","admin":true}]}`,
		"badid":        `{"tokens":[{"id":"A b","sha256":"` + h1 + `"}]}`,
		"badhash":      `{"tokens":[{"id":"a","sha256":"xyz"}]}`,
		"dupid":        `{"tokens":[{"id":"a","sha256":"` + h1 + `"},{"id":"a","sha256":"` + sha("b") + `"}]}`,
		"duphash":      `{"tokens":[{"id":"a","sha256":"` + h1 + `"},{"id":"b","sha256":"` + h1 + `"}]}`,
		"badexpiry":    `{"tokens":[{"id":"a","sha256":"` + h1 + `","expires":"tomorrow"}]}`,
		"negativerate": `{"tokens":[{"id":"a","sha256":"` + h1 + `","rps":-1}]}`,
		"notjson":      `nope`,
	}
	for name, raw := range bad {
		if _, err := ParseTokens([]byte(raw), nil); err == nil {
			t.Errorf("%s should be refused", name)
		}
	}
	secret, entry, err := MintToken("acme-prod")
	if err != nil || !strings.HasPrefix(secret, "scr_") || len(secret) < 40 {
		t.Fatalf("%q %v", secret, err)
	}
	store, err := ParseTokens([]byte(`{"tokens":[`+entry+`]}`), nil)
	if err != nil {
		t.Fatal(err)
	}
	if tok, err := store.Authenticate("bearer " + secret); err != nil || tok.ID != "acme-prod" {
		t.Fatalf("a minted secret authenticates (scheme is case-insensitive): %v", err)
	}
	if strings.Contains(entry, secret) {
		t.Fatal("the token file must not hold the secret")
	}
	if _, _, err := MintToken("Bad Id"); err == nil {
		t.Fatal("bad id")
	}
}

func TestConfig(t *testing.T) {
	env := func(m map[string]string) func(string) string { return func(k string) string { return m[k] } }
	good := map[string]string{"RELAY_AGGRE_BASE_URL": "https://api.aggre.org", "RELAY_AGGRE_API_KEY": "k", "RELAY_TOKENS_FILE": "/t", "RELAY_ALLOWED_VENUES": "OKX, hyperliquid", "RELAY_ALLOWED_ORIGINS": "https://chart.example.com"}
	c, err := LoadConfig(env(good), nil)
	if err != nil || len(c.Venues) != 2 || c.Addr != ":8080" || len(c.Products) != 3 {
		t.Fatalf("%+v %v", c, err)
	}
	with := func(k, v string) map[string]string {
		m := map[string]string{}
		for a, b := range good {
			m[a] = b
		}
		m[k] = v
		return m
	}
	for name, m := range map[string]map[string]string{
		"no url":         with("RELAY_AGGRE_BASE_URL", ""),
		"no key":         with("RELAY_AGGRE_API_KEY", ""),
		"no tokens":      with("RELAY_TOKENS_FILE", ""),
		"star origin":    with("RELAY_ALLOWED_ORIGINS", "*"),
		"slash origin":   with("RELAY_ALLOWED_ORIGINS", "https://a.example.com/"),
		"http origin":    with("RELAY_ALLOWED_ORIGINS", "http://a.example.com"),
		"bad timeout":    with("RELAY_UPSTREAM_TIMEOUT", "soon"),
		"low refresh":    with("RELAY_CATALOG_REFRESH", "1s"),
		"bad cache":      with("RELAY_CACHE_BYTES", "12"),
		"key and file":   with("RELAY_AGGRE_API_KEY_FILE", "/k"),
		"bad candle cap": with("RELAY_MAX_CANDLES", "5"),
	} {
		if _, err := LoadConfig(env(m), func(string) ([]byte, error) { return []byte("x"), nil }); err == nil {
			t.Errorf("%s should be refused", name)
		}
	}
	m := with("RELAY_AGGRE_API_KEY", "")
	m["RELAY_AGGRE_API_KEY_FILE"] = "/k"
	if c, err := LoadConfig(env(m), func(string) ([]byte, error) { return []byte(" filekey\n"), nil }); err != nil || c.AggreAPIKey != "filekey" {
		t.Fatalf("key from file: %+v %v", c, err)
	}
	for _, bad := range []string{"http://api.aggre.org", "ftp://x", "https://user:pw@api.aggre.org", "https://api.aggre.org?x=1", "nope", ""} {
		if _, err := NewAggreClient(AggreOptions{BaseURL: bad, APIKey: "k"}); err == nil {
			t.Errorf("%q should be refused", bad)
		}
	}
	if _, err := NewAggreClient(AggreOptions{BaseURL: "http://127.0.0.1:9", APIKey: "k"}); err != nil {
		t.Errorf("plain http to loopback is allowed for local tests: %v", err)
	}
}

func TestMalformedUpstreamRowsAreRejected(t *testing.T) {
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"data":[{"ts":1,"open":1,"high":2,"low":0,"close":1}]}`) // no volume
	}))
	defer bad.Close()
	up, _ := NewAggreClient(AggreOptions{BaseURL: bad.URL, APIKey: testKey, RPS: 1000})
	if _, err := up.Candles(context.Background(), Base1m, "x", nil, nil, 10); err == nil {
		t.Fatal("a candle without a volume is not served")
	}
}

type flakyUpstream struct {
	Upstream
	mu    sync.Mutex
	fails int
	calls int
}

func (f *flakyUpstream) Instruments(ctx context.Context) ([]Instrument, error) {
	f.mu.Lock()
	f.calls++
	fail := f.calls <= f.fails
	f.mu.Unlock()
	if fail {
		return nil, errUpstream
	}
	return f.Upstream.Instruments(ctx)
}

func TestCatalogRetriesQuicklyWhenTheSourceWasDownAtStart(t *testing.T) {
	h := newHarness(t, []string{"OKX"})
	up, _ := NewAggreClient(AggreOptions{BaseURL: h.fake.srv.URL, APIKey: testKey, RPS: 1000})
	cat := NewCatalog([]string{"OKX"}, []string{"SPOT"})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go cat.Refresh(ctx, &flakyUpstream{Upstream: up, fails: 2}, time.Hour, 10*time.Millisecond, slog.New(slog.NewTextHandler(io.Discard, nil)))
	deadline := time.Now().Add(3 * time.Second)
	for !cat.Loaded() {
		if time.Now().After(deadline) {
			t.Fatal("the catalog never loaded although the source recovered")
		}
		time.Sleep(5 * time.Millisecond)
	}
	if cat.Len() != 1 {
		t.Fatalf("only OKX spot was allowed: %d", cat.Len())
	}
}
