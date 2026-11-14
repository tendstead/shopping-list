package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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

func TestCategoryAPI(t *testing.T) {
	if os.Getenv("DB_HOST") == "" {
		t.Skip("requires isolated database")
	}
	ctx := context.Background()
	dsn, _ := store.DatabaseURL()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close(ctx) }()
	if _, err = conn.Exec(ctx, "CREATE SCHEMA category_test"); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DB_SEARCH_PATH", "category_test")
	db, err := store.Open(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	api := New(db, fstest.MapFS{"index.html": {Data: []byte("shell")}})
	defer api.Close()
	server := httptest.NewServer(api.Handler())
	defer server.Close()
	state, err := db.State(ctx)
	if err != nil {
		t.Fatal(err)
	}
	send := func(method, path, body string, want int) store.Outcome {
		t.Helper()
		req, _ := http.NewRequest(method, server.URL+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		res, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		defer res.Body.Close()
		var out store.Outcome
		if e = json.NewDecoder(res.Body).Decode(&out); e != nil {
			t.Fatal(e)
		}
		if res.StatusCode != want {
			t.Fatalf("status %d wanted %d: %+v", res.StatusCode, want, out)
		}
		return out
	}
	// An old wire request omits category entirely; its exact retry stays valid.
	old := `{"id":"legacy-add","tripId":"` + state.TripID + `","kind":"item_add","itemId":"cumin","name":"Cumin","reusable":true}`
	send("POST", "/api/items", old, 200)
	// Seed the persisted acknowledgement with a digest of the literal old wire
	// format, independently of the current Operation marshaler.
	legacyHash := sha256.Sum256([]byte(old))
	if _, err = conn.Exec(ctx, "UPDATE category_test.acknowledged_operations SET request_hash=$1 WHERE id='legacy-add'", hex.EncodeToString(legacyHash[:])); err != nil {
		t.Fatal(err)
	}
	if !send("POST", "/api/items", old, 200).Replay {
		t.Fatal("old retry failed")
	}
	edit := domain.Operation{ID: "assign", TripID: state.TripID, Kind: "item_edit", ItemID: "cumin", Field: "category", Base: []byte(`""`), Value: []byte(`"spices"`)}
	encoded, _ := json.Marshal(edit)
	out := send("PATCH", "/api/items/cumin", string(encoded), 200)
	if out.State.Items[0].Category != "spices" {
		t.Fatal("category missing")
	}
	if !send("PATCH", "/api/items/cumin", string(encoded), 200).Replay {
		t.Fatal("edit retry failed")
	}
	persisted, e := db.State(ctx)
	if e != nil || persisted.Items[0].Category != "spices" {
		t.Fatal(persisted, e)
	}
	edit.ID = "stale"
	edit.Value = []byte(`""`)
	encoded, _ = json.Marshal(edit)
	send("PATCH", "/api/items/cumin", string(encoded), 409)
	edit.ID = "invalid"
	edit.Value = []byte(`"invented"`)
	encoded, _ = json.Marshal(edit)
	send("PATCH", "/api/items/cumin", string(encoded), 422)
	if !send("POST", "/api/items", old, 200).Replay {
		t.Fatal("legacy hash changed after category edit")
	}
}
