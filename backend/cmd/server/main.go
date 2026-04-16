package main

import (
	"log"
	"strings"
	"time"

	nikologs "github.com/M1z23r/nikologs-go"
	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/m1z23r/drift/pkg/drift"
	"github.com/m1z23r/drift/pkg/middleware"
	"github.com/m1z23r/nikohub/internal/auth"
	"github.com/m1z23r/nikohub/internal/cards"
	"github.com/m1z23r/nikohub/internal/cardtypecolors"
	"github.com/m1z23r/nikohub/internal/config"
	"github.com/m1z23r/nikohub/internal/db"
	"github.com/m1z23r/nikohub/internal/logx"
	"github.com/m1z23r/nikohub/internal/users"
)

func main() {
	_ = godotenv.Load()
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	nlog := logx.New(cfg.NikologsAPIKey)
	defer logx.Shutdown(nlog)

	pg, err := db.Open(cfg.DatabaseURL)
	if err != nil {
		log.Fatal(err)
	}
	if err := db.Migrate(pg); err != nil {
		log.Fatal(err)
	}

	userRepo := users.NewRepo(pg)
	cardRepo := cards.NewRepo(pg)
	colorRepo := cardtypecolors.NewRepo(pg)

	authH := &auth.Handlers{
		Cfg:   cfg,
		OAuth: auth.GoogleConfig(cfg.GoogleClientID, cfg.GoogleClientSecret, cfg.OAuthRedirectURL),
		DB:    pg,
		Users: userRepo,
		Log:   nlog,
	}
	cardH := &cards.Handlers{Repo: cardRepo, Log: nlog}
	colorH := &cardtypecolors.Handlers{Repo: colorRepo, Log: nlog}

	app := drift.New()
	app.Use(
		middleware.Recovery(),
		middleware.CORSWithConfig(middleware.CORSConfig{
			AllowOrigins:     []string{cfg.FrontendURL},
			AllowMethods:     []string{"GET", "POST", "PATCH", "DELETE", "OPTIONS"},
			AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
			AllowCredentials: true,
			MaxAge:           3600,
		}),
		middleware.BodyParserWithConfig(middleware.BodyParserConfig{MaxBodySize: 10 << 20}),
		accessLog(nlog),
	)

	api := app.Group("/api/v1")

	// public
	api.Get("/auth/google/consent-url", authH.ConsentURL)
	api.Get("/auth/google/callback", authH.Callback)
	api.Post("/auth/refresh", authH.Refresh)
	api.Post("/auth/logout", authH.Logout)

	// protected
	secret := []byte(cfg.JWTSecret)
	api.Get("/me", auth.RequireAccess(secret), authH.Me)
	api.Get("/cards", auth.RequireAccess(secret), cardH.List)
	api.Post("/cards", auth.RequireAccess(secret), cardH.Create)
	api.Patch("/cards/:id", auth.RequireAccess(secret), cardH.Patch)
	api.Delete("/cards/:id", auth.RequireAccess(secret), cardH.Delete)
	api.Post("/cards/:id/image", auth.RequireAccess(secret), cardH.UploadImage)
	api.Delete("/cards/:id/image", auth.RequireAccess(secret), cardH.DeleteImage)
	api.Get("/cards/:id/image", auth.RequireAccessOrCookie(secret, pg), cardH.GetImage)
	api.Get("/totps", auth.RequireAccess(secret), cardH.GetAllTOTP)
	api.Get("/totps/:id", auth.RequireAccess(secret), cardH.GetTOTP)
	api.Get("/card-type-colors", auth.RequireAccess(secret), colorH.List)
	api.Patch("/card-type-colors/:cardType", auth.RequireAccess(secret), colorH.Patch)

	nlog.Info("server starting", nikologs.Fields{"port": cfg.Port})
	if err := app.Run(":" + cfg.Port); err != nil {
		log.Fatal(err)
	}
}

func accessLog(nlog *nikologs.Client) drift.HandlerFunc {
	return func(c *drift.Context) {
		start := time.Now()
		c.Next()
		dur := time.Since(start)
		path := c.Path()
		// skip image endpoint spam
		if strings.HasSuffix(path, "/image") {
			return
		}
		uid := ""
		if v, ok := c.Get(auth.CtxUserID); ok {
			if id, ok := v.(uuid.UUID); ok {
				uid = id.String()
			}
		}
		nlog.Info("http", nikologs.Fields{
			"method":      c.Method(),
			"path":        path,
			"duration_ms": dur.Milliseconds(),
			"user_id":     uid,
		})
	}
}
