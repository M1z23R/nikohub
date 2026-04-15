package config

import (
	"testing"
)

func TestLoad_FillsDefaultsAndReads(t *testing.T) {
	t.Setenv("PORT", "9000")
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("JWT_SECRET", "super-secret-32-characters-long!!")
	t.Setenv("GOOGLE_CLIENT_ID", "gid")
	t.Setenv("GOOGLE_CLIENT_SECRET", "gsec")
	t.Setenv("OAUTH_REDIRECT_URL", "http://localhost:8080/api/v1/auth/google/callback")
	t.Setenv("FRONTEND_URL", "http://localhost:4200")
	t.Setenv("COOKIE_DOMAIN", "")
	t.Setenv("COOKIE_SECURE", "false")

	c, err := Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if c.Port != "9000" || c.FrontendURL != "http://localhost:4200" {
		t.Fatalf("bad config: %+v", c)
	}
	if c.CookieSecure {
		t.Fatalf("cookie secure should be false")
	}
}

func TestLoad_MissingRequired(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("JWT_SECRET", "")
	if _, err := Load(); err == nil {
		t.Fatal("expected error")
	}
}
