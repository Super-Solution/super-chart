// Copyright 2026 SUPER SOLUTION LABS INC

package relay

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config is read from the environment (see ../README.md).
type Config struct {
	Addr             string
	AggreBaseURL     string
	AggreAPIKey      string
	TokensFile       string
	Venues           []string
	Products         []string
	Origins          []string
	UpstreamTimeout  time.Duration
	UpstreamParallel int
	UpstreamRPS      float64
	CatalogRefresh   time.Duration
	CacheBytes       int
	MaxCandles       int
}

func splitList(s string) []string {
	var out []string
	for _, v := range strings.Split(s, ",") {
		if v = strings.TrimSpace(v); v != "" {
			out = append(out, v)
		}
	}
	return out
}

// LoadConfig reads the configuration. getenv and readFile are injected for tests.
func LoadConfig(getenv func(string) string, readFile func(string) ([]byte, error)) (Config, error) {
	if readFile == nil {
		readFile = os.ReadFile
	}
	c := Config{
		Addr:             orDefault(getenv("RELAY_ADDR"), ":8080"),
		AggreBaseURL:     getenv("RELAY_AGGRE_BASE_URL"),
		AggreAPIKey:      strings.TrimSpace(getenv("RELAY_AGGRE_API_KEY")),
		TokensFile:       getenv("RELAY_TOKENS_FILE"),
		Venues:           splitList(getenv("RELAY_ALLOWED_VENUES")),
		Products:         splitList(orDefault(getenv("RELAY_ALLOWED_PRODUCTS"), "SPOT,PERP,FUTURES")),
		Origins:          splitList(getenv("RELAY_ALLOWED_ORIGINS")),
		UpstreamTimeout:  10 * time.Second,
		UpstreamParallel: 8,
		UpstreamRPS:      20,
		CatalogRefresh:   10 * time.Minute,
		CacheBytes:       64 << 20,
		MaxCandles:       DefaultMaxCandles,
	}
	if file := getenv("RELAY_AGGRE_API_KEY_FILE"); file != "" {
		if c.AggreAPIKey != "" {
			return c, fmt.Errorf("set RELAY_AGGRE_API_KEY or RELAY_AGGRE_API_KEY_FILE, not both")
		}
		raw, err := readFile(file)
		if err != nil {
			return c, fmt.Errorf("RELAY_AGGRE_API_KEY_FILE: %w", err)
		}
		c.AggreAPIKey = strings.TrimSpace(string(raw))
	}
	var err error
	if v := getenv("RELAY_UPSTREAM_TIMEOUT"); v != "" {
		if c.UpstreamTimeout, err = time.ParseDuration(v); err != nil || c.UpstreamTimeout <= 0 {
			return c, fmt.Errorf("RELAY_UPSTREAM_TIMEOUT must be a positive duration such as 10s")
		}
	}
	if v := getenv("RELAY_CATALOG_REFRESH"); v != "" {
		if c.CatalogRefresh, err = time.ParseDuration(v); err != nil || c.CatalogRefresh < time.Minute {
			return c, fmt.Errorf("RELAY_CATALOG_REFRESH must be a duration of at least 1m")
		}
	}
	if c.UpstreamParallel, err = intEnv(getenv, "RELAY_UPSTREAM_CONCURRENCY", c.UpstreamParallel, 1, 256); err != nil {
		return c, err
	}
	if c.CacheBytes, err = intEnv(getenv, "RELAY_CACHE_BYTES", c.CacheBytes, 1<<20, 4<<30); err != nil {
		return c, err
	}
	if c.MaxCandles, err = intEnv(getenv, "RELAY_MAX_CANDLES", c.MaxCandles, MaxPage, 200_000); err != nil {
		return c, err
	}
	if v := getenv("RELAY_UPSTREAM_RPS"); v != "" {
		if c.UpstreamRPS, err = strconv.ParseFloat(v, 64); err != nil || c.UpstreamRPS <= 0 || c.UpstreamRPS > 1000 {
			return c, fmt.Errorf("RELAY_UPSTREAM_RPS must be a number from 0 to 1000")
		}
	}
	switch {
	case c.AggreBaseURL == "":
		return c, fmt.Errorf("RELAY_AGGRE_BASE_URL is required")
	case c.AggreAPIKey == "":
		return c, fmt.Errorf("RELAY_AGGRE_API_KEY (or _FILE) is required")
	case c.TokensFile == "":
		return c, fmt.Errorf("RELAY_TOKENS_FILE is required")
	}
	for _, o := range c.Origins {
		if o == "*" || !(strings.HasPrefix(o, "https://") || strings.HasPrefix(o, "http://localhost") || strings.HasPrefix(o, "http://127.0.0.1")) || strings.HasSuffix(o, "/") {
			return c, fmt.Errorf("RELAY_ALLOWED_ORIGINS: %q must be an exact origin such as https://chart.example.com", o)
		}
	}
	return c, nil
}

func orDefault(v, d string) string {
	if v == "" {
		return d
	}
	return v
}

func intEnv(getenv func(string) string, name string, def, lo, hi int) (int, error) {
	v := getenv(name)
	if v == "" {
		return def, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < lo || n > hi {
		return 0, fmt.Errorf("%s must be an integer from %d to %d", name, lo, hi)
	}
	return n, nil
}
