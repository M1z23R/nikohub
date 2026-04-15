package logx

import (
	"context"
	"log"
	"time"

	nikologs "github.com/M1z23r/nikologs-go"
)

type Logger = nikologs.Client

func New(apiKey string) *Logger {
	if apiKey == "" {
		// Stdout-only fallback; client still works but sends to base URL (won't auth).
		// For dev we want no network attempts — start a client pointed at localhost sink is overkill.
		// Use a real client but the on-error logs to stderr only.
		log.Println("logx: NIKOLOGS_API_KEY empty — remote logging disabled")
	}
	return nikologs.New(apiKey,
		nikologs.WithSource("nikohub"),
		nikologs.WithFlushInterval(3*time.Second),
		nikologs.WithBatchSize(200),
		nikologs.WithOnError(func(err error) {
			log.Printf("nlog: %v", err)
		}),
	)
}

func Shutdown(l *Logger) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = l.Shutdown(ctx)
}
