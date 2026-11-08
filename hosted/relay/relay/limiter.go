// Copyright 2026 SUPER SOLUTION LABS INC

package relay

import (
	"context"
	"math"
	"sync"
	"time"
)

// Bucket is a token bucket: rate tokens a second, up to burst at once.
type Bucket struct {
	mu     sync.Mutex
	rate   float64
	burst  float64
	tokens float64
	last   time.Time
	now    func() time.Time
}

func NewBucket(rate float64, burst int, now func() time.Time) *Bucket {
	if now == nil {
		now = time.Now
	}
	if burst < 1 {
		burst = 1
	}
	return &Bucket{rate: rate, burst: float64(burst), tokens: float64(burst), last: now(), now: now}
}

func (b *Bucket) refill() {
	t := b.now()
	if dt := t.Sub(b.last).Seconds(); dt > 0 {
		b.tokens = math.Min(b.burst, b.tokens+dt*b.rate)
		b.last = t
	}
}

// Take spends one token. When none is left it reports how long until one is.
func (b *Bucket) Take() (bool, time.Duration) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.refill()
	if b.tokens >= 1 {
		b.tokens--
		return true, 0
	}
	if b.rate <= 0 {
		return false, time.Hour
	}
	return false, time.Duration((1 - b.tokens) / b.rate * float64(time.Second))
}

// Wait blocks until a token is available or ctx ends.
func (b *Bucket) Wait(ctx context.Context) error {
	for {
		ok, d := b.Take()
		if ok {
			return nil
		}
		t := time.NewTimer(d)
		select {
		case <-ctx.Done():
			t.Stop()
			return ctx.Err()
		case <-t.C:
		}
	}
}
