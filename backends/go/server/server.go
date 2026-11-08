// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 SUPER SOLUTION LABS INC

// Package server serves the Super Chart technical-analysis kernels over HTTP.
//
//	GET  /healthz         liveness
//	GET  /v1/indicators   the catalog: every fn with its inputs, params, defaults and outputs
//	POST /v1/indicators   price bars in, indicator series out
//
// The server is stateless and stores nothing. The contract (request, response, error codes) is documented in
// docs/INDICATORS-SERVER.md and is identical in the Python backend.
package server

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"regexp"
	"strings"

	"github.com/Super-Solution/super-chart/backends/go/ta"
)

// Config bounds one request. The zero value gives the defaults.
type Config struct {
	// MaxBars is the longest series accepted (default 100000).
	MaxBars int
	// MaxIndicators is the most indicators in one request (default 64).
	MaxIndicators int
	// MaxBodyBytes is the largest request body (default 16 MiB).
	MaxBodyBytes int64
	// APIKey, when set, must be sent as "Authorization: Bearer <key>" on every route except /healthz.
	APIKey string
}

func (c Config) withDefaults() Config {
	if c.MaxBars <= 0 {
		c.MaxBars = 100_000
	}
	if c.MaxIndicators <= 0 {
		c.MaxIndicators = 64
	}
	if c.MaxBodyBytes <= 0 {
		c.MaxBodyBytes = 16 << 20
	}
	return c
}

type apiError struct {
	status  int
	code    string
	message string
}

func (e *apiError) Error() string { return e.code + ": " + e.message }

func fail(status int, code, format string, args ...any) *apiError {
	return &apiError{status, code, fmt.Sprintf(format, args...)}
}

type request struct {
	Bars       json.RawMessage `json:"bars"`
	Indicators []indicatorReq  `json:"indicators"`
}

type indicatorReq struct {
	ID     string         `json:"id"`
	Fn     string         `json:"fn"`
	Inputs map[string]any `json:"inputs"`
	Params map[string]any `json:"params"`
}

type resultItem struct {
	ID     string               `json:"id"`
	Fn     string               `json:"fn"`
	Series map[string]ta.Series `json:"series"`
}

type response struct {
	Version int          `json:"version"`
	Bars    int          `json:"bars"`
	Results []resultItem `json:"results"`
}

var idPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// barFields are the names a source may take without being the id of an earlier indicator.
var barFields = map[string]bool{
	"open": true, "high": true, "low": true, "close": true, "volume": true,
	"hl2": true, "hlc3": true, "ohlc4": true, "hlcc4": true,
}

// New returns the HTTP handler.
func New(cfg Config) http.Handler {
	cfg = cfg.withDefaults()
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			methodNotAllowed(w, "GET, HEAD")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/v1/indicators", func(w http.ResponseWriter, r *http.Request) {
		if !authorized(cfg, r) {
			writeError(w, fail(http.StatusUnauthorized, "unauthorized", "a valid bearer token is required"))
			return
		}
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, http.StatusOK, map[string]any{"version": 1, "indicators": catalog, "sources": sourceNames()})
		case http.MethodPost:
			compute(cfg, w, r)
		default:
			methodNotAllowed(w, "GET, POST")
		}
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, fail(http.StatusNotFound, "not_found", "no such route"))
	})
	return mux
}

func sourceNames() []string {
	return []string{"open", "high", "low", "close", "volume", "hl2", "hlc3", "ohlc4", "hlcc4"}
}

func authorized(cfg Config, r *http.Request) bool {
	if cfg.APIKey == "" {
		return true
	}
	got, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	return ok && subtle.ConstantTimeCompare([]byte(got), []byte(cfg.APIKey)) == 1
}

func methodNotAllowed(w http.ResponseWriter, allow string) {
	w.Header().Set("Allow", allow)
	writeError(w, fail(http.StatusMethodNotAllowed, "method_not_allowed", "use %s", allow))
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(v); err != nil {
		http.Error(w, `{"error":{"code":"internal","message":"encode failed"}}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(buf.Bytes())
}

func writeError(w http.ResponseWriter, e *apiError) {
	writeJSON(w, e.status, map[string]any{"error": map[string]string{"code": e.code, "message": e.message}})
}

func compute(cfg Config, w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, cfg.MaxBodyBytes))
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, fail(http.StatusRequestEntityTooLarge, "body_too_large", "the request body is over %d bytes", cfg.MaxBodyBytes))
			return
		}
		writeError(w, fail(http.StatusBadRequest, "invalid_request", "the request body could not be read"))
		return
	}
	results, apiErr := run(cfg, body)
	if apiErr != nil {
		writeError(w, apiErr)
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func decodeStrict(data []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	if _, err := dec.Token(); err != io.EOF {
		return errors.New("unexpected data after the JSON value")
	}
	return nil
}

type bars struct {
	n      int
	fields map[string]ta.Series
}

func parseBars(raw json.RawMessage, max int) (*bars, *apiError) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return nil, fail(http.StatusBadRequest, "invalid_request", `"bars" is required`)
	}
	b := &bars{fields: map[string]ta.Series{}}
	switch trimmed[0] {
	case '{':
		var cols struct {
			Open, High, Low, Close, Volume ta.Series
		}
		// Field names are lower case in the wire format; encoding/json matches them case-insensitively.
		if err := json.Unmarshal(trimmed, &cols); err != nil {
			return nil, fail(http.StatusBadRequest, "invalid_bars", "bars must hold arrays of numbers or null: %v", err)
		}
		first := true
		for _, f := range []struct {
			name string
			s    ta.Series
		}{{"open", cols.Open}, {"high", cols.High}, {"low", cols.Low}, {"close", cols.Close}, {"volume", cols.Volume}} {
			if f.s == nil {
				continue
			}
			if first {
				b.n, first = len(f.s), false
			} else if len(f.s) != b.n {
				return nil, fail(http.StatusBadRequest, "bars_length_mismatch", `"%s" has %d values, expected %d`, f.name, len(f.s), b.n)
			}
			b.fields[f.name] = f.s
		}
	case '[':
		var rows []struct {
			Open, High, Low, Close, Volume *float64
		}
		if err := json.Unmarshal(trimmed, &rows); err != nil {
			return nil, fail(http.StatusBadRequest, "invalid_bars", "each bar must be an object with numeric fields: %v", err)
		}
		b.n = len(rows)
		for _, name := range []string{"open", "high", "low", "close", "volume"} {
			b.fields[name] = make(ta.Series, b.n)
		}
		for i, row := range rows {
			b.fields["open"][i], b.fields["high"][i], b.fields["low"][i] = row.Open, row.High, row.Low
			b.fields["close"][i], b.fields["volume"][i] = row.Close, row.Volume
		}
	default:
		return nil, fail(http.StatusBadRequest, "invalid_bars", "bars must be an object of arrays or an array of objects")
	}
	if b.n > max {
		return nil, fail(http.StatusRequestEntityTooLarge, "too_many_bars", "%d bars is over the limit of %d", b.n, max)
	}
	return b, nil
}

// derived computes hl2, hlc3, ohlc4 and hlcc4; a bar missing any component gives null.
func (b *bars) derived(name string) (ta.Series, bool) {
	var parts []string
	var weights []float64
	switch name {
	case "hl2":
		parts, weights = []string{"high", "low"}, []float64{1, 1}
	case "hlc3":
		parts, weights = []string{"high", "low", "close"}, []float64{1, 1, 1}
	case "ohlc4":
		parts, weights = []string{"open", "high", "low", "close"}, []float64{1, 1, 1, 1}
	case "hlcc4":
		parts, weights = []string{"high", "low", "close"}, []float64{1, 1, 2}
	default:
		return nil, false
	}
	var total float64
	for _, w := range weights {
		total += w
	}
	comps := make([]ta.Series, len(parts))
	for i, p := range parts {
		if comps[i] = b.fields[p]; comps[i] == nil {
			return nil, false
		}
	}
	out := make(ta.Series, b.n)
	for i := 0; i < b.n; i++ {
		sum, ok := 0.0, true
		for k, c := range comps {
			if c[i] == nil {
				ok = false
				break
			}
			sum += weights[k] * *c[i]
		}
		if ok {
			v := sum / total
			out[i] = &v
		}
	}
	return out, true
}

func run(cfg Config, body []byte) (*response, *apiError) {
	var req request
	if err := decodeStrict(body, &req); err != nil {
		return nil, fail(http.StatusBadRequest, "invalid_request", "%v", err)
	}
	if len(req.Indicators) == 0 {
		return nil, fail(http.StatusBadRequest, "invalid_request", `"indicators" must list at least one indicator`)
	}
	if len(req.Indicators) > cfg.MaxIndicators {
		return nil, fail(http.StatusRequestEntityTooLarge, "too_many_indicators", "%d indicators is over the limit of %d", len(req.Indicators), cfg.MaxIndicators)
	}
	b, apiErr := parseBars(req.Bars, cfg.MaxBars)
	if apiErr != nil {
		return nil, apiErr
	}

	done := map[string]*resultItem{}
	out := make([]resultItem, 0, len(req.Indicators))
	for i, ind := range req.Indicators {
		s, ok := byName[ind.Fn]
		if !ok {
			return nil, fail(http.StatusBadRequest, "unknown_indicator", "indicators[%d]: unknown fn %q", i, ind.Fn)
		}
		id := ind.ID
		if id == "" {
			id = ind.Fn
		}
		if !idPattern.MatchString(id) {
			return nil, fail(http.StatusBadRequest, "invalid_id", "indicators[%d]: id %q must be 1-64 letters, digits, _ or -", i, id)
		}
		if barFields[id] || done[id] != nil {
			return nil, fail(http.StatusBadRequest, "duplicate_id", "indicators[%d]: id %q is already used", i, id)
		}

		inputs := map[string]ta.Series{}
		for name, v := range ind.Inputs {
			if !hasInput(s, name) {
				return nil, fail(http.StatusBadRequest, "invalid_input", "indicators[%d] (%s): %q has no input %q", i, id, s.Name, name)
			}
			if _, isString := v.(string); !isString {
				return nil, fail(http.StatusBadRequest, "invalid_input", "indicators[%d] (%s): input %q must be a source name", i, id, name)
			}
		}
		for _, in := range s.Inputs {
			source, _ := ind.Inputs[in.Name].(string)
			if source == "" {
				source = in.Default
			}
			if source == "" {
				return nil, fail(http.StatusBadRequest, "missing_input", "indicators[%d] (%s): input %q is required", i, id, in.Name)
			}
			series, apiErr := resolve(b, done, source)
			if apiErr != nil {
				apiErr.message = fmt.Sprintf("indicators[%d] (%s): input %q: %s", i, id, in.Name, apiErr.message)
				return nil, apiErr
			}
			inputs[in.Name] = series
		}

		params := map[string]float64{}
		for name := range ind.Params {
			if !hasParam(s, name) {
				return nil, fail(http.StatusBadRequest, "invalid_param", "indicators[%d] (%s): %q has no param %q", i, id, s.Name, name)
			}
		}
		for _, p := range s.Params {
			v := p.Default
			if raw, given := ind.Params[p.Name]; given {
				num, isNumber := raw.(float64)
				if !isNumber || math.IsNaN(num) || math.IsInf(num, 0) {
					return nil, fail(http.StatusBadRequest, "invalid_param", "indicators[%d] (%s): %q must be a finite number", i, id, p.Name)
				}
				v = num
			}
			if p.Integer && (v < 0 || v != math.Floor(v)) {
				return nil, fail(http.StatusBadRequest, "invalid_param", "indicators[%d] (%s): %q must be a whole number of bars, 0 or more", i, id, p.Name)
			}
			params[p.Name] = v
		}

		series := s.run(inputs, params)
		for name, ser := range series {
			series[name] = finite(ser)
		}
		item := resultItem{ID: id, Fn: s.Name, Series: series}
		out = append(out, item)
		done[id] = &out[len(out)-1]
	}
	return &response{Version: 1, Bars: b.n, Results: out}, nil
}

func hasInput(s *spec, name string) bool {
	for _, in := range s.Inputs {
		if in.Name == name {
			return true
		}
	}
	return false
}

func hasParam(s *spec, name string) bool {
	for _, p := range s.Params {
		if p.Name == name {
			return true
		}
	}
	return false
}

// resolve finds a source by name: a bar field, a derived price, or the output of an earlier indicator
// ("id", or "id.output" when it has several outputs).
func resolve(b *bars, done map[string]*resultItem, source string) (ta.Series, *apiError) {
	if barFields[source] {
		if s, ok := b.fields[source]; ok {
			return s, nil
		}
		if s, ok := b.derived(source); ok {
			return s, nil
		}
		return nil, fail(http.StatusBadRequest, "missing_bars_field", "the bars carry no data for %q", source)
	}
	id, output, dotted := strings.Cut(source, ".")
	prev, ok := done[id]
	if !ok {
		return nil, fail(http.StatusBadRequest, "unknown_source", "%q is neither a bar field nor an earlier indicator id", source)
	}
	if !dotted {
		if len(prev.Series) != 1 {
			return nil, fail(http.StatusBadRequest, "ambiguous_source", "%q has several outputs; name one as %s.<output>", id, id)
		}
		for _, s := range prev.Series {
			return s, nil
		}
	}
	s, ok := prev.Series[output]
	if !ok {
		return nil, fail(http.StatusBadRequest, "unknown_source", "%q has no output %q", id, output)
	}
	return s, nil
}

// finite turns NaN and infinities into null: JSON cannot carry them, and a null means "no value" everywhere else.
func finite(s ta.Series) ta.Series {
	out := make(ta.Series, len(s))
	for i, v := range s {
		if v != nil && !math.IsNaN(*v) && !math.IsInf(*v, 0) {
			out[i] = v
		}
	}
	return out
}
