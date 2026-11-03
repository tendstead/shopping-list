package httpapi

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"net/http"
	"net/http/httptest"
	"os"
	"shoppinglist/internal/domain"
	"shoppinglist/internal/store"
	"strings"
	"testing"
	"testing/fstest"
)

func TestHTTPContract(t *testing.T) {
	if os.Getenv("DB_HOST") == "" {
		t.Skip("requires isolated database")
	}
	dsn, _ := store.DatabaseURL()
	conn, ce := pgx.Connect(context.Background(), dsn)
	if ce != nil {
		t.Fatal(ce)
	}
	_, ce = conn.Exec(context.Background(), "CREATE SCHEMA httpapi_test")
	if ce != nil {
		t.Fatal(ce)
	}
	_ = conn.Close(context.Background())
	t.Setenv("DB_SEARCH_PATH", "httpapi_test")
	s, e := store.Open(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	api := New(s, fstest.MapFS{"index.html": {Data: []byte("APP SHELL")}})
	defer api.Close()
	server := httptest.NewServer(api.Handler())
	defer server.Close()
	res, e := http.Get(server.URL + "/api/state")
	if e != nil {
		t.Fatal(e)
	}
	var state domain.State
	_ = json.NewDecoder(res.Body).Decode(&state)
	_ = res.Body.Close()
	if state.TripID == "" {
		t.Fatal("missing trip")
	}
	op := domain.Operation{ID: domain.ID(), TripID: state.TripID, Kind: "item_add", ItemID: domain.ID(), Name: "API bananas", Reusable: true}
	b, _ := json.Marshal(op)
	req, _ := http.NewRequest("POST", server.URL+"/api/items", strings.NewReader(string(b)))
	req.Header.Set("Content-Type", "application/json")
	res, e = http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	_ = res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode)
	}
	req, _ = http.NewRequest("POST", server.URL+"/api/items", strings.NewReader(string(b)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://evil.example")
	res, e = http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	_ = res.Body.Close()
	if res.StatusCode != 403 {
		t.Fatal("cross origin write accepted")
	}
	req, _ = http.NewRequest("POST", server.URL+"/api/operations", strings.NewReader(string(b)))
	req.Header.Set("Content-Type", "application/json")
	res, e = http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	_ = res.Body.Close()
	if res.StatusCode != 400 {
		t.Fatal("checklist write on offline operation route accepted")
	}
	for path, want := range map[string]int{"/health/live": 200, "/health/ready": 200, "/api/missing": 404, "/any/spa/route": 200} {
		res, e = http.Get(server.URL + path)
		if e != nil {
			t.Fatal(e)
		}
		_ = res.Body.Close()
		if res.StatusCode != want {
			t.Fatalf("%s got %d", path, res.StatusCode)
		}
	}
	req, _ = http.NewRequest("POST", server.URL+"/api/items", strings.NewReader(string(b)+" garbage"))
	req.Header.Set("Content-Type", "application/json")
	res, e = http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	_ = res.Body.Close()
	if res.StatusCode != 400 {
		t.Fatal("trailing malformed JSON accepted", res.StatusCode)
	}
	// A committed mutation produces an SSE signal; a rejected mutation cannot.
	ch, cancel := api.subscribe()
	defer cancel()
	op.ID = domain.ID()
	op.ItemID = domain.ID()
	op.Name = "API apples"
	b, _ = json.Marshal(op)
	req, _ = http.NewRequest("POST", server.URL+"/api/items", strings.NewReader(string(b)))
	req.Header.Set("Content-Type", "application/json")
	res, e = http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	_ = res.Body.Close()
	select {
	case event := <-ch:
		if event.OperationID != op.ID {
			t.Fatal(event)
		}
	default:
		t.Fatal("no post-commit notification")
	}
	// Identical acknowledged retries and rejected duplicate names emit no new event.
	for attempt := 0; attempt < 2; attempt++ {
		if attempt == 1 {
			op.ID = domain.ID()
			op.ItemID = domain.ID()
			b, _ = json.Marshal(op)
		}
		req, _ = http.NewRequest("POST", server.URL+"/api/items", strings.NewReader(string(b)))
		req.Header.Set("Content-Type", "application/json")
		res, e = http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		_ = res.Body.Close()
		want := 200
		if attempt == 1 {
			want = 409
		}
		if res.StatusCode != want {
			t.Fatal(res.StatusCode)
		}
		select {
		case <-ch:
			t.Fatal("notification without a new commit")
		default:
		}
	}

}
