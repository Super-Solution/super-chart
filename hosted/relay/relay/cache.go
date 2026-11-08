// Copyright 2026 SUPER SOLUTION LABS INC

package relay

import (
	"container/list"
	"context"
	"sync"
	"time"
)

// CacheEntry is a finished response body.
type CacheEntry struct {
	Body      []byte
	Immutable bool
}

type cacheItem struct {
	key     string
	entry   CacheEntry
	expires time.Time
}

// Cache is a size-bounded LRU with a time to live per entry.
type Cache struct {
	mu       sync.Mutex
	ll       *list.List
	items    map[string]*list.Element
	bytes    int
	maxBytes int
	now      func() time.Time
}

func NewCache(maxBytes int, now func() time.Time) *Cache {
	if now == nil {
		now = time.Now
	}
	return &Cache{ll: list.New(), items: map[string]*list.Element{}, maxBytes: maxBytes, now: now}
}

func (c *Cache) Get(key string) (CacheEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	el, ok := c.items[key]
	if !ok {
		return CacheEntry{}, false
	}
	it := el.Value.(*cacheItem)
	if !c.now().Before(it.expires) {
		c.remove(el)
		return CacheEntry{}, false
	}
	c.ll.MoveToFront(el)
	return it.entry, true
}

func (c *Cache) Set(key string, e CacheEntry, ttl time.Duration) {
	size := len(e.Body) + len(key)
	if c.maxBytes <= 0 || size > c.maxBytes/4 || ttl <= 0 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.items[key]; ok {
		c.remove(el)
	}
	c.items[key] = c.ll.PushFront(&cacheItem{key: key, entry: e, expires: c.now().Add(ttl)})
	c.bytes += size
	for c.bytes > c.maxBytes {
		back := c.ll.Back()
		if back == nil {
			break
		}
		c.remove(back)
	}
}

func (c *Cache) remove(el *list.Element) {
	it := el.Value.(*cacheItem)
	c.ll.Remove(el)
	delete(c.items, it.key)
	c.bytes -= len(it.entry.Body) + len(it.key)
}

// Len and Bytes are for tests and metrics.
func (c *Cache) Len() int   { c.mu.Lock(); defer c.mu.Unlock(); return len(c.items) }
func (c *Cache) Bytes() int { c.mu.Lock(); defer c.mu.Unlock(); return c.bytes }

// flights collapses concurrent identical work into one call. The work runs detached from any one
// caller, so a caller that goes away does not fail the others.
type flights struct {
	mu    sync.Mutex
	calls map[string]*flight
}

type flight struct {
	done chan struct{}
	val  CacheEntry
	err  error
}

func newFlights() *flights { return &flights{calls: map[string]*flight{}} }

func (f *flights) Do(ctx context.Context, key string, fn func() (CacheEntry, error)) (CacheEntry, error) {
	f.mu.Lock()
	call, ok := f.calls[key]
	if !ok {
		call = &flight{done: make(chan struct{})}
		f.calls[key] = call
		go func() {
			defer func() {
				if r := recover(); r != nil {
					call.err = errInternal
				}
				f.mu.Lock()
				delete(f.calls, key)
				f.mu.Unlock()
				close(call.done)
			}()
			call.val, call.err = fn()
		}()
	}
	f.mu.Unlock()
	select {
	case <-call.done:
		return call.val, call.err
	case <-ctx.Done():
		return CacheEntry{}, ctx.Err()
	}
}
