// Copyright 2026 SUPER SOLUTION LABS INC

package relay

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"
)

// Token is one client of the relay. Only the SHA-256 of its secret is stored.
type Token struct {
	ID       string
	Venues   map[string]bool // empty: every venue the relay serves
	Products map[string]bool // empty: every product the relay serves
	Expires  time.Time       // zero: never
	bucket   *Bucket
}

// Allows reports whether the token may read the instrument.
func (t *Token) Allows(venue, product string) bool {
	return (len(t.Venues) == 0 || t.Venues[venue]) && (len(t.Products) == 0 || t.Products[product])
}

type tokenFile struct {
	Tokens []struct {
		ID       string   `json:"id"`
		SHA256   string   `json:"sha256"`
		RPS      float64  `json:"rps"`
		Burst    int      `json:"burst"`
		Venues   []string `json:"venues"`
		Products []string `json:"products"`
		Expires  string   `json:"expires"`
	} `json:"tokens"`
}

var (
	idPattern   = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)
	hashPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

const (
	defaultRPS   = 5.0
	defaultBurst = 20
	tokenPrefix  = "scr_"
	maxTokenLen  = 128
)

var (
	errNoCredentials = errors.New("no credentials")
	errBadToken      = errors.New("unknown or expired token")
)

// TokenStore authenticates bearer tokens.
type TokenStore struct {
	byHash map[string]*Token
	now    func() time.Time
}

// LoadTokens reads the token file. Unknown fields, duplicates and malformed entries are errors, so a typo
// cannot silently widen or drop access.
func LoadTokens(path string, now func() time.Time) (*TokenStore, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return ParseTokens(raw, now)
}

func ParseTokens(raw []byte, now func() time.Time) (*TokenStore, error) {
	if now == nil {
		now = time.Now
	}
	var f tokenFile
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&f); err != nil {
		return nil, fmt.Errorf("token file: %w", err)
	}
	if len(f.Tokens) == 0 {
		return nil, errors.New("token file: no tokens")
	}
	s := &TokenStore{byHash: map[string]*Token{}, now: now}
	ids := map[string]bool{}
	for i, e := range f.Tokens {
		if !idPattern.MatchString(e.ID) {
			return nil, fmt.Errorf("token file: entry %d: id must match %s", i, idPattern)
		}
		if ids[e.ID] {
			return nil, fmt.Errorf("token file: duplicate id %q", e.ID)
		}
		ids[e.ID] = true
		h := strings.ToLower(e.SHA256)
		if !hashPattern.MatchString(h) {
			return nil, fmt.Errorf("token file: %q: sha256 must be 64 hex characters", e.ID)
		}
		if _, dup := s.byHash[h]; dup {
			return nil, fmt.Errorf("token file: %q: duplicate sha256", e.ID)
		}
		rps, burst := e.RPS, e.Burst
		if rps == 0 {
			rps = defaultRPS
		}
		if burst == 0 {
			burst = defaultBurst
		}
		if rps < 0 || rps > 1000 || burst < 0 || burst > 10000 {
			return nil, fmt.Errorf("token file: %q: rps or burst out of range", e.ID)
		}
		t := &Token{ID: e.ID, Venues: upperSet(e.Venues), Products: upperSet(e.Products), bucket: NewBucket(rps, burst, now)}
		if e.Expires != "" {
			ex, err := time.Parse(time.RFC3339, e.Expires)
			if err != nil {
				return nil, fmt.Errorf("token file: %q: expires must be RFC 3339", e.ID)
			}
			t.Expires = ex
		}
		s.byHash[h] = t
	}
	return s, nil
}

func upperSet(in []string) map[string]bool {
	m := map[string]bool{}
	for _, v := range in {
		if v = strings.ToUpper(strings.TrimSpace(v)); v != "" {
			m[v] = true
		}
	}
	return m
}

// Authenticate reads "Authorization: Bearer <token>".
func (s *TokenStore) Authenticate(header string) (*Token, error) {
	scheme, secret, ok := strings.Cut(strings.TrimSpace(header), " ")
	if header == "" || !ok || !strings.EqualFold(scheme, "Bearer") {
		return nil, errNoCredentials
	}
	secret = strings.TrimSpace(secret)
	if secret == "" || len(secret) > maxTokenLen {
		return nil, errBadToken
	}
	sum := sha256.Sum256([]byte(secret))
	t, ok := s.byHash[hex.EncodeToString(sum[:])]
	if !ok || (!t.Expires.IsZero() && !s.now().Before(t.Expires)) {
		return nil, errBadToken
	}
	return t, nil
}

// MintToken makes a new secret and the token-file entry that holds its hash.
func MintToken(id string) (secret, entry string, err error) {
	if !idPattern.MatchString(id) {
		return "", "", fmt.Errorf("id must match %s", idPattern)
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", "", err
	}
	secret = tokenPrefix + base64.RawURLEncoding.EncodeToString(b)
	sum := sha256.Sum256([]byte(secret))
	entry = fmt.Sprintf(`{ "id": %q, "sha256": %q, "rps": %v, "burst": %d }`, id, hex.EncodeToString(sum[:]), defaultRPS, defaultBurst)
	return secret, entry, nil
}
