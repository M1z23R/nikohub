# nikohub — Design Spec

**Date:** 2026-04-16

Personal idea-hub web app. Each user has one private canvas-style whiteboard where they can drop movable, resizable cards (text + optional image) via a right-click context menu. Google SSO is the only auth method. Cookie-based JWT auth with in-memory access tokens and httpOnly refresh cookies.

## Stack

- **Backend:** Go + [Drift](../../../DRIFT.md) (no external router/middleware deps), Postgres via `database/sql` + `lib/pq`, logging via [nikologs-go](../../../NIKOLOGS-GO.md).
- **Frontend:** Angular 21 standalone + [@m1z23r/ngx-ui](../../../NGX-UI.md), signal-based, OnPush.
- **Database:** Postgres (local install, no docker).
- **Deployment:** systemd unit on a VPS; nginx reverse-proxies `/api/v1` → Go binary and serves SPA from `/var/www/nikohub/`.

## Auth Flow

Cookie-based JWT. Access token is short-lived and lives in an in-memory signal on the frontend. Refresh token is an opaque random string stored hashed in DB; sent as `httpOnly; Secure; SameSite=Lax` cookie.

1. Frontend `Login with Google` button → `GET /api/v1/auth/google/consent-url`.
2. Backend builds Google OAuth URL with state (signed, short-lived) and responds `302` to Google.
3. Google redirects to `GET /api/v1/auth/google/callback?code=...&state=...`.
4. Backend exchanges code, fetches userinfo, upserts user by `google_sub`. New and existing users are handled identically (auto-signup or auto-login).
5. Backend issues refresh token (opaque, stored hashed), sets refresh cookie, then `302` to `FRONTEND_URL/` (the app picks up session via `/me`).
6. App init calls `POST /api/v1/auth/refresh` — backend validates refresh cookie, rotates it, returns `{ accessToken, user }`.
7. HTTP interceptor attaches `Authorization: Bearer <access>`. On 401, interceptor calls refresh once and retries.
8. `POST /api/v1/auth/logout` revokes the refresh token and clears the cookie.

**JWT claims (access):** `sub` (user id), `exp` (~15min), `iat`. HMAC-SHA256 with `JWT_SECRET`.

**Refresh token:** random 32 bytes base64url. Stored as SHA-256 hash in `refresh_tokens` table with `expires_at` (30d) and `revoked` flag. Rotated on every refresh (old row revoked, new row inserted).

## Data Model

```sql
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub  TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);

CREATE TABLE cards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  x           INTEGER NOT NULL,
  y           INTEGER NOT NULL,
  width       INTEGER NOT NULL DEFAULT 220,
  height      INTEGER NOT NULL DEFAULT 160,
  color       TEXT NOT NULL DEFAULT '#fde68a',
  text        TEXT NOT NULL DEFAULT '',
  image_mime  TEXT,
  image_data  BYTEA,
  z_index     INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cards_user ON cards(user_id);
```

Each user has exactly one canvas — represented by the set of rows in `cards` where `user_id` matches. No separate `canvases` table needed.

Migrations are plain `.sql` files under `backend/migrations/`, applied in lexical order at startup via a simple tracking table `schema_migrations(version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ)`.

## API

All routes prefixed `/api/v1`. JSON bodies unless noted.

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/auth/google/consent-url` | public | 302 to Google consent URL |
| GET | `/auth/google/callback` | public | Exchanges code, sets refresh cookie, 302 to `FRONTEND_URL` |
| POST | `/auth/refresh` | refresh cookie | Rotates refresh, returns `{ accessToken, user }` |
| POST | `/auth/logout` | refresh cookie | Revokes refresh, clears cookie |
| GET | `/me` | access | Returns `{ user }` |

### Cards

| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/cards` | — | All cards for current user |
| POST | `/cards` | `{x, y, color?, text?}` | Create card |
| PATCH | `/cards/:id` | partial `{x?,y?,width?,height?,color?,text?,z_index?}` | Update |
| DELETE | `/cards/:id` | — | Delete |
| POST | `/cards/:id/image` | multipart `file` | Upload/replace image (max 5 MB) |
| DELETE | `/cards/:id/image` | — | Remove image |
| GET | `/cards/:id/image` | access | Streams image bytes with `Cache-Control: private, max-age=3600` |

All card routes enforce `user_id = session user` via middleware + `WHERE user_id = $1` in queries.

## Backend Structure

```
backend/
  cmd/server/main.go
  internal/
    config/         env loading
    db/             sql.DB setup, migration runner
    migrations/     001_init.sql, ...
    auth/           google oauth, jwt, refresh tokens, middleware
    cards/          handler, repo, types
    users/          repo, types
    httpx/          common error JSON helpers
  Makefile
  nikohub.service
  .env.example
```

Drift setup in `main.go`:
- `middleware.Recovery`, `middleware.CORS` (dev origin from `FRONTEND_URL`, `AllowCredentials: true`), `middleware.BodyParser`.
- Auth middleware reads `Authorization: Bearer` and sets `c.Set("user_id", ...)`.
- Route groups: `/api/v1/auth` (public), `/api/v1` (protected).

## Frontend Structure

```
frontend/
  src/
    app/
      app.ts, app.routes.ts, app.config.ts
      core/
        auth/
          auth.service.ts        access signal, user signal, login/logout/refresh
          auth.interceptor.ts    attaches bearer, 401 → refresh+retry
          auth.guard.ts
        api/
          card.service.ts
      pages/
        login/login.component.{ts,html,css}
        canvas/canvas.component.{ts,html,css}
      components/
        header/header.component.{ts,html,css}
        canvas-board/canvas-board.component.{ts,html,css}
        card/card.component.{ts,html,css}
    environments/
      environment.ts       apiBase: 'http://localhost:8080/api/v1'
      environment.prod.ts  apiBase: 'https://nikohub.dimitrije.dev/api/v1'
    styles.css             ngx-ui theme overrides
  package.json
  angular.json
```

### Routes

- `/login` — login screen (Google button).
- `/` — canvas (guarded by `auth.guard`). Root redirects to `/login` if unauthenticated.

### Auth init

On app bootstrap, `AuthService.init()` calls `/auth/refresh`:
- Success → stores access token + user, route stays on `/`.
- Failure → clears state, router goes to `/login`.

Interceptor uses `withCredentials: true` for all `/api/v1` calls.

## Canvas UX

The canvas is a large scrollable container (10000×10000 px) with absolutely-positioned cards. No zoom, no pan-drag (scrollbars only) — keeps it simple.

### Right-click menu (empty space)

Uses ngx-ui `ui-dropdown` opened programmatically at cursor via `openAt(clientX, clientY)`:
- "New note" → creates card at click coords with default color.
- Color swatches: 6 pastel colors (yellow `#fde68a`, pink `#fbcfe8`, blue `#bfdbfe`, green `#bbf7d0`, purple `#ddd6fe`, orange `#fed7aa`). Clicking a swatch creates a card of that color at the coords.

### Right-click menu (on card)

- Change color (6 swatches)
- Upload image (file input; 5 MB limit enforced both ends)
- Remove image (if present)
- Delete card

### Card component

- Absolutely positioned `div` styled with `color` as background.
- Header strip (drag handle) at top; `pointerdown` starts drag, `pointermove`/`pointerup` on `window` track it. Updates `x/y` signals locally immediately; PATCH debounced ~200 ms after pointerup.
- Resize grip at bottom-right; analogous logic for `width/height`.
- Double-click body → inline textarea editor, blur saves via PATCH.
- Image (if any) rendered above/below text; src = `${apiBase}/cards/${id}/image?v=${updated_at}` (cache-buster on change).
- Bring-to-front on interaction: bumps `z_index` to `max+1` (patched).

### Optimistic updates

All mutations apply to local state first, then PATCH. On server error, toast via `ToastService` and re-fetch.

## Header

`ui-shell` layout with `ui-navbar`:
- Left: "nikohub" wordmark.
- Right: `ui-dropdown` with avatar (Google avatar or initial); items: "Logout".

No sidebar — canvas fills content area.

## Theming

Override in `styles.css`:

```css
:root {
  --ui-primary: #6366f1;
  --ui-primary-hover: #4f46e5;
  --ui-primary-active: #4338ca;
  --ui-bg: #fafafa;
  --ui-bg-secondary: #f4f4f5;
  --ui-text: #18181b;
  --ui-border: #e4e4e7;
}
```

## Logging

Backend uses [`github.com/M1z23r/nikologs-go`](../../../NIKOLOGS-GO.md). Construct a single `*nikologs.Client` as `nlog` in `main` and inject it into handlers/services as a dependency.

```go
nlog := nikologs.New(cfg.NikologsAPIKey,
    nikologs.WithSource("nikohub"),
    nikologs.WithFlushInterval(3*time.Second),
    nikologs.WithBatchSize(200),
    nikologs.WithOnError(func(err error) { log.Printf("nlog: %v", err) }),
)
defer nlog.Shutdown(context.Background())
```

Call sites: `nlog.Info`/`Warn`/`Error` directly in handlers — fire-and-forget, never wrap in goroutines. Attach structured fields (`nikologs.Fields{"user_id": uid, "card_id": cid}`). An access-log middleware logs each request (`method`, `path`, `status`, `duration_ms`, `user_id`).

Env: `NIKOLOGS_API_KEY` (`nk_...`). If unset, construct a no-op / stdout fallback client so dev without the key still works.

## Environment

`.env.example`:
```
PORT=8080
DATABASE_URL=postgres://nikohub:password@localhost:5432/nikohub?sslmode=disable
JWT_SECRET=replace-me-32-bytes
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
OAUTH_REDIRECT_URL=https://nikohub.dimitrije.dev/api/v1/auth/google/callback
FRONTEND_URL=https://nikohub.dimitrije.dev
COOKIE_DOMAIN=nikohub.dimitrije.dev
COOKIE_SECURE=true
NIKOLOGS_API_KEY=
```

Dev values: `OAUTH_REDIRECT_URL=http://localhost:8080/api/v1/auth/google/callback`, `FRONTEND_URL=http://localhost:4200`, `COOKIE_DOMAIN=` (empty → host-only), `COOKIE_SECURE=false`.

## Deployment (mirrors nikologs)

### Backend

- `Makefile` with identical targets: `build`, `test`, `web`, `setup`, `install`, `prod`, `start`, `stop`, `restart`, `logs`, `status`. `APP_NAME := nikohub`, `INSTALL_DIR := /opt/nikohub`.
- `nikohub.service`: `User=nikohub`, `Group=nikohub`, `WorkingDirectory=/opt/nikohub`, `ExecStart=/opt/nikohub/nikohub`, `EnvironmentFile=/opt/nikohub/.env`, `After=network.target postgresql.service`, `Restart=always`, same hardening (`NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=full`, `ProtectHome=true`).
- Binary: `./cmd/server/`.

### Frontend

- `package.json` `deploy` script: `npm i && npm run build --configuration=production && mkdir -p /var/www/nikohub/ && rm -rf /var/www/nikohub/* && cp -r dist/frontend/browser/* /var/www/nikohub/`.
- `angular.json` mirrors nikologs structure.
- No `proxy.conf.json` — dev uses full backend URL from `environment.ts`.

### nginx (operator-side, not in repo)

- `https://nikohub.dimitrije.dev/api/v1/*` → `http://127.0.0.1:8080`
- `https://nikohub.dimitrije.dev/*` → `/var/www/nikohub/` with SPA fallback to `/index.html`.

## Out of Scope

- Multiple canvases per user / sharing (deliberately dropped after brainstorm).
- Realtime sync, collaboration, presence.
- Card history, undo/redo.
- Search, tags, folders.
- Mobile-first UX (works on desktop; mobile acceptable but not optimized).
