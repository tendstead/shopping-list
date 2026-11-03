package store

import (
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

func TestDatabaseConfiguration(t *testing.T) {
	t.Setenv("DB_HOST", "::1")
	t.Setenv("DB_PORT", "5442")
	t.Setenv("DB_USERNAME", "user@house")
	t.Setenv("DB_NAME", "household")
	t.Setenv("DB_SSL_MODE", "verify-full")
	t.Setenv("DB_SEARCH_PATH", "shopping,public")
	t.Setenv("DB_PASSWORD", "ignored")
	file := filepath.Join(t.TempDir(), "password")
	if e := os.WriteFile(file, []byte("a b#&:/?\n"), 0600); e != nil {
		t.Fatal(e)
	}
	t.Setenv("DB_PASSWORD_FILE", file)
	dsn, e := DatabaseURL()
	if e != nil {
		t.Fatal(e)
	}
	u, e := url.Parse(dsn)
	if e != nil {
		t.Fatal(e)
	}
	pw, _ := u.User.Password()
	if u.Host != "[::1]:5442" || u.User.Username() != "user@house" || pw != "a b#&:/?" || u.Query().Get("search_path") != "shopping,public" || u.Query().Get("sslmode") != "verify-full" {
		t.Fatal("configuration not preserved")
	}
	t.Setenv("DB_PASSWORD_FILE", file+"-missing")
	if _, e := DatabaseURL(); e == nil {
		t.Fatal("missing secret silently ignored")
	}
}
