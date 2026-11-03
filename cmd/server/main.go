package main

import (
	"context"
	"embed"
	"flag"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"shoppinglist/internal/httpapi"
	"shoppinglist/internal/store"
)

//go:embed all:static
var assets embed.FS

func main() {
	check := flag.Bool("healthcheck", false, "check local readiness and exit")
	flag.Parse()
	if *check {
		client := http.Client{Timeout: 2 * time.Second}
		r, e := client.Get("http://127.0.0.1:8080/health/ready")
		if e != nil {
			os.Exit(1)
		}
		_ = r.Body.Close()
		if r.StatusCode != 200 {
			os.Exit(1)
		}
		return
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	startup, cancel := context.WithTimeout(ctx, 30*time.Second)
	s, e := store.Open(startup)
	cancel()
	if e != nil {
		slog.Error("database startup failed", "error", e)
		os.Exit(1)
	}
	defer s.Close()
	static, e := fs.Sub(assets, "static")
	if e != nil {
		panic(e)
	}
	api := httpapi.New(s, static)
	defer api.Close()
	server := &http.Server{Addr: ":8080", Handler: api.Handler(), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 16}
	shutdownDone := make(chan struct{})
	go func() {
		defer close(shutdownDone)
		<-ctx.Done()
		api.Close()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if e := server.Shutdown(shutdown); e != nil {
			slog.Error("shutdown", "error", e)
		}
	}()
	slog.Info("listening", "address", server.Addr)
	if e = server.ListenAndServe(); e != nil && e != http.ErrServerClosed {
		slog.Error("http server", "error", e)
		os.Exit(1)
	}
	// ListenAndServe returns as shutdown begins; keep the pool open until requests drain.
	<-shutdownDone
}
