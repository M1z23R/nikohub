package auth

import (
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

func UserID(c *drift.Context) uuid.UUID {
	v, _ := c.Get(CtxUserID)
	if id, ok := v.(uuid.UUID); ok {
		return id
	}
	return uuid.Nil
}
