package store

import (
	"context"
	"github.com/jackc/pgx/v5"
	"os"
	"shoppinglist/internal/domain"
	"sync"
	"testing"
)

func TestPostgresTransactions(t *testing.T) {
	if os.Getenv("DB_HOST") == "" {
		t.Skip("service test requires isolated PostgreSQL")
	}
	dsn, _ := DatabaseURL()
	conn, ce := pgx.Connect(context.Background(), dsn)
	if ce != nil {
		t.Fatal(ce)
	}
	_, ce = conn.Exec(context.Background(), "CREATE SCHEMA store_test")
	if ce != nil {
		t.Fatal(ce)
	}
	_ = conn.Close(context.Background())
	t.Setenv("DB_SEARCH_PATH", "store_test")
	ctx := context.Background()
	s, err := Open(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	// Startup migration can be repeated without losing existing data.
	other, err := Open(ctx)
	if err != nil {
		t.Fatal(err)
	}
	other.Close()
	state, err := s.State(ctx)
	if err != nil {
		t.Fatal(err)
	}
	op := domain.Operation{ID: domain.ID(), TripID: state.TripID, Kind: "item_add", ItemID: domain.ID(), Name: "Milk", Reusable: true, Counter: true, ShowTags: true, Tags: []string{"A", "B"}}
	r, err := s.Mutate(ctx, op)
	if err != nil || r.Problem != nil {
		t.Fatalf("%+v %v", r, err)
	}
	// A lost successful response must not repeat the write.
	retry, err := s.Mutate(ctx, op)
	if err != nil || !retry.Replay || len(retry.State.Items) != 1 || retry.State.Revision != r.State.Revision {
		t.Fatalf("retry %+v %v", retry, err)
	}
	changed := op
	changed.Name = "Bread"
	bad, err := s.Mutate(ctx, changed)
	if err != nil || bad.Problem == nil || bad.Problem.Code != "operation_reused" {
		t.Fatal(bad, err)
	}
	// Independent fields serialize, then both survive; competing values conflict.
	ops := []domain.Operation{{ID: domain.ID(), TripID: state.TripID, Kind: "trip_set", ItemID: op.ItemID, Field: "count", Base: []byte("0"), Value: []byte("2")}, {ID: domain.ID(), TripID: state.TripID, Kind: "trip_set", ItemID: op.ItemID, Field: "selectedTags", Base: []byte("[]"), Value: []byte(`["A"]`)}}
	var wg sync.WaitGroup
	for _, o := range ops {
		wg.Add(1)
		go func(o domain.Operation) {
			defer wg.Done()
			r, e := s.Mutate(ctx, o)
			if e != nil || r.Problem != nil {
				t.Errorf("merge %+v %v", r, e)
			}
		}(o)
	}
	wg.Wait()
	latest, err := s.State(ctx)
	if err != nil || latest.Items[0].Count != 2 || len(latest.Items[0].SelectedTags) != 1 {
		t.Fatal(latest, err)
	}
	conflict := domain.Operation{ID: domain.ID(), TripID: state.TripID, Kind: "trip_set", ItemID: op.ItemID, Field: "count", Base: []byte("0"), Value: []byte("3")}
	r, err = s.Mutate(ctx, conflict)
	if err != nil || r.Problem == nil || r.Problem.Code != "conflict" {
		t.Fatal(r, err)
	}
	// Two completions of one revision produce exactly one immutable snapshot.
	finish := domain.Operation{ID: domain.ID(), TripID: state.TripID, Kind: "finish", Revision: latest.Revision}
	results := make(chan Outcome, 2)
	for n := 0; n < 2; n++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			o := finish
			o.ID = domain.ID()
			r, e := s.Mutate(ctx, o)
			if e != nil {
				t.Error(e)
			}
			results <- r
		}()
	}
	wg.Wait()
	close(results)
	successes := 0
	for r := range results {
		if r.Problem == nil {
			successes++
		}
	}
	if successes != 1 {
		t.Fatal("non-atomic completion", successes)
	}
	history, err := s.History(ctx)
	if err != nil || len(history) != 1 || history[0].Items[0].Count != 2 {
		t.Fatal(history, err)
	}
	if err = s.pool.QueryRow(ctx, "SELECT id FROM acknowledged_operations WHERE history_id=$1", state.TripID).Scan(&finish.ID); err != nil {
		t.Fatal(err)
	}
	replay, err := s.Mutate(ctx, finish)
	if err != nil || !replay.Replay || replay.History == nil || replay.History.ID != state.TripID || replay.State.TripID == state.TripID {
		t.Fatal("finish retry", replay, err)
	}
	late, err := s.Mutate(ctx, conflict)
	if err != nil || late.Problem == nil || late.Problem.Code != "late_trip" {
		t.Fatal(late, err)
	}
	s.Close()
	s, err = Open(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	persisted, err := s.State(ctx)
	if err != nil || persisted.Items[0].Count != 2 || persisted.TripID == state.TripID {
		t.Fatal(persisted, err)
	}
}

func TestMigrationChecksumMismatchFailsStartup(t *testing.T) {
	if os.Getenv("DB_HOST") == "" {
		t.Skip("requires isolated PostgreSQL")
	}
	ctx := context.Background()
	dsn, _ := DatabaseURL()
	conn, e := pgx.Connect(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	_, e = conn.Exec(ctx, "CREATE SCHEMA checksum_test")
	if e != nil {
		t.Fatal(e)
	}
	_ = conn.Close(ctx)
	t.Setenv("DB_SEARCH_PATH", "checksum_test")
	s, e := Open(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	_, e = s.pool.Exec(ctx, "UPDATE schema_migrations SET checksum='tampered'")
	if e != nil {
		t.Fatal(e)
	}
	bad, e := Open(ctx)
	if e == nil {
		bad.Close()
		t.Fatal("changed migration accepted")
	}
}
