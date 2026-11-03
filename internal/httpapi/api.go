package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"shoppinglist/internal/domain"
	"shoppinglist/internal/store"
)

type Event struct {
	Revision    int64  `json:"revision"`
	OperationID string `json:"operationId"`
}
type API struct {
	store        *store.Store
	static       fs.FS
	mu           sync.Mutex
	clients      map[chan Event]bool
	closed       bool
	scriptPolicy string
}

func New(s *store.Store, static fs.FS) *API {
	policy := "'self'"
	if html, err := fs.ReadFile(static, "index.html"); err == nil {
		scripts := regexp.MustCompile(`(?s)<script(?:\s[^>]*)?>(.*?)</script>`).FindAllSubmatch(html, -1)
		for _, script := range scripts {
			if len(script[1]) == 0 {
				continue
			}
			digest := sha256.Sum256(script[1])
			policy += " 'sha256-" + base64.StdEncoding.EncodeToString(digest[:]) + "'"
		}
	}
	return &API{store: s, static: static, clients: map[chan Event]bool{}, scriptPolicy: policy}
}

func (a *API) Close() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed {
		return
	}
	a.closed = true
	for ch := range a.clients {
		close(ch)
		delete(a.clients, ch)
	}
}
func (a *API) subscribe() (<-chan Event, func()) {
	a.mu.Lock()
	defer a.mu.Unlock()
	ch := make(chan Event, 4)
	if a.closed {
		close(ch)
	} else {
		a.clients[ch] = true
	}
	return ch, func() {
		a.mu.Lock()
		defer a.mu.Unlock()
		if a.clients[ch] {
			delete(a.clients, ch)
			close(ch)
		}
	}
}
func (a *API) publish(e Event) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for ch := range a.clients {
		select {
		case ch <- e:
		default:
		}
	}
}
func write(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if e := json.NewEncoder(w).Encode(v); e != nil {
		slog.Debug("response closed", "error", e)
	}
}
func fail(w http.ResponseWriter, status int, code, msg string) {
	write(w, status, map[string]any{"problem": domain.Problem{Code: code, Message: msg}})
}
func (a *API) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health/live", func(w http.ResponseWriter, _ *http.Request) { write(w, 200, map[string]bool{"ok": true}) })
	mux.HandleFunc("GET /health/ready", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if a.store.Ping(ctx) != nil {
			fail(w, 503, "database", "Database unavailable")
			return
		}
		write(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /api/state", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		s, e := a.store.State(ctx)
		if e != nil {
			a.internal(w, e)
			return
		}
		write(w, 200, s)
	})
	mux.HandleFunc("GET /api/history", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		h, e := a.store.History(ctx)
		if e != nil {
			a.internal(w, e)
			return
		}
		write(w, 200, h)
	})
	mux.HandleFunc("GET /api/history/{id}", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		h, e := a.store.HistoryByID(ctx, r.PathValue("id"))
		if e == pgx.ErrNoRows {
			fail(w, 404, "missing", "Trip not found")
			return
		}
		if e != nil {
			a.internal(w, e)
			return
		}
		write(w, 200, h)
	})
	for _, route := range []string{"POST /api/operations", "POST /api/items", "PATCH /api/items/{id}", "DELETE /api/items/{id}", "POST /api/layouts", "PATCH /api/layouts/{id}", "DELETE /api/layouts/{id}", "POST /api/finish"} {
		mux.HandleFunc(route, a.mutate)
	}
	mux.HandleFunc("GET /api/events", a.events)
	mux.HandleFunc("/api/", func(w http.ResponseWriter, _ *http.Request) { fail(w, 404, "missing", "Unknown API route") })
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && r.Method != "HEAD" {
			w.WriteHeader(405)
			return
		}
		a.shell(w, r)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src "+a.scriptPolicy+"; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'")
		mux.ServeHTTP(w, r)
	})
}
func (a *API) internal(w http.ResponseWriter, e error) {
	slog.Error("request failed", "error", e)
	fail(w, 503, "unavailable", "Could not save. Your changes can be retried")
}
func (a *API) mutate(w http.ResponseWriter, r *http.Request) {
	if origin := r.Header.Get("Origin"); origin != "" {
		u, e := url.Parse(origin)
		if e != nil || u.Host != r.Host {
			fail(w, 403, "origin", "Cross-origin writes are disabled")
			return
		}
	}
	media, _, e := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if e != nil || media != "application/json" {
		fail(w, 415, "content_type", "Use application/json")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var op domain.Operation
	if e = decoder.Decode(&op); e != nil {
		fail(w, 400, "invalid", "Invalid operation JSON")
		return
	}
	var trailing any
	if decoder.Decode(&trailing) != io.EOF {
		fail(w, 400, "invalid", "Only one JSON operation is allowed")
		return
	}
	allowed := false
	switch {
	case r.URL.Path == "/api/operations":
		allowed = op.Kind == "trip_set" || op.Kind == "layout_order" || op.Kind == "item_add" && !op.Reusable
	case r.URL.Path == "/api/finish":
		allowed = op.Kind == "finish"
	case r.URL.Path == "/api/items" && r.Method == "POST":
		allowed = op.Kind == "item_add"
	case strings.HasPrefix(r.URL.Path, "/api/items/"):
		allowed = op.ItemID == r.PathValue("id") && (r.Method == "PATCH" && op.Kind == "item_edit" || r.Method == "DELETE" && op.Kind == "item_delete")
	case r.URL.Path == "/api/layouts" && r.Method == "POST":
		allowed = op.Kind == "layout_add"
	case strings.HasPrefix(r.URL.Path, "/api/layouts/"):
		allowed = op.LayoutID == r.PathValue("id") && (r.Method == "PATCH" && op.Kind == "layout_rename" || r.Method == "DELETE" && op.Kind == "layout_delete")
	}
	if !allowed {
		fail(w, 400, "invalid", "Operation does not match this REST route")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	out, e := a.store.Mutate(ctx, op)
	if e != nil {
		a.internal(w, e)
		return
	}
	if out.Problem != nil {
		status := 409
		if out.Problem.Code == "invalid" || out.Problem.Code == "invalid_controls" {
			status = 422
		}
		write(w, status, out)
		return
	}
	if !out.Replay {
		a.publish(Event{Revision: out.State.Revision, OperationID: op.ID})
	}
	write(w, 200, out)
}
func (a *API) events(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		fail(w, 500, "stream", "Streaming unavailable")
		return
	}
	events, cancel := a.subscribe()
	defer cancel()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Accel-Buffering", "no")
	if _, e := fmt.Fprint(w, "event: ready\ndata: {}\n\n"); e != nil {
		return
	}
	flusher.Flush()
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case e, open := <-events:
			if !open {
				return
			}
			b, _ := json.Marshal(e)
			_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(5 * time.Second))
			if _, err := fmt.Fprintf(w, "event: change\ndata: %s\n\n", b); err != nil {
				return
			}
			flusher.Flush()
			_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
		case <-ticker.C:
			_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(5 * time.Second))
			if _, e := fmt.Fprint(w, ": heartbeat\n\n"); e != nil {
				return
			}
			flusher.Flush()
			_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
		}
	}
}
func (a *API) shell(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if name == "" || name == "." {
		name = "index.html"
	}
	b, e := fs.ReadFile(a.static, name)
	if e != nil {
		if path.Ext(name) != "" {
			http.NotFound(w, r)
			return
		}
		name = "index.html"
		b, e = fs.ReadFile(a.static, name)
	}
	if e != nil {
		http.Error(w, "Application shell unavailable", http.StatusServiceUnavailable)
		return
	}
	if strings.HasPrefix(name, "_app/immutable/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	w.Header().Set("Content-Type", mime.TypeByExtension(path.Ext(name)))
	_, _ = w.Write(b)
}
