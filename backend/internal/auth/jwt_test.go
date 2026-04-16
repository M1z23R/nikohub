package auth

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestJWT_RoundTrip(t *testing.T) {
	secret := []byte("test-secret-1234567890abcdef")
	uid := uuid.New()
	tok, err := IssueAccessToken(secret, uid, 15*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	got, err := ParseAccessToken(secret, tok)
	if err != nil {
		t.Fatal(err)
	}
	if got != uid {
		t.Fatalf("uid mismatch: %s vs %s", got, uid)
	}
}

func TestJWT_Expired(t *testing.T) {
	secret := []byte("s")
	uid := uuid.New()
	tok, _ := IssueAccessToken(secret, uid, -time.Minute)
	if _, err := ParseAccessToken(secret, tok); err == nil {
		t.Fatal("expected expired error")
	}
}

func TestJWT_WrongSecret(t *testing.T) {
	uid := uuid.New()
	tok, _ := IssueAccessToken([]byte("a"), uid, time.Minute)
	if _, err := ParseAccessToken([]byte("b"), tok); err == nil {
		t.Fatal("expected signature error")
	}
}
