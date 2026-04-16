package auth

import (
	"database/sql"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
)

func openTestDB(t *testing.T) *sql.DB {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	d, err := sql.Open("postgres", url)
	if err != nil {
		t.Fatal(err)
	}
	if err := d.Ping(); err != nil {
		t.Fatal(err)
	}
	return d
}

func TestRefresh_IssueAndValidate(t *testing.T) {
	d := openTestDB(t)
	t.Cleanup(func() { d.Close() })

	// seed user
	uid := uuid.New()
	if _, err := d.Exec(`INSERT INTO users(id,google_sub,email,name) VALUES($1,$2,$3,$4)`,
		uid, "sub-"+uid.String(), "a@b", "A"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Exec(`DELETE FROM users WHERE id=$1`, uid) })

	raw, err := IssueRefreshToken(d, uid, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if raw == "" {
		t.Fatal("empty raw")
	}

	gotUID, err := ValidateRefreshToken(d, raw)
	if err != nil {
		t.Fatal(err)
	}
	if gotUID != uid {
		t.Fatalf("uid mismatch")
	}

	// rotate
	newRaw, err := RotateRefreshToken(d, raw, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ValidateRefreshToken(d, raw); err == nil {
		t.Fatal("old token should be revoked")
	}
	if _, err := ValidateRefreshToken(d, newRaw); err != nil {
		t.Fatalf("new token invalid: %v", err)
	}
}
