package auth

import (
	"database/sql"
	"strings"

	"github.com/google/uuid"
	"github.com/m1z23r/drift/pkg/drift"
	"github.com/m1z23r/nikohub/internal/httpx"
)

const CtxUserID = "user_id"

func RequireAccess(secret []byte) drift.HandlerFunc {
	return func(c *drift.Context) {
		h := c.GetHeader("Authorization")
		if !strings.HasPrefix(h, "Bearer ") {
			httpx.Err(c, 401, "missing bearer")
			return
		}
		raw := strings.TrimPrefix(h, "Bearer ")
		uid, err := ParseAccessToken(secret, raw)
		if err != nil {
			httpx.Err(c, 401, "invalid token")
			return
		}
		c.Set(CtxUserID, uid)
		c.Next()
	}
}

// RequireAccessOrCookie tries Bearer first, falls back to refresh cookie.
// Used for endpoints hit by browser directly (e.g. <img src>).
func RequireAccessOrCookie(secret []byte, db *sql.DB) drift.HandlerFunc {
	return func(c *drift.Context) {
		// try bearer first
		if h := c.GetHeader("Authorization"); strings.HasPrefix(h, "Bearer ") {
			raw := strings.TrimPrefix(h, "Bearer ")
			if uid, err := ParseAccessToken(secret, raw); err == nil {
				c.Set(CtxUserID, uid)
				c.Next()
				return
			}
		}
		// fallback: refresh cookie
		if raw, err := c.Cookie(RefreshCookie); err == nil && raw != "" {
			if uid, err := ValidateRefreshToken(db, raw); err == nil {
				c.Set(CtxUserID, uid)
				c.Next()
				return
			}
		}
		httpx.Err(c, 401, "unauthorized")
	}
}

func UserID(c *drift.Context) uuid.UUID {
	v, _ := c.Get(CtxUserID)
	if id, ok := v.(uuid.UUID); ok {
		return id
	}
	return uuid.Nil
}
