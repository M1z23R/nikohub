package config

import (
	"errors"
	"os"
	"strconv"
)

type Config struct {
	Port               string
	DatabaseURL        string
	JWTSecret          string
	GoogleClientID     string
	GoogleClientSecret string
	OAuthRedirectURL   string
	FrontendURL        string
	CookieDomain       string
	CookieSecure       bool
	NikologsAPIKey     string
}

func Load() (*Config, error) {
	c := &Config{
		Port:               getenv("PORT", "8080"),
		DatabaseURL:        os.Getenv("DATABASE_URL"),
		JWTSecret:          os.Getenv("JWT_SECRET"),
		GoogleClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
		GoogleClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
		OAuthRedirectURL:   os.Getenv("OAUTH_REDIRECT_URL"),
		FrontendURL:        os.Getenv("FRONTEND_URL"),
		CookieDomain:       os.Getenv("COOKIE_DOMAIN"),
		NikologsAPIKey:     os.Getenv("NIKOLOGS_API_KEY"),
	}
	c.CookieSecure, _ = strconv.ParseBool(getenv("COOKIE_SECURE", "true"))

	var missing []string
	for k, v := range map[string]string{
		"DATABASE_URL":         c.DatabaseURL,
		"JWT_SECRET":           c.JWTSecret,
		"GOOGLE_CLIENT_ID":     c.GoogleClientID,
		"GOOGLE_CLIENT_SECRET": c.GoogleClientSecret,
		"OAUTH_REDIRECT_URL":   c.OAuthRedirectURL,
		"FRONTEND_URL":         c.FrontendURL,
	} {
		if v == "" {
			missing = append(missing, k)
		}
	}
	if len(missing) > 0 {
		return nil, errors.New("missing required env: " + joinCSV(missing))
	}
	return c, nil
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func joinCSV(xs []string) string {
	out := ""
	for i, s := range xs {
		if i > 0 {
			out += ", "
		}
		out += s
	}
	return out
}
