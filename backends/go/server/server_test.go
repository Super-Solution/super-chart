// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 SUPER SOLUTION LABS INC

package server

import (
	"bytes"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"sort"
	"strings"
	"testing"
)

func post(t *testing.T, h http.Handler, cfg string, body string, headers ...string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/v1/indicators", strings.NewReader(body))
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("%s: response is not JSON: %v\n%s", cfg, err, rec.Body.String())
	}
	return rec.Code, out
}

func errorCode(out map[string]any) string {
	if e, ok := out["error"].(map[string]any); ok {
		code, _ := e["code"].(string)
		return code
	}
	return ""
}

// Every case pinned by conformance/indicators.v1.json, replayed through POST /v1/indicators: the HTTP layer
// (input mapping, parameter defaults, series naming) must not change a kernel's numbers.
func TestConformanceThroughHTTP(t *testing.T) {
	raw, err := os.ReadFile("../../../conformance/indicators.v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var data struct {
		Cases []struct {
			Fn        string                     `json:"fn"`
			Args      map[string]json.RawMessage `json:"args"`
			Tolerance float64                    `json:"tolerance"`
			Expect    json.RawMessage            `json:"expect"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &data); err != nil {
		t.Fatal(err)
	}
	if len(data.Cases) < 300 {
		t.Fatalf("only %d cases", len(data.Cases))
	}
	h := New(Config{})
	fields := []string{"open", "high", "low", "close", "volume"}
	for i, c := range data.Cases {
		// Series arguments become bar columns: the ones a kernel reads by field name keep that name, the rest
		// (src, a, b, cond) take a free column.
		var names []string
		for name, v := range c.Args {
			if bytes.HasPrefix(bytes.TrimSpace(v), []byte("[")) {
				names = append(names, name)
			}
		}
		sort.Strings(names)
		columns, inputs, used := map[string]json.RawMessage{}, map[string]string{}, map[string]bool{}
		for _, name := range names {
			if barFields[name] && !used[name] {
				columns[name], inputs[name], used[name] = c.Args[name], name, true
			}
		}
		for _, name := range names {
			if _, done := inputs[name]; done {
				continue
			}
			for _, f := range fields {
				if !used[f] {
					columns[f], inputs[name], used[f] = c.Args[name], f, true
					break
				}
			}
			if _, done := inputs[name]; !done {
				t.Fatalf("case %d (%s): more series than bar columns", i, c.Fn)
			}
		}
		params := map[string]json.RawMessage{}
		if s, ok := byName[c.Fn]; ok {
			for _, p := range s.Params {
				if v, given := c.Args[p.Name]; given {
					params[p.Name] = v
				}
			}
		}
		// Only inputs the kernel declares may be named; the case may carry extra columns (sar with close).
		declared := map[string]string{}
		if s, ok := byName[c.Fn]; ok {
			for _, in := range s.Inputs {
				if source, ok := inputs[in.Name]; ok {
					declared[in.Name] = source
				}
			}
		}
		body, _ := json.Marshal(map[string]any{
			"bars":       columns,
			"indicators": []any{map[string]any{"id": "x", "fn": c.Fn, "inputs": declared, "params": params}},
		})
		status, out := post(t, h, c.Fn, string(body))
		if status != http.StatusOK {
			t.Errorf("case %d (%s): status %d %v", i, c.Fn, status, out["error"])
			continue
		}
		got := out["results"].([]any)[0].(map[string]any)["series"].(map[string]any)

		want := map[string][]*float64{}
		var single []*float64
		if json.Unmarshal(c.Expect, &single) == nil {
			want["value"] = single
		} else if err := json.Unmarshal(c.Expect, &want); err != nil {
			t.Fatal(err)
		}
		if len(got) != len(want) {
			t.Errorf("case %d (%s): %d series, want %d", i, c.Fn, len(got), len(want))
			continue
		}
		for name, series := range want {
			g, _ := got[name].([]any)
			if len(g) != len(series) {
				t.Errorf("case %d (%s %s): %d values, want %d", i, c.Fn, name, len(g), len(series))
				continue
			}
			for k, w := range series {
				v, isNum := g[k].(float64)
				switch {
				case w == nil && g[k] == nil:
				case w == nil || g[k] == nil || !isNum:
					t.Errorf("case %d (%s %s)[%d]: got %v, want %v", i, c.Fn, name, k, g[k], w)
				case math.Abs(v-*w) > c.Tolerance*math.Max(1, math.Abs(*w)):
					t.Errorf("case %d (%s %s)[%d]: got %v, want %v", i, c.Fn, name, k, v, *w)
				}
			}
		}
	}
}

// The refusals are shared with the Python server (conformance/indicators-server.v1.json), so the two cannot drift.
func TestRequestsAreRefusedWithStableCodes(t *testing.T) {
	raw, err := os.ReadFile("../../../conformance/indicators-server.v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var data struct {
		Config struct {
			MaxBars       int   `json:"maxBars"`
			MaxIndicators int   `json:"maxIndicators"`
			MaxBodyBytes  int64 `json:"maxBodyBytes"`
		} `json:"config"`
		Refusals []struct {
			Name   string `json:"name"`
			Body   string `json:"body"`
			Status int    `json:"status"`
			Code   string `json:"code"`
		} `json:"refusals"`
	}
	if err := json.Unmarshal(raw, &data); err != nil {
		t.Fatal(err)
	}
	if len(data.Refusals) < 20 {
		t.Fatalf("only %d refusals", len(data.Refusals))
	}
	h := New(Config{MaxBars: data.Config.MaxBars, MaxIndicators: data.Config.MaxIndicators, MaxBodyBytes: data.Config.MaxBodyBytes})
	for _, c := range data.Refusals {
		status, out := post(t, h, c.Name, c.Body)
		if status != c.Status || errorCode(out) != c.Code {
			t.Errorf("%s: got %d %q, want %d %q (%v)", c.Name, status, errorCode(out), c.Status, c.Code, out["error"])
		}
	}
}

func TestSourcesChainAndNonFiniteBecomesNull(t *testing.T) {
	h := New(Config{})
	// An indicator of an indicator, in both bar formats, gives the same answer.
	columnar := `{"bars":{"close":[1,2,3,4,5,6]},"indicators":[{"id":"m","fn":"macd","params":{"fast":2,"slow":3,"signal":2}},{"id":"s","fn":"sma","inputs":{"src":"m.hist"},"params":{"len":2}}]}`
	rows := `{"bars":[{"close":1},{"close":2},{"close":3},{"close":4},{"close":5},{"close":6}],"indicators":[{"id":"m","fn":"macd","params":{"fast":2,"slow":3,"signal":2}},{"id":"s","fn":"sma","inputs":{"src":"m.hist"},"params":{"len":2}}]}`
	a, ao := post(t, h, "columnar", columnar)
	b, bo := post(t, h, "rows", rows)
	if a != 200 || b != 200 {
		t.Fatalf("status %d %d", a, b)
	}
	aj, _ := json.Marshal(ao)
	bj, _ := json.Marshal(bo)
	if !bytes.Equal(aj, bj) {
		t.Errorf("columnar and row bars disagree:\n%s\n%s", aj, bj)
	}
	// A sum past a double overflows inside the kernel: JSON cannot carry it, so the value is null, not an error.
	status, out := post(t, h, "overflow", `{"bars":{"close":[1e308,1e308,1e308]},"indicators":[{"fn":"sma","params":{"len":2}}]}`)
	if status != http.StatusOK {
		t.Fatalf("overflow: status %d %v", status, out["error"])
	}
	series := out["results"].([]any)[0].(map[string]any)["series"].(map[string]any)["value"].([]any)
	if len(series) != 3 || series[0] != nil || series[1] != nil || series[2] != nil {
		t.Errorf("overflowing averages should be null: %v", series)
	}
}

func TestAuthorization(t *testing.T) {
	h := New(Config{APIKey: "secret"})
	body := `{"bars":{"close":[1,2,3]},"indicators":[{"fn":"sma","params":{"len":2}}]}`
	if status, out := post(t, h, "no key", body); status != 401 || errorCode(out) != "unauthorized" {
		t.Errorf("no key: %d %v", status, out)
	}
	if status, _ := post(t, h, "wrong key", body, "Authorization", "Bearer nope"); status != 401 {
		t.Errorf("wrong key: %d", status)
	}
	if status, _ := post(t, h, "basic scheme", body, "Authorization", "Basic secret"); status != 401 {
		t.Errorf("basic scheme: %d", status)
	}
	if status, _ := post(t, h, "right key", body, "Authorization", "Bearer secret"); status != 200 {
		t.Errorf("right key: %d", status)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if rec.Code != 200 {
		t.Errorf("healthz must stay open: %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/indicators", nil))
	if rec.Code != 401 {
		t.Errorf("the catalog needs the key too: %d", rec.Code)
	}
}
