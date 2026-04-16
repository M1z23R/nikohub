package httpx

import "github.com/m1z23r/drift/pkg/drift"

func Err(c *drift.Context, status int, msg string) {
	c.AbortWithStatusJSON(status, map[string]any{"code": status, "message": msg})
}
