// Copyright 2026 SUPER SOLUTION LABS INC

// Command chart-relay serves the Super Chart datafeed contract from Aggre market candles.
//
//	chart-relay                 run the relay (configuration: environment, see README.md)
//	chart-relay mint-token ID   print a new client secret and the token-file entry that holds its hash
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Super-Solution/super-chart/hosted/relay/relay"
)

func main() {
	if len(os.Args) == 3 && os.Args[1] == "mint-token" {
		secret, entry, err := relay.MintToken(os.Args[2])
		if err != nil {
			fmt.Fprintln(os.Stderr, "mint-token:", err)
			os.Exit(2)
		}
		fmt.Printf("secret (give to the client once, it is not stored):\n%s\n\ntoken-file entry:\n%s\n", secret, entry)
		return
	}
	if len(os.Args) > 1 {
		fmt.Fprintln(os.Stderr, "usage: chart-relay [mint-token ID]")
		os.Exit(2)
	}
	log := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	if err := run(log); err != nil {
		log.Error("exit", "error", err.Error())
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := relay.LoadConfig(os.Getenv, nil)
	if err != nil {
		return err
	}
	tokens, err := relay.LoadTokens(cfg.TokensFile, nil)
	if err != nil {
		return err
	}
	up, err := relay.NewAggreClient(relay.AggreOptions{
		BaseURL: cfg.AggreBaseURL, APIKey: cfg.AggreAPIKey, Timeout: cfg.UpstreamTimeout,
		Concurrency: cfg.UpstreamParallel, RPS: cfg.UpstreamRPS,
	})
	if err != nil {
		return err
	}
	if len(cfg.Venues) == 0 {
		log.Warn("RELAY_ALLOWED_VENUES is empty: no instrument will be served until venues are allowed")
	}
	catalog := relay.NewCatalog(cfg.Venues, cfg.Products)
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go catalog.Refresh(ctx, up, cfg.CatalogRefresh, 2*time.Second, log)

	svc := &relay.Service{Up: up, MaxCandles: cfg.MaxCandles}
	handler := relay.NewServer(tokens, catalog, svc, relay.NewCache(cfg.CacheBytes, nil), cfg.Origins, log)
	srv := &http.Server{
		Addr: cfg.Addr, Handler: handler,
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second,
		WriteTimeout: 40 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10,
	}
	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()
	log.Info("listening", "addr", cfg.Addr, "tokens_file", cfg.TokensFile, "venues", cfg.Venues)
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdown); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
