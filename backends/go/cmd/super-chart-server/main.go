// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 SUPER SOLUTION LABS INC

// Command super-chart-server serves the Super Chart indicators over HTTP.
//
// Environment:
//
//	SUPERCHART_ADDR            listen address (default :8787)
//	SUPERCHART_API_KEY         when set, requests must send "Authorization: Bearer <key>"
//	SUPERCHART_MAX_BARS        longest series accepted (default 100000)
//	SUPERCHART_MAX_INDICATORS  most indicators per request (default 64)
//	SUPERCHART_MAX_BODY_BYTES  largest request body (default 16777216)
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/Super-Solution/super-chart/backends/go/server"
)

func envInt(name string) (int64, error) {
	raw := os.Getenv(name)
	if raw == "" {
		return 0, nil
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer, got %q", name, raw)
	}
	return n, nil
}

func config() (server.Config, error) {
	var cfg server.Config
	cfg.APIKey = os.Getenv("SUPERCHART_API_KEY")
	bars, err := envInt("SUPERCHART_MAX_BARS")
	if err != nil {
		return cfg, err
	}
	inds, err := envInt("SUPERCHART_MAX_INDICATORS")
	if err != nil {
		return cfg, err
	}
	body, err := envInt("SUPERCHART_MAX_BODY_BYTES")
	if err != nil {
		return cfg, err
	}
	cfg.MaxBars, cfg.MaxIndicators, cfg.MaxBodyBytes = int(bars), int(inds), body
	return cfg, nil
}

func main() {
	cfg, err := config()
	if err != nil {
		log.Fatal(err)
	}
	addr := os.Getenv("SUPERCHART_ADDR")
	if addr == "" {
		addr = ":8787"
	}
	srv := &http.Server{
		Addr:              addr,
		Handler:           server.New(cfg),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
	}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-stop
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}()
	if cfg.APIKey == "" {
		log.Print("warning: SUPERCHART_API_KEY is not set; the server accepts any caller")
	}
	log.Printf("super-chart-server listening on %s", addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
