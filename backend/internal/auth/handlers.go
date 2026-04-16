package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	nikologs "github.com/M1z23r/nikologs-go"
	"github.com/m1z23r/drift/pkg/drift"
	"github.com/m1z23r/nikohub/internal/config"
	"github.com/m1z23r/nikohub/internal/httpx"
	"github.com/m1z23r/nikohub/internal/users"
	"golang.org/x/oauth2"
)

const (
	RefreshCookie = "nikohub_refresh"
	AccessTTL     = 15 * time.Minute
	RefreshTTL    = 30 * 24 * time.Hour
	StateCookie   = "nikohub_oauth_state"
	StateTTL      = 10 * time.Minute
)

type Handlers struct {
	Cfg   *config.Config
	OAuth *oauth2.Config
	DB    *sql.DB
	Users *users.Repo
	Log   *nikologs.Client
}

// signState returns a base64url(state).hex-hmac token.
func signState(secret []byte) (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	state := base64.RawURLEncoding.EncodeToString(raw)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(state))
	sig := hex.EncodeToString(mac.Sum(nil))
	return state + "." + sig, nil
}

func verifyState(secret []byte, token string) bool {
	i := strings.IndexByte(token, '.')
	if i < 0 {
		return false
	}
	state, sig := token[:i], token[i+1:]
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(state))
	want := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(want), []byte(sig))
}

func (h *Handlers) setRefreshCookie(c *drift.Context, raw string) {
	cookie := &http.Cookie{
		Name:     RefreshCookie,
		Value:    raw,
		Path:     "/api/v1",
		HttpOnly: true,
		Secure:   h.Cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
		Domain:   h.Cfg.CookieDomain,
		Expires:  time.Now().Add(RefreshTTL),
		MaxAge:   int(RefreshTTL.Seconds()),
	}
	http.SetCookie(c.Response, cookie)
}

func (h *Handlers) clearRefreshCookie(c *drift.Context) {
	cookie := &http.Cookie{
		Name:     RefreshCookie,
		Value:    "",
		Path:     "/api/v1",
		HttpOnly: true,
		Secure:   h.Cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
		Domain:   h.Cfg.CookieDomain,
		MaxAge:   -1,
	}
	http.SetCookie(c.Response, cookie)
}

func (h *Handlers) setStateCookie(c *drift.Context, state string) {
	http.SetCookie(c.Response, &http.Cookie{
		Name:     StateCookie,
		Value:    state,
		Path:     "/api/v1/auth",
		HttpOnly: true,
		Secure:   h.Cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
		Domain:   h.Cfg.CookieDomain,
		MaxAge:   int(StateTTL.Seconds()),
	})
}

func (h *Handlers) ConsentURL(c *drift.Context) {
	state, err := signState([]byte(h.Cfg.JWTSecret))
	if err != nil {
		httpx.Err(c, 500, "state error")
		return
	}
	h.setStateCookie(c, state)
	url := h.OAuth.AuthCodeURL(state, oauth2.AccessTypeOnline)
	c.Redirect(302, url)
}

func (h *Handlers) Callback(c *drift.Context) {
	code := c.QueryParam("code")
	state := c.QueryParam("state")
	if code == "" || state == "" {
		httpx.Err(c, 400, "missing code or state")
		return
	}
	stateCookie, err := c.Cookie(StateCookie)
	if err != nil || stateCookie != state {
		httpx.Err(c, 400, "bad state")
		return
	}
	if !verifyState([]byte(h.Cfg.JWTSecret), state) {
		httpx.Err(c, 400, "invalid state")
		return
	}

	info, err := FetchGoogleUserInfo(c.Request.Context(), h.OAuth, code)
	if err != nil {
		h.Log.Error("google exchange failed", nikologs.Fields{"error": err.Error()})
		httpx.Err(c, 502, "google exchange failed")
		return
	}

	u, err := h.Users.UpsertByGoogleSub(info.Sub, info.Email, info.Name, info.Picture)
	if err != nil {
		h.Log.Error("user upsert failed", nikologs.Fields{"error": err.Error()})
		httpx.Err(c, 500, "user upsert failed")
		return
	}

	raw, err := IssueRefreshToken(h.DB, u.ID, RefreshTTL)
	if err != nil {
		httpx.Err(c, 500, "refresh issue failed")
		return
	}
	h.setRefreshCookie(c, raw)
	h.Log.Info("sign-in", nikologs.Fields{"user_id": u.ID.String(), "email": u.Email})
	c.Redirect(302, h.Cfg.FrontendURL)
}

func (h *Handlers) Refresh(c *drift.Context) {
	raw, err := c.Cookie(RefreshCookie)
	if err != nil || raw == "" {
		httpx.Err(c, 401, "no refresh")
		return
	}
	newRaw, err := RotateRefreshToken(h.DB, raw, RefreshTTL)
	if err != nil {
		httpx.Err(c, 401, "invalid refresh")
		return
	}
	uid, err := ValidateRefreshToken(h.DB, newRaw)
	if err != nil {
		httpx.Err(c, 500, "refresh check failed")
		return
	}
	u, err := h.Users.Get(uid)
	if err != nil {
		httpx.Err(c, 500, "user lookup failed")
		return
	}
	h.setRefreshCookie(c, newRaw)
	access, err := IssueAccessToken([]byte(h.Cfg.JWTSecret), u.ID, AccessTTL)
	if err != nil {
		httpx.Err(c, 500, "access issue failed")
		return
	}
	c.JSON(200, map[string]any{"accessToken": access, "user": u})
}

func (h *Handlers) Logout(c *drift.Context) {
	if raw, err := c.Cookie(RefreshCookie); err == nil {
		_ = RevokeRefreshToken(h.DB, raw)
	}
	h.clearRefreshCookie(c)
	c.Status(204)
}

func (h *Handlers) Me(c *drift.Context) {
	uid := UserID(c)
	u, err := h.Users.Get(uid)
	if err != nil {
		httpx.Err(c, 404, "user not found")
		return
	}
	c.JSON(200, map[string]any{"user": u})
}
