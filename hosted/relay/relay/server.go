// Copyright 2026 SUPER SOLUTION LABS INC

// Package relay is the hosted Super Solution datafeed relay: it serves the HTTP datafeed contract
// (docs/DATAFEED-HTTP.md) to authenticated chart users from stored Aggre market candles, and is the only
// thing that holds the Aggre credentials. Nothing from the data source other than the contract's own
// fields ever reaches a response.
package relay

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Server is the relay's HTTP handler.
type Server struct {
	Tokens  *TokenStore
	Catalog *Catalog
	Service *Service
	Cache   *Cache
	Origins map[string]bool
	Log     *slog.Logger
	Now     func() time.Time

	flights *flights
}

// NewServer wires a handler.
func NewServer(tokens *TokenStore, catalog *Catalog, svc *Service, cache *Cache, origins []string, log *slog.Logger) *Server {
	o := map[string]bool{}
	for _, v := range origins {
		o[v] = true
	}
	return &Server{Tokens: tokens, Catalog: catalog, Service: svc, Cache: cache, Origins: o, Log: log, Now: time.Now, flights: newFlights()}
}

type apiError struct {
	Status  int
	Code    string
	Message string
	Retry   time.Duration
}

func fail(status int, code, msg string) *apiError {
	return &apiError{Status: status, Code: code, Message: msg}
}

type recorder struct {
	http.ResponseWriter
	status int
}

func (r *recorder) WriteHeader(code int) { r.status = code; r.ResponseWriter.WriteHeader(code) }

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := s.Now()
	rec := &recorder{ResponseWriter: w, status: http.StatusOK}
	id := requestID()
	h := rec.Header()
	h.Set("X-Request-Id", id)
	h.Set("X-Content-Type-Options", "nosniff")
	var tokenID string
	defer func() {
		if p := recover(); p != nil {
			s.Log.Error("panic in handler", "request_id", id, "panic", p)
			if rec.status == http.StatusOK {
				s.writeError(rec, fail(500, "internal", "Internal error."))
			}
		}
		s.Log.Info("request", "request_id", id, "method", r.Method, "path", r.URL.Path, "status", rec.status,
			"token", tokenID, "ms", s.Now().Sub(start).Milliseconds())
	}()
	s.cors(rec, r)
	if r.Method == http.MethodOptions {
		rec.Header().Set("Allow", "GET, HEAD, OPTIONS")
		rec.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		rec.Header().Set("Allow", "GET, HEAD, OPTIONS")
		s.writeError(rec, fail(405, "method_not_allowed", "Use GET."))
		return
	}
	switch r.URL.Path {
	case "/healthz":
		s.writeJSON(rec, 200, []byte(`{"status":"ok"}`), "no-store")
		return
	case "/readyz":
		if !s.Catalog.Loaded() {
			s.writeError(rec, fail(503, "upstream_unavailable", "Not ready."))
			return
		}
		s.writeJSON(rec, 200, []byte(`{"status":"ready"}`), "no-store")
		return
	case "/v1/symbols", "/v1/bars":
	default:
		s.writeError(rec, fail(404, "not_found", "Unknown route."))
		return
	}

	tok, err := s.Tokens.Authenticate(r.Header.Get("Authorization"))
	if err != nil {
		rec.Header().Set("WWW-Authenticate", `Bearer realm="super-chart-relay"`)
		s.writeError(rec, fail(401, "unauthorized", "Missing or invalid credentials."))
		return
	}
	tokenID = tok.ID
	if ok, wait := tok.bucket.Take(); !ok {
		e := fail(429, "rate_limited", "Too many requests.")
		e.Retry = wait
		s.writeError(rec, e)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	var aerr *apiError
	if r.URL.Path == "/v1/symbols" {
		aerr = s.symbols(ctx, rec, r, tok)
	} else {
		aerr = s.bars(ctx, rec, r, tok)
	}
	if aerr != nil {
		s.writeError(rec, aerr)
	}
}

func requestID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *Server) cors(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Add("Vary", "Origin")
	origin := r.Header.Get("Origin")
	if origin == "" || !s.Origins[origin] {
		return
	}
	h.Set("Access-Control-Allow-Origin", origin)
	h.Set("Access-Control-Expose-Headers", "Retry-After, X-Request-Id")
	if r.Method == http.MethodOptions {
		h.Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
		h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		h.Set("Access-Control-Max-Age", "600")
	}
}

func (s *Server) writeJSON(w http.ResponseWriter, status int, body []byte, cacheControl string) {
	h := w.Header()
	h.Set("Content-Type", "application/json; charset=utf-8")
	h.Set("Cache-Control", cacheControl)
	h.Add("Vary", "Authorization")
	h.Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func (s *Server) writeError(w http.ResponseWriter, e *apiError) {
	body, _ := json.Marshal(map[string]any{"error": map[string]string{"code": e.Code, "message": e.Message}})
	if e.Retry > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(int((e.Retry+time.Second-1)/time.Second)))
	}
	s.writeJSON(w, e.Status, body, "no-store")
}

// query returns the request's parameters, refusing unknown names, repeats and empty names.
func query(r *http.Request, allowed ...string) (url.Values, *apiError) {
	q := r.URL.Query()
	ok := map[string]bool{}
	for _, a := range allowed {
		ok[a] = true
	}
	for k, v := range q {
		if !ok[k] {
			return nil, fail(400, "bad_request", "Unknown parameter.")
		}
		if len(v) != 1 {
			return nil, fail(400, "bad_request", "Repeated parameter "+k+".")
		}
	}
	return q, nil
}

const maxEpochMs = int64(4_102_444_800_000) // 2100-01-01

func intParam(q url.Values, name string, def, lo, hi int64) (int64, bool, *apiError) {
	if !q.Has(name) {
		return def, false, nil
	}
	v := q.Get(name)
	if len(v) == 0 || len(v) > 16 {
		return 0, false, fail(400, "bad_request", name+" must be a whole number.")
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil || n < lo || n > hi {
		return 0, false, fail(400, "bad_request", name+" is out of range.")
	}
	return n, true, nil
}

func (s *Server) symbols(ctx context.Context, w http.ResponseWriter, r *http.Request, tok *Token) *apiError {
	q, aerr := query(r, "search", "limit")
	if aerr != nil {
		return aerr
	}
	limit, _, aerr := intParam(q, "limit", 50, 1, 200)
	if aerr != nil {
		return aerr
	}
	search := q.Get("search")
	if len(search) > 100 {
		return fail(400, "bad_request", "search is too long.")
	}
	if !s.Catalog.Loaded() {
		return fail(503, "upstream_unavailable", "The service is starting; retry shortly.")
	}
	found := s.Catalog.Search(search, int(limit), tok)
	infos := make([]SymbolInfo, 0, len(found))
	for _, e := range found {
		infos = append(infos, e.Info)
	}
	body, _ := json.Marshal(map[string]any{"symbols": infos})
	s.writeJSON(w, 200, body, "private, max-age=60")
	return nil
}

func (s *Server) bars(ctx context.Context, w http.ResponseWriter, r *http.Request, tok *Token) *apiError {
	q, aerr := query(r, "ticker", "period", "from", "to", "limit", "market", "exchange")
	if aerr != nil {
		return aerr
	}
	ticker := q.Get("ticker")
	if ticker == "" || len(ticker) > 64 {
		return fail(400, "bad_request", "ticker is required.")
	}
	if len(q.Get("market")) > 16 || len(q.Get("exchange")) > 32 {
		return fail(400, "bad_request", "market or exchange is too long.")
	}
	period, ok := ParsePeriod(q.Get("period"))
	if !ok {
		return fail(400, "invalid_period", "period must be one of "+OfferedPeriods()+".")
	}
	var from, to *int64
	if v, set, aerr := intParam(q, "from", 0, 0, maxEpochMs); aerr != nil {
		return aerr
	} else if set {
		from = &v
	}
	if v, set, aerr := intParam(q, "to", 0, 0, maxEpochMs); aerr != nil {
		return aerr
	} else if set {
		to = &v
	}
	if from != nil && to != nil && *from > *to {
		return fail(400, "bad_request", "from must not be after to.")
	}
	limit, _, aerr := intParam(q, "limit", DefaultLimit, 1, MaxLimit)
	if aerr != nil {
		return aerr
	}
	if !s.Catalog.Loaded() {
		return fail(503, "upstream_unavailable", "The service is starting; retry shortly.")
	}
	entry, err := s.Catalog.Resolve(ticker, strings.ToLower(q.Get("market")), strings.ToUpper(q.Get("exchange")))
	switch {
	case errors.Is(err, errAmbiguous):
		return fail(400, "bad_request", "ticker is ambiguous: add market and exchange.")
	case err != nil:
		return fail(404, "unknown_symbol", "Unknown symbol.")
	}
	if !tok.Allows(entry.Venue, entry.Product) {
		return fail(403, "forbidden", "This key may not read this symbol.")
	}

	bq := BarsQuery{Entry: entry, Period: period, From: from, To: to, Limit: int(limit)}
	key := cacheKey(bq)
	ttl, immutable := cacheTTL(period, to, s.Now())
	cached, hit := s.Cache.Get(key)
	if !hit {
		cached, err = s.flights.Do(ctx, key, func() (CacheEntry, error) {
			fctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			res, err := s.Service.Bars(fctx, bq)
			if err != nil {
				return CacheEntry{}, err
			}
			body, err := json.Marshal(struct {
				Ticker string `json:"ticker"`
				Period string `json:"period"`
				Bars   []Bar  `json:"bars"`
				NoData bool   `json:"noData"`
			}{entry.Info.Ticker, period.Token, res.Bars, res.NoData})
			if err != nil {
				return CacheEntry{}, errInternal
			}
			e := CacheEntry{Body: body, Immutable: immutable}
			s.Cache.Set(key, e, ttl)
			return e, nil
		})
		if err != nil {
			return s.upstreamFailure(r, err)
		}
	}
	cc := "no-store"
	if cached.Immutable {
		// Entitled data: browsers may keep it, shared caches must not serve it to anyone else.
		cc = "private, max-age=3600"
	}
	s.writeJSON(w, 200, cached.Body, cc)
	return nil
}

func (s *Server) upstreamFailure(r *http.Request, err error) *apiError {
	if r.Context().Err() != nil {
		return fail(503, "upstream_unavailable", "Request cancelled.")
	}
	if !errors.Is(err, errInternal) {
		s.Log.Error("data source failure", "error", err.Error())
		e := fail(503, "upstream_unavailable", "Market data is temporarily unavailable. Retry shortly.")
		e.Retry = 5 * time.Second
		return e
	}
	s.Log.Error("internal failure", "error", err.Error())
	return fail(500, "internal", "Internal error.")
}
