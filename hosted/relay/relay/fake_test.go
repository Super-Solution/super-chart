package relay

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sort"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const (
	testKey    = "aggre_sk_test_key_value_0123456789"
	marker     = "AGGRE-INTERNAL-MARKER"
	okxBTC     = "OKX:SPOT:BTC-USDT"
	okxBTCPerp = "OKX:PERP:BTC-USDT"
	hlBTCPerp  = "HYPERLIQUID:PERP:BTC"
	otherVenue = "BITGET:SPOT:ETH-USDT"
)

// t0 is a Monday 00:00 UTC.
var t0 = time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC).UnixMilli()

// fakeAggre is a stand-in for Aggre's HTTP API: it checks the key, honours from/to/limit/order and counts calls.
type fakeAggre struct {
	srv     *httptest.Server
	calls   atomic.Int64
	mu      sync.Mutex
	fail    int // when non-zero every candle request answers this status
	failMsg string
	// minutes of 1m data per instrument: candles open at t0 + i*60000 for i in [0, n)
	n           map[string]int
	instruments []map[string]any
	delay       time.Duration
	lastQuery   sync.Map
}

func candleAt(id string, i int) map[string]any {
	open := 100 + float64(i%17)
	cls := 100 + float64((i*7)%19)
	hi := max(open, cls) + float64(i%3)
	lo := min(open, cls) - float64(i%5)
	vol := float64(1 + i%7)
	return map[string]any{"instrument_id": id, "ts": 0, "open": open, "high": hi, "low": lo, "close": cls, "volume": vol, "quote_volume": vol * open, "version": 1}
}

// minuteCandle returns the stored 1m candle number i.
func minuteCandle(id string, i int) map[string]any {
	c := candleAt(id, i)
	c["ts"] = t0 + int64(i)*minuteMs
	return c
}

// foldCandles builds the stored candle of size ms that starts at slot j from the 1m data (the data source's own roll-up).
func foldCandles(id string, ms int64, j, n int) map[string]any {
	per := int(ms / minuteMs)
	lo, hi := j*per, min((j+1)*per, n)
	if lo >= n {
		return nil
	}
	first, last := minuteCandle(id, lo), minuteCandle(id, hi-1)
	c := map[string]any{"instrument_id": id, "ts": t0 + int64(j)*ms, "open": first["open"], "close": last["close"], "high": first["high"], "low": first["low"], "volume": 0.0, "quote_volume": 0.0, "version": 1}
	for i := lo; i < hi; i++ {
		m := minuteCandle(id, i)
		c["high"] = max(c["high"].(float64), m["high"].(float64))
		c["low"] = min(c["low"].(float64), m["low"].(float64))
		c["volume"] = c["volume"].(float64) + m["volume"].(float64)
		c["quote_volume"] = c["quote_volume"].(float64) + m["quote_volume"].(float64)
	}
	return c
}

func newFake(t *testing.T) *fakeAggre {
	f := &fakeAggre{n: map[string]int{okxBTC: 3600, okxBTCPerp: 3600, hlBTCPerp: 3600, otherVenue: 3600}}
	f.instruments = []map[string]any{
		{"instrument_id": okxBTC, "venue": "OKX", "product": "SPOT", "symbol": "BTCUSDT", "native": "BTC-USDT", "base": "BTC", "quote": "USDT", "tick_size": "0.10", "display_name": nil, "enabled": true},
		{"instrument_id": okxBTCPerp, "venue": "OKX", "product": "PERP", "symbol": "BTCUSDT", "native": "BTC-USDT", "base": "BTC", "quote": "USDT", "tick_size": "0.1", "display_name": "BTC perpetual", "enabled": true},
		{"instrument_id": hlBTCPerp, "venue": "HYPERLIQUID", "product": "PERP", "symbol": "BTC", "native": "BTC", "base": "BTC", "quote": "USD", "tick_size": nil, "display_name": nil, "enabled": true},
		{"instrument_id": otherVenue, "venue": "BITGET", "product": "SPOT", "symbol": "ETHUSDT", "native": "ETH-USDT", "base": "ETH", "quote": "USDT", "tick_size": "0.01", "display_name": nil, "enabled": true},
		{"instrument_id": "OKX:SPOT:OLD-USDT", "venue": "OKX", "product": "SPOT", "symbol": "OLDUSDT", "native": "OLD-USDT", "base": "OLD", "quote": "USDT", "tick_size": nil, "display_name": nil, "enabled": false},
	}
	f.srv = httptest.NewServer(http.HandlerFunc(f.handle))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeAggre) handle(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Authorization") != "Bearer "+testKey {
		w.WriteHeader(401)
		return
	}
	reply := func(v any) { w.Header().Set("Content-Type", "application/json"); _ = json.NewEncoder(w).Encode(v) }
	meta := map[string]any{"source": "okx", "status": "ok", "fetchedAt": "2026-11-05T00:00:00Z", "dataDate": nil, "message": marker}
	if r.URL.Path == "/v1/finance/market/instruments" {
		reply(map[string]any{"data": f.instruments, "meta": meta})
		return
	}
	var ms int64
	switch r.URL.Path {
	case "/v1/finance/market/candles_1m":
		ms = minuteMs
	case "/v1/finance/market/candles_1h":
		ms = hourMs
	case "/v1/finance/market/candles_1d":
		ms = dayMs
	default:
		w.WriteHeader(404)
		return
	}
	f.calls.Add(1)
	if f.delay > 0 {
		time.Sleep(f.delay)
	}
	f.lastQuery.Store(r.URL.Path, r.URL.RawQuery)
	f.mu.Lock()
	status, msg := f.fail, f.failMsg
	f.mu.Unlock()
	if status != 0 {
		w.WriteHeader(status)
		_, _ = io.WriteString(w, msg)
		return
	}
	q := r.URL.Query()
	id := q.Get("instrument_id")
	n, ok := f.n[id]
	if !ok {
		w.WriteHeader(404)
		return
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit < 1 || limit > 1000 {
		w.WriteHeader(400)
		return
	}
	var rows []map[string]any
	for j := 0; ; j++ {
		var c map[string]any
		if ms == minuteMs {
			if j >= n {
				break
			}
			c = minuteCandle(id, j)
		} else {
			// a stored hour/day is confirmed only once all its minutes exist
			if (j+1)*int(ms/minuteMs) > n {
				break
			}
			c = foldCandles(id, ms, j, n)
		}
		ts := c["ts"].(int64)
		if v := q.Get("from"); v != "" {
			if from, _ := strconv.ParseInt(v, 10, 64); ts < from {
				continue
			}
		}
		if v := q.Get("to"); v != "" {
			if to, _ := strconv.ParseInt(v, 10, 64); ts >= to {
				continue
			}
		}
		rows = append(rows, c)
	}
	sort.Slice(rows, func(a, b int) bool {
		if q.Get("order") == "asc" {
			return rows[a]["ts"].(int64) < rows[b]["ts"].(int64)
		}
		return rows[a]["ts"].(int64) > rows[b]["ts"].(int64)
	})
	if len(rows) > limit {
		rows = rows[:limit]
	}
	reply(map[string]any{"data": rows, "meta": meta, "next_cursor": nil})
}

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) Now() time.Time          { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *clock) Advance(d time.Duration) { c.mu.Lock(); c.t = c.t.Add(d); c.mu.Unlock() }

type harness struct {
	fake  *fakeAggre
	relay *httptest.Server
	srv   *Server
	clock *clock
	cat   *Catalog
}

const tokensJSON = `{"tokens":[
 {"id":"all","sha256":"%s","rps":1000,"burst":1000},
 {"id":"okx-only","sha256":"%s","rps":1000,"burst":1000,"venues":["okx"]},
 {"id":"slow","sha256":"%s","rps":1,"burst":2},
 {"id":"expired","sha256":"%s","expires":"2026-01-01T00:00:00Z"}
]}`

func sha(s string) string { return fmt.Sprintf("%x", sha256Sum(s)) }

func newHarness(t *testing.T, venues []string, origins ...string) *harness {
	t.Helper()
	fake := newFake(t)
	// "now" is 2 days and 3 hours after t0, one confirmed minute behind the data's end (3 days of data)
	ck := &clock{t: time.UnixMilli(t0).UTC().Add(60 * time.Hour)}
	tokens, err := ParseTokens([]byte(fmt.Sprintf(tokensJSON, sha("secret-all"), sha("secret-okx"), sha("secret-slow"), sha("secret-expired"))), ck.Now)
	if err != nil {
		t.Fatal(err)
	}
	up, err := NewAggreClient(AggreOptions{BaseURL: fake.srv.URL, APIKey: testKey, Timeout: 5 * time.Second, Concurrency: 4, RPS: 10000})
	if err != nil {
		t.Fatal(err)
	}
	cat := NewCatalog(venues, []string{"SPOT", "PERP", "FUTURES"})
	list, err := up.Instruments(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	cat.Replace(list)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	srv := NewServer(tokens, cat, &Service{Up: up}, NewCache(8<<20, ck.Now), origins, log)
	srv.Now = ck.Now
	rs := httptest.NewServer(srv)
	t.Cleanup(rs.Close)
	return &harness{fake: fake, relay: rs, srv: srv, clock: ck, cat: cat}
}

func (h *harness) get(t *testing.T, path, token string, hdr ...string) (int, http.Header, []byte) {
	t.Helper()
	req, _ := http.NewRequest("GET", h.relay.URL+path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, resp.Header, b
}

type barsBody struct {
	Ticker string           `json:"ticker"`
	Period string           `json:"period"`
	Bars   []map[string]any `json:"bars"`
	NoData bool             `json:"noData"`
}

func (h *harness) bars(t *testing.T, query string) barsBody {
	t.Helper()
	status, _, body := h.get(t, "/v1/bars?"+query, "secret-all")
	if status != 200 {
		t.Fatalf("GET /v1/bars?%s = %d %s", query, status, body)
	}
	var b barsBody
	if err := json.Unmarshal(body, &b); err != nil {
		t.Fatal(err)
	}
	return b
}

func errCode(t *testing.T, body []byte) string {
	t.Helper()
	var e struct {
		Error struct{ Code, Message string } `json:"error"`
	}
	if err := json.Unmarshal(body, &e); err != nil || e.Error.Code == "" {
		t.Fatalf("not an error body: %s", body)
	}
	return e.Error.Code
}
