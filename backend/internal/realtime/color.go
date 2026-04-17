package realtime

import (
	"crypto/sha1"

	"github.com/google/uuid"
)

var palette = []string{
	"#ef4444", "#f97316", "#f59e0b", "#84cc16",
	"#10b981", "#06b6d4", "#3b82f6", "#6366f1",
	"#8b5cf6", "#d946ef", "#ec4899", "#14b8a6",
}

func ColorFor(userID uuid.UUID) string {
	h := sha1.Sum(userID[:])
	return palette[int(h[0])%len(palette)]
}
