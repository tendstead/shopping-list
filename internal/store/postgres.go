package store

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"shoppinglist/internal/domain"
)

//go:embed migrations/*.sql
var migrations embed.FS

type Store struct{ pool *pgxpool.Pool }
type Outcome struct {
	State   domain.State    `json:"state"`
	History *domain.History `json:"history,omitempty"`
	Problem *domain.Problem `json:"problem,omitempty"`
	Replay  bool            `json:"replay,omitempty"`
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
func DatabaseURL() (string, error) {
	password := os.Getenv("DB_PASSWORD")
	if file := os.Getenv("DB_PASSWORD_FILE"); file != "" {
		b, e := os.ReadFile(file)
		if e != nil {
			return "", fmt.Errorf("read DB_PASSWORD_FILE: %w", e)
		}
		password = strings.TrimRight(string(b), "\r\n")
	}
	u := url.URL{Scheme: "postgres", Host: net.JoinHostPort(env("DB_HOST", "localhost"), env("DB_PORT", "5432")), Path: "/" + env("DB_NAME", "shopping"), User: url.UserPassword(env("DB_USERNAME", "shopping"), password)}
	q := url.Values{"sslmode": {env("DB_SSL_MODE", "disable")}}
	if path := os.Getenv("DB_SEARCH_PATH"); path != "" {
		q.Set("search_path", path)
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}
func Open(ctx context.Context) (*Store, error) {
	dsn, e := DatabaseURL()
	if e != nil {
		return nil, e
	}
	config, e := pgxpool.ParseConfig(dsn)
	if e != nil {
		return nil, fmt.Errorf("invalid database configuration")
	}
	config.MaxConns = 4
	config.MinConns = 0
	config.MaxConnIdleTime = 5 * time.Minute
	config.ConnConfig.ConnectTimeout = 5 * time.Second
	pool, e := pgxpool.NewWithConfig(ctx, config)
	if e != nil {
		return nil, e
	}
	s := &Store{pool: pool}
	if e = s.migrate(ctx); e != nil {
		pool.Close()
		return nil, e
	}
	return s, nil
}
func (s *Store) Close()                         { s.pool.Close() }
func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }
func (s *Store) migrate(ctx context.Context) error {
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(539024786)"); e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`); e != nil {
		return e
	}
	files, e := migrations.ReadDir("migrations")
	if e != nil {
		return e
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Name() < files[j].Name() })
	for _, f := range files {
		if f.IsDir() {
			continue
		}
		b, e := migrations.ReadFile("migrations/" + f.Name())
		if e != nil {
			return e
		}
		digest := sha256.Sum256(b)
		checksum := hex.EncodeToString(digest[:])
		var old string
		e = tx.QueryRow(ctx, "SELECT checksum FROM schema_migrations WHERE version=$1", f.Name()).Scan(&old)
		if e == nil {
			if old != checksum {
				return fmt.Errorf("migration %s changed after application", f.Name())
			}
			continue
		}
		if e != pgx.ErrNoRows {
			return e
		}
		if _, e = tx.Exec(ctx, string(b)); e != nil {
			return fmt.Errorf("migration %s: %w", f.Name(), e)
		}
		if _, e = tx.Exec(ctx, "INSERT INTO schema_migrations(version,checksum) VALUES ($1,$2)", f.Name(), checksum); e != nil {
			return e
		}
	}
	initial, e := json.Marshal(domain.New())
	if e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, "INSERT INTO shared_state(body) VALUES ($1) ON CONFLICT DO NOTHING", initial); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (s *Store) State(ctx context.Context) (domain.State, error) {
	var state domain.State
	var b []byte
	e := s.pool.QueryRow(ctx, "SELECT body FROM shared_state WHERE singleton").Scan(&b)
	if e != nil {
		return state, e
	}
	e = json.Unmarshal(b, &state)
	return state, e
}
func (s *Store) History(ctx context.Context) ([]domain.History, error) {
	rows, e := s.pool.Query(ctx, "SELECT snapshot FROM trip_history ORDER BY completed_at DESC, id DESC")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []domain.History{}
	for rows.Next() {
		var b []byte
		var h domain.History
		if e = rows.Scan(&b); e != nil {
			return nil, e
		}
		if e = json.Unmarshal(b, &h); e != nil {
			return nil, e
		}
		out = append(out, h)
	}
	return out, rows.Err()
}
func (s *Store) HistoryByID(ctx context.Context, id string) (domain.History, error) {
	var h domain.History
	var b []byte
	e := s.pool.QueryRow(ctx, "SELECT snapshot FROM trip_history WHERE id=$1", id).Scan(&b)
	if e != nil {
		return h, e
	}
	e = json.Unmarshal(b, &h)
	return h, e
}
func (s *Store) Mutate(ctx context.Context, op domain.Operation) (Outcome, error) {
	out := Outcome{}
	if op.ID == "" || len(op.ID) > 80 {
		out.Problem = &domain.Problem{Code: "invalid", Message: "Supply a unique operation id"}
		return out, nil
	}
	request, e := json.Marshal(op)
	if e != nil {
		return out, e
	}
	digest := sha256.Sum256(request)
	hash := hex.EncodeToString(digest[:])
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return out, e
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var b []byte
	if e = tx.QueryRow(ctx, "SELECT body FROM shared_state WHERE singleton FOR UPDATE").Scan(&b); e != nil {
		return out, e
	}
	if e = json.Unmarshal(b, &out.State); e != nil {
		return out, e
	}
	var saved string
	var historyID *string
	e = tx.QueryRow(ctx, "SELECT request_hash, history_id FROM acknowledged_operations WHERE id=$1", op.ID).Scan(&saved, &historyID)
	if e == nil {
		if saved != hash {
			out.Problem = &domain.Problem{Code: "operation_reused", Message: "This operation id already acknowledged a different request"}
			return out, nil
		}
		out.Replay = true
		if historyID != nil {
			var h domain.History
			if e = tx.QueryRow(ctx, "SELECT snapshot FROM trip_history WHERE id=$1", *historyID).Scan(&b); e != nil {
				return out, e
			}
			if e = json.Unmarshal(b, &h); e != nil {
				return out, e
			}
			out.History = &h
		}
		return out, nil
	}
	if e != pgx.ErrNoRows {
		return out, e
	}
	if op.Kind == "finish" {
		if op.TripID != out.State.TripID {
			out.Problem = &domain.Problem{Code: "late_trip", Message: "This trip already finished"}
			return out, nil
		}
		h, p := out.State.Finish(op.Revision, time.Now())
		if p != nil {
			out.Problem = p
			return out, nil
		}
		out.History = &h
		historyID = &h.ID
		hb, e := json.Marshal(h)
		if e != nil {
			return out, e
		}
		if _, e = tx.Exec(ctx, "INSERT INTO trip_history(id,completed_at,snapshot) VALUES ($1,$2,$3)", h.ID, h.CompletedAt, hb); e != nil {
			return out, e
		}
	} else if p := out.State.Apply(op, time.Now()); p != nil {
		out.Problem = p
		return out, nil
	}
	b, e = json.Marshal(out.State)
	if e != nil {
		return out, e
	}
	if _, e = tx.Exec(ctx, "UPDATE shared_state SET body=$1 WHERE singleton", b); e != nil {
		return out, e
	}
	if _, e = tx.Exec(ctx, "INSERT INTO acknowledged_operations(id,request_hash,history_id) VALUES ($1,$2,$3)", op.ID, hash, historyID); e != nil {
		return out, e
	}
	if e = tx.Commit(ctx); e != nil {
		return Outcome{}, e
	}
	return out, nil
}
