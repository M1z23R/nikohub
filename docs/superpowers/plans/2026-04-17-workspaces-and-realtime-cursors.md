# Workspaces & Real-time Cursors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add shared, invite-code-joined workspaces (viewer/editor roles) on top of the existing single-user canvas, with a single in-process websocket hub that broadcasts card mutations and renders live cursors for peers in the same shared workspace.

**Architecture:** Single-instance Go backend. New `workspaces` + `workspace_members` tables; `cards.workspace_id` nullable (NULL = owner's implicit personal space). All card mutations go through existing HTTP handlers; successful writes call `hub.Broadcast` after commit. Cursors travel only over the websocket. The hub is CSP-style: a single goroutine owns room state, all ops go through channels, no shared mutex. Frontend exposes a `WorkspaceService` signal store, a left sidebar, and a `RealtimeService` that reacts to active-workspace changes.

**Tech Stack:** Go 1.25 + Drift framework (incl. `drift/pkg/websocket`) + PostgreSQL + Angular 21 signals + ngx-ui.

---

## Spec Reference

Authoritative design: `docs/superpowers/specs/2026-04-17-workspaces-and-realtime-cursors-design.md`. If anything in a task contradicts the spec, the spec wins — update the task.

---

## Phase 1 — Backend data layer

### Task 1: Add workspaces migration

**Files:**
- Create: `backend/internal/migrations/010_workspaces.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE workspaces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  viewer_code TEXT UNIQUE,
  editor_code TEXT UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_workspaces_owner ON workspaces(owner_id);

CREATE TABLE workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('viewer','editor')),
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX idx_workspace_members_user ON workspace_members(user_id);

ALTER TABLE cards ADD COLUMN workspace_id UUID
  REFERENCES workspaces(id) ON DELETE CASCADE;
CREATE INDEX idx_cards_workspace ON cards(workspace_id);
```

- [ ] **Step 2: Verify migration file compiles into binary**

Run: `cd backend && go build ./...`
Expected: success. The `//go:embed *.sql` in `internal/migrations/migrations.go` auto-picks the new file.

- [ ] **Step 3: Run app locally to apply the migration**

Run: `cd backend && ./bin/nikohub` (after `make build`)
Expected: no migration error in logs. The existing `db.Migrate(pg)` call runs it.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/migrations/010_workspaces.sql
git commit -m "add workspaces + workspace_members tables, cards.workspace_id"
```

---

### Task 2: (REMOVED — drift's websocket package is used, no new dep needed)

`github.com/m1z23r/drift/pkg/websocket` is already available via the existing drift dependency. Task numbers 3–24 below are unchanged.

---

### Task 3: Workspace repository

**Files:**
- Create: `backend/internal/workspaces/workspaces.go`
- Create: `backend/internal/workspaces/workspaces_test.go`

- [ ] **Step 1: Define types and repo skeleton**

`backend/internal/workspaces/workspaces.go`:

```go
package workspaces

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"

	"github.com/google/uuid"
)

type Role string

const (
	RoleOwner  Role = "owner"
	RoleEditor Role = "editor"
	RoleViewer Role = "viewer"
)

type Workspace struct {
	ID         uuid.UUID  `json:"id"`
	OwnerID    uuid.UUID  `json:"owner_id"`
	Name       string     `json:"name"`
	ViewerCode *string    `json:"viewer_code,omitempty"`
	EditorCode *string    `json:"editor_code,omitempty"`
	Role       Role       `json:"role"`
}

type Member struct {
	UserID uuid.UUID `json:"user_id"`
	Name   string    `json:"name"`
	Email  string    `json:"email"`
	Role   Role      `json:"role"`
}

var ErrNotFound = errors.New("workspace not found")
var ErrForbidden = errors.New("forbidden")
var ErrNotOwner = errors.New("not owner")

type Repo struct{ db *sql.DB }

func NewRepo(db *sql.DB) *Repo { return &Repo{db: db} }

func newCode() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
```

- [ ] **Step 2: Add ListForUser (owned + joined)**

Append to `workspaces.go`:

```go
func (r *Repo) ListForUser(userID uuid.UUID) ([]Workspace, error) {
	rows, err := r.db.Query(`
		SELECT id, owner_id, name, viewer_code, editor_code, 'owner'::text AS role
		FROM workspaces WHERE owner_id = $1
		UNION ALL
		SELECT w.id, w.owner_id, w.name, NULL, NULL, wm.role
		FROM workspaces w
		JOIN workspace_members wm ON wm.workspace_id = w.id
		WHERE wm.user_id = $1
		ORDER BY name`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Workspace{}
	for rows.Next() {
		var w Workspace
		var viewerCode, editorCode sql.NullString
		var role string
		if err := rows.Scan(&w.ID, &w.OwnerID, &w.Name, &viewerCode, &editorCode, &role); err != nil {
			return nil, err
		}
		if viewerCode.Valid {
			s := viewerCode.String
			w.ViewerCode = &s
		}
		if editorCode.Valid {
			s := editorCode.String
			w.EditorCode = &s
		}
		w.Role = Role(role)
		out = append(out, w)
	}
	return out, rows.Err()
}
```

- [ ] **Step 3: Add Create, Rename, Delete**

```go
func (r *Repo) Create(ownerID uuid.UUID, name string) (*Workspace, error) {
	w := &Workspace{OwnerID: ownerID, Name: name, Role: RoleOwner}
	err := r.db.QueryRow(
		`INSERT INTO workspaces(owner_id, name) VALUES($1, $2) RETURNING id`,
		ownerID, name,
	).Scan(&w.ID)
	return w, err
}

func (r *Repo) Rename(ownerID, id uuid.UUID, name string) error {
	res, err := r.db.Exec(
		`UPDATE workspaces SET name=$3 WHERE id=$1 AND owner_id=$2`,
		id, ownerID, name,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repo) Delete(ownerID, id uuid.UUID) error {
	res, err := r.db.Exec(
		`DELETE FROM workspaces WHERE id=$1 AND owner_id=$2`, id, ownerID,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
```

- [ ] **Step 4: Add RotateCode, DisableCode**

```go
type CodeKind string

const (
	CodeViewer CodeKind = "viewer"
	CodeEditor CodeKind = "editor"
)

func (r *Repo) RotateCode(ownerID, id uuid.UUID, kind CodeKind) (string, error) {
	code, err := newCode()
	if err != nil {
		return "", err
	}
	col := "viewer_code"
	if kind == CodeEditor {
		col = "editor_code"
	}
	res, err := r.db.Exec(
		`UPDATE workspaces SET `+col+`=$3 WHERE id=$1 AND owner_id=$2`,
		id, ownerID, code,
	)
	if err != nil {
		return "", err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return "", ErrNotFound
	}
	return code, nil
}

func (r *Repo) DisableCode(ownerID, id uuid.UUID, kind CodeKind) error {
	col := "viewer_code"
	if kind == CodeEditor {
		col = "editor_code"
	}
	res, err := r.db.Exec(
		`UPDATE workspaces SET `+col+`=NULL WHERE id=$1 AND owner_id=$2`,
		id, ownerID,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
```

- [ ] **Step 5: Add JoinByCode (with auto-promote)**

```go
// JoinByCode looks up a workspace by code, joins the user (or promotes
// viewer→editor), and returns the workspace with caller's role.
// Never demotes. Owners calling their own code no-op.
func (r *Repo) JoinByCode(userID uuid.UUID, code string) (*Workspace, error) {
	var ws Workspace
	var viewerCode, editorCode sql.NullString
	err := r.db.QueryRow(`
		SELECT id, owner_id, name, viewer_code, editor_code
		FROM workspaces
		WHERE viewer_code = $1 OR editor_code = $1`,
		code,
	).Scan(&ws.ID, &ws.OwnerID, &ws.Name, &viewerCode, &editorCode)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	if ws.OwnerID == userID {
		ws.Role = RoleOwner
		return &ws, nil
	}

	newRole := RoleViewer
	if editorCode.Valid && editorCode.String == code {
		newRole = RoleEditor
	}

	// Insert if absent; promote if upgrade.
	var currentRole sql.NullString
	_ = r.db.QueryRow(
		`SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2`,
		ws.ID, userID,
	).Scan(&currentRole)

	if !currentRole.Valid {
		if _, err := r.db.Exec(
			`INSERT INTO workspace_members(workspace_id, user_id, role) VALUES($1,$2,$3)`,
			ws.ID, userID, string(newRole),
		); err != nil {
			return nil, err
		}
		ws.Role = newRole
	} else if currentRole.String == string(RoleViewer) && newRole == RoleEditor {
		if _, err := r.db.Exec(
			`UPDATE workspace_members SET role='editor' WHERE workspace_id=$1 AND user_id=$2`,
			ws.ID, userID,
		); err != nil {
			return nil, err
		}
		ws.Role = RoleEditor
	} else {
		ws.Role = Role(currentRole.String)
	}
	return &ws, nil
}
```

- [ ] **Step 6: Add ListMembers, KickMember, Leave**

```go
func (r *Repo) ListMembers(ownerID, workspaceID uuid.UUID) ([]Member, error) {
	// owner check
	var owner uuid.UUID
	if err := r.db.QueryRow(
		`SELECT owner_id FROM workspaces WHERE id=$1`, workspaceID,
	).Scan(&owner); err == sql.ErrNoRows {
		return nil, ErrNotFound
	} else if err != nil {
		return nil, err
	}
	if owner != ownerID {
		return nil, ErrNotOwner
	}

	rows, err := r.db.Query(`
		SELECT u.id, u.name, u.email, wm.role
		FROM workspace_members wm
		JOIN users u ON u.id = wm.user_id
		WHERE wm.workspace_id = $1
		ORDER BY wm.joined_at ASC`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Member{}
	for rows.Next() {
		var m Member
		var role string
		if err := rows.Scan(&m.UserID, &m.Name, &m.Email, &role); err != nil {
			return nil, err
		}
		m.Role = Role(role)
		out = append(out, m)
	}
	return out, rows.Err()
}

func (r *Repo) KickMember(ownerID, workspaceID, memberID uuid.UUID) error {
	res, err := r.db.Exec(`
		DELETE FROM workspace_members
		WHERE workspace_id = $1 AND user_id = $2
		  AND workspace_id IN (SELECT id FROM workspaces WHERE owner_id = $3)`,
		workspaceID, memberID, ownerID,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repo) Leave(userID, workspaceID uuid.UUID) error {
	res, err := r.db.Exec(
		`DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2`,
		workspaceID, userID,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
```

- [ ] **Step 7: Add AuthorizeWorkspace (role lookup)**

```go
// AuthorizeWorkspace returns the caller's role for a workspace.
// Returns ErrForbidden if not a member/owner.
func (r *Repo) AuthorizeWorkspace(userID, workspaceID uuid.UUID) (Role, error) {
	var owner uuid.UUID
	if err := r.db.QueryRow(
		`SELECT owner_id FROM workspaces WHERE id=$1`, workspaceID,
	).Scan(&owner); err == sql.ErrNoRows {
		return "", ErrNotFound
	} else if err != nil {
		return "", err
	}
	if owner == userID {
		return RoleOwner, nil
	}
	var role string
	err := r.db.QueryRow(
		`SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2`,
		workspaceID, userID,
	).Scan(&role)
	if err == sql.ErrNoRows {
		return "", ErrForbidden
	}
	if err != nil {
		return "", err
	}
	return Role(role), nil
}
```

- [ ] **Step 8: Run build**

Run: `cd backend && go build ./...`
Expected: success.

- [ ] **Step 9: Commit**

```bash
git add backend/internal/workspaces/workspaces.go
git commit -m "add workspaces repo: list/create/rename/delete/codes/join/members"
```

---

### Task 4: Extend cards package for workspace_id

**Files:**
- Modify: `backend/internal/cards/cards.go`
- Modify: `backend/internal/cards/handlers.go`

- [ ] **Step 1: Add WorkspaceID to Card struct**

In `cards.go`, extend `Card`:

```go
type Card struct {
	ID           uuid.UUID  `json:"id"`
	WorkspaceID  *uuid.UUID `json:"workspace_id"`
	X            int        `json:"x"`
	Y            int        `json:"y"`
	Width        int        `json:"width"`
	Height       int        `json:"height"`
	Color        string     `json:"color"`
	Text         string     `json:"text"`
	HasImage     bool       `json:"has_image"`
	ZIndex       int        `json:"z_index"`
	CardType     string     `json:"card_type"`
	IsSecret     bool       `json:"is_secret"`
	IsFavorite   bool       `json:"is_favorite"`
	SidebarOrder int        `json:"sidebar_order"`
	TotpName     string     `json:"totp_name,omitempty"`
	ContainerID  *uuid.UUID `json:"container_id"`
	Title        string     `json:"title"`
	UpdatedAt    time.Time  `json:"updated_at"`
}
```

- [ ] **Step 2: Update returnCols and scanCard**

```go
const returnCols = `id,workspace_id,x,y,width,height,color,text,(image_data IS NOT NULL),z_index,card_type,is_secret,is_favorite,sidebar_order,COALESCE(totp_name,''),container_id,title,updated_at`

func scanCard(row interface{ Scan(...any) error }, c *Card) error {
	var containerID uuid.NullUUID
	var workspaceID uuid.NullUUID
	err := row.Scan(&c.ID, &workspaceID, &c.X, &c.Y, &c.Width, &c.Height, &c.Color, &c.Text, &c.HasImage, &c.ZIndex, &c.CardType, &c.IsSecret, &c.IsFavorite, &c.SidebarOrder, &c.TotpName, &containerID, &c.Title, &c.UpdatedAt)
	if containerID.Valid {
		c.ContainerID = &containerID.UUID
	}
	if workspaceID.Valid {
		c.WorkspaceID = &workspaceID.UUID
	}
	return err
}
```

- [ ] **Step 3: Split List into ListPersonal and ListWorkspace**

Replace the existing `List` method:

```go
func (r *Repo) ListPersonal(userID uuid.UUID) ([]Card, error) {
	rows, err := r.db.Query(`
		SELECT `+returnCols+`
		FROM cards WHERE user_id=$1 AND workspace_id IS NULL
		ORDER BY z_index ASC, created_at ASC`, userID)
	return r.scanList(rows, err)
}

func (r *Repo) ListWorkspace(workspaceID uuid.UUID) ([]Card, error) {
	rows, err := r.db.Query(`
		SELECT `+returnCols+`
		FROM cards WHERE workspace_id=$1
		ORDER BY z_index ASC, created_at ASC`, workspaceID)
	return r.scanList(rows, err)
}

func (r *Repo) scanList(rows *sql.Rows, err error) ([]Card, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Card{}
	for rows.Next() {
		var c Card
		if err := scanCard(rows, &c); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
```

- [ ] **Step 4: Update Create to accept workspace_id**

```go
type CreateInput struct {
	WorkspaceID         *uuid.UUID
	X, Y, Width, Height int
	Color, Text, Title  string
	CardType            string
	IsSecret            bool
	TotpSecret          string
	TotpName            string
}

func (r *Repo) Create(userID uuid.UUID, in CreateInput) (*Card, error) {
	// ... existing default-setting code unchanged ...
	c := &Card{}
	var totpSecret, totpName *string
	if cardType == "totp" {
		totpSecret = &in.TotpSecret
		totpName = &in.TotpName
	}
	err := r.db.QueryRow(`
		INSERT INTO cards(user_id,workspace_id,x,y,width,height,color,text,title,card_type,is_secret,totp_secret,totp_name)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		RETURNING `+returnCols,
		userID, in.WorkspaceID, in.X, in.Y, width, height, color, in.Text, in.Title, cardType, in.IsSecret, totpSecret, totpName,
	)
	if err := scanCard(err, c); err != nil {
		return nil, err
	}
	return c, nil
}
```

- [ ] **Step 5: Add GetByID for authz lookups**

Append:

```go
// GetByID returns a card regardless of ownership. Callers must authorize separately.
func (r *Repo) GetByID(id uuid.UUID) (*Card, error) {
	c := &Card{}
	row := r.db.QueryRow(
		`SELECT `+returnCols+` FROM cards WHERE id=$1`, id,
	)
	if err := scanCard(row, c); err != nil {
		return nil, err
	}
	return c, nil
}
```

- [ ] **Step 6: Add workspace-aware variants of Update/Delete/SetImage/ClearImage/GetImage/GetSecret/GetAllSecrets**

These all currently gate by `user_id`. Replace their WHERE clauses so the caller passes the card id alone, and authorization is done in the HTTP layer before calling the repo. E.g.:

```go
func (r *Repo) Update(id uuid.UUID, in UpdateInput) (*Card, error) {
	c := &Card{}
	row := r.db.QueryRow(`
		UPDATE cards SET
		  x = COALESCE($2,x),
		  ...
		WHERE id=$1
		RETURNING `+returnCols,
		id, in.X, in.Y, in.Width, in.Height, in.ZIndex, in.Color, in.Text, in.Title, in.IsSecret,
		in.ContainerID, in.ClearContainerID, in.IsFavorite, in.SidebarOrder,
	)
	if err := scanCard(row, c); err != nil {
		return nil, err
	}
	return c, nil
}

func (r *Repo) Delete(id uuid.UUID) error {
	res, err := r.db.Exec(`DELETE FROM cards WHERE id=$1`, id)
	// ... same 0-rows → ErrNoRows handling ...
}

// SetImage(id, mime, data), ClearImage(id), GetImage(id), GetSecret(id), GetAllSecretsForScope — signatures drop userID.
```

For `GetAllSecrets`, add a workspace-aware version:

```go
// GetAllSecretsForScope: workspaceID nil = personal for user; non-nil = that workspace.
func (r *Repo) GetAllSecretsForScope(userID uuid.UUID, workspaceID *uuid.UUID) (map[uuid.UUID]string, error) {
	var rows *sql.Rows
	var err error
	if workspaceID == nil {
		rows, err = r.db.Query(
			`SELECT id, totp_secret FROM cards
			 WHERE user_id=$1 AND workspace_id IS NULL AND card_type='totp' AND totp_secret IS NOT NULL`,
			userID,
		)
	} else {
		rows, err = r.db.Query(
			`SELECT id, totp_secret FROM cards
			 WHERE workspace_id=$1 AND card_type='totp' AND totp_secret IS NOT NULL`,
			*workspaceID,
		)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[uuid.UUID]string)
	for rows.Next() {
		var id uuid.UUID
		var s string
		if err := rows.Scan(&id, &s); err != nil {
			return nil, err
		}
		out[id] = s
	}
	return out, rows.Err()
}
```

- [ ] **Step 7: Build, fix any fallout in cards/handlers.go**

`handlers.go` calls `Repo.List(uid)`, `Repo.Update(uid, id, ...)`, etc. Do NOT fully rewrite `handlers.go` here — that happens in Tasks 10/11 where authorization is plugged in. For now, make it compile by adjusting call sites to the new repo signatures with a **temporary** `uid` guard:

```go
// Temporary: fetch card, confirm user_id match, then call new repo methods.
func (h *Handlers) fetchAuthzCard(uid, id uuid.UUID) (*Card, int, string) {
	card, err := h.Repo.GetByID(id)
	if err == sql.ErrNoRows {
		return nil, 404, "not found"
	}
	if err != nil {
		return nil, 500, "read failed"
	}
	// Personal-only until Task 10 replaces this with workspace-aware authz.
	if card.WorkspaceID != nil || card.UserID != uid { // see step 8 below
		return nil, 403, "forbidden"
	}
	return card, 0, ""
}
```

Wait — `Card` doesn't expose `UserID` in the struct. Instead, keep the user_id guard by preserving the old `Update/Delete/SetImage/etc` shapes **for this task**, and only introduce the new signatures in Task 10. Revert step 6 of this task if necessary — in practice, make the repo changes additive: keep the old `Update(userID, id, ...)` as `UpdateForUser` and add new `Update(id, ...)` alongside. This way nothing in `handlers.go` breaks yet.

Concretely, in `cards.go`, ADD (don't replace):

```go
// UpdateForUser preserved for Task 4 compatibility; removed in Task 10.
func (r *Repo) UpdateForUser(userID, id uuid.UUID, in UpdateInput) (*Card, error) {
	// existing body from repo
}

// Update (new) — authz must happen in caller.
func (r *Repo) Update(id uuid.UUID, in UpdateInput) (*Card, error) { /* new */ }
```

Same for `Delete/SetImage/ClearImage/GetImage/GetSecret/List`. Task 10 removes the `ForUser` variants once handlers are migrated.

Run: `cd backend && go build ./... && go test ./...`
Expected: success.

- [ ] **Step 8: Commit**

```bash
git add backend/internal/cards/
git commit -m "cards: add workspace_id, workspace-aware repo methods (parallel to ForUser)"
```

---

### Task 5: Card serializer (viewer redaction)

**Files:**
- Create: `backend/internal/cards/serializer.go`
- Create: `backend/internal/cards/serializer_test.go`

- [ ] **Step 1: Write failing test**

`serializer_test.go`:

```go
package cards

import (
	"testing"
)

func TestRedactForViewer_SecretNote(t *testing.T) {
	c := Card{CardType: "note", IsSecret: true, Text: "my secret"}
	got := RedactForRole(c, "viewer")
	if got.Text != "" {
		t.Fatalf("expected redacted text, got %q", got.Text)
	}
}

func TestRedactForViewer_Password(t *testing.T) {
	c := Card{CardType: "password", Text: "hunter2"}
	got := RedactForRole(c, "viewer")
	if got.Text != "" {
		t.Fatalf("expected redacted text, got %q", got.Text)
	}
}

func TestRedactForViewer_TotpNameKeptSecretDropped(t *testing.T) {
	c := Card{CardType: "totp", TotpName: "GitHub"}
	got := RedactForRole(c, "viewer")
	if got.TotpName != "GitHub" {
		t.Fatalf("totp_name should survive, got %q", got.TotpName)
	}
}

func TestRedact_EditorUnchanged(t *testing.T) {
	c := Card{CardType: "password", Text: "hunter2"}
	got := RedactForRole(c, "editor")
	if got.Text != "hunter2" {
		t.Fatalf("editor should see real text, got %q", got.Text)
	}
}
```

- [ ] **Step 2: Run — expect failure**

Run: `cd backend && go test ./internal/cards -run Redact`
Expected: FAIL (undefined: RedactForRole).

- [ ] **Step 3: Implement serializer**

`serializer.go`:

```go
package cards

// RedactForRole returns a copy of card with secret fields stripped if
// role is "viewer". Other roles see the card unchanged.
// TOTP codes/secrets are separately gated by endpoint — viewers are
// simply not allowed to call /totps/:id via authz layer.
func RedactForRole(c Card, role string) Card {
	if role != "viewer" {
		return c
	}
	switch c.CardType {
	case "password":
		c.Text = ""
	case "note":
		if c.IsSecret {
			c.Text = ""
		}
	}
	// totp: name stays, code/seed never in Card anyway.
	return c
}

// RedactList maps RedactForRole over a slice.
func RedactList(list []Card, role string) []Card {
	if role != "viewer" {
		return list
	}
	out := make([]Card, len(list))
	for i, c := range list {
		out[i] = RedactForRole(c, role)
	}
	return out
}
```

- [ ] **Step 4: Run — expect pass**

Run: `cd backend && go test ./internal/cards -run Redact -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/cards/serializer.go backend/internal/cards/serializer_test.go
git commit -m "cards: viewer-role redaction for secret/password cards"
```

---

## Phase 2 — Backend workspace HTTP

### Task 6: Workspace HTTP handlers

**Files:**
- Create: `backend/internal/workspaces/handlers.go`

- [ ] **Step 1: Write handlers struct and List/Create**

```go
package workspaces

import (
	"database/sql"
	"errors"

	nikologs "github.com/M1z23r/nikologs-go"
	"github.com/google/uuid"
	"github.com/m1z23r/drift/pkg/drift"
	"github.com/m1z23r/nikohub/internal/auth"
	"github.com/m1z23r/nikohub/internal/httpx"
)

type Handlers struct {
	Repo *Repo
	Log  *nikologs.Client
}

func (h *Handlers) List(c *drift.Context) {
	uid := auth.UserID(c)
	list, err := h.Repo.ListForUser(uid)
	if err != nil {
		httpx.Err(c, 500, "list failed")
		return
	}
	c.JSON(200, list)
}

type createReq struct {
	Name string `json:"name"`
}

func (h *Handlers) Create(c *drift.Context) {
	uid := auth.UserID(c)
	var in createReq
	if err := c.BindJSON(&in); err != nil || in.Name == "" {
		httpx.Err(c, 400, "bad json")
		return
	}
	w, err := h.Repo.Create(uid, in.Name)
	if err != nil {
		httpx.Err(c, 500, "create failed")
		return
	}
	c.JSON(201, w)
}
```

- [ ] **Step 2: Add Patch (rename/rotate/disable codes)**

```go
type patchReq struct {
	Name               *string `json:"name,omitempty"`
	RotateViewerCode   bool    `json:"rotate_viewer_code,omitempty"`
	RotateEditorCode   bool    `json:"rotate_editor_code,omitempty"`
	DisableViewerCode  bool    `json:"disable_viewer_code,omitempty"`
	DisableEditorCode  bool    `json:"disable_editor_code,omitempty"`
}

type patchResp struct {
	ViewerCode *string `json:"viewer_code,omitempty"`
	EditorCode *string `json:"editor_code,omitempty"`
}

func (h *Handlers) Patch(c *drift.Context) {
	uid := auth.UserID(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Err(c, 400, "bad id")
		return
	}
	var in patchReq
	if err := c.BindJSON(&in); err != nil {
		httpx.Err(c, 400, "bad json")
		return
	}

	resp := patchResp{}

	if in.Name != nil {
		if err := h.Repo.Rename(uid, id, *in.Name); err != nil {
			writeErr(c, err)
			return
		}
	}
	if in.RotateViewerCode {
		code, err := h.Repo.RotateCode(uid, id, CodeViewer)
		if err != nil {
			writeErr(c, err)
			return
		}
		resp.ViewerCode = &code
	}
	if in.RotateEditorCode {
		code, err := h.Repo.RotateCode(uid, id, CodeEditor)
		if err != nil {
			writeErr(c, err)
			return
		}
		resp.EditorCode = &code
	}
	if in.DisableViewerCode {
		if err := h.Repo.DisableCode(uid, id, CodeViewer); err != nil {
			writeErr(c, err)
			return
		}
	}
	if in.DisableEditorCode {
		if err := h.Repo.DisableCode(uid, id, CodeEditor); err != nil {
			writeErr(c, err)
			return
		}
	}
	c.JSON(200, resp)
}

func writeErr(c *drift.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		httpx.Err(c, 404, "not found")
	case errors.Is(err, ErrForbidden):
		httpx.Err(c, 403, "forbidden")
	case errors.Is(err, ErrNotOwner):
		httpx.Err(c, 403, "forbidden")
	case errors.Is(err, sql.ErrNoRows):
		httpx.Err(c, 404, "not found")
	default:
		httpx.Err(c, 500, "error")
	}
}
```

- [ ] **Step 3: Add Delete, Join, Members, Kick, Leave**

```go
func (h *Handlers) Delete(c *drift.Context) {
	uid := auth.UserID(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Err(c, 400, "bad id")
		return
	}
	if err := h.Repo.Delete(uid, id); err != nil {
		writeErr(c, err)
		return
	}
	c.Status(204)
}

type joinReq struct {
	Code string `json:"code"`
}

func (h *Handlers) Join(c *drift.Context) {
	uid := auth.UserID(c)
	var in joinReq
	if err := c.BindJSON(&in); err != nil || in.Code == "" {
		httpx.Err(c, 400, "bad json")
		return
	}
	w, err := h.Repo.JoinByCode(uid, in.Code)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(200, w)
}

func (h *Handlers) Members(c *drift.Context) {
	uid := auth.UserID(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Err(c, 400, "bad id")
		return
	}
	list, err := h.Repo.ListMembers(uid, id)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(200, list)
}

func (h *Handlers) Kick(c *drift.Context) {
	uid := auth.UserID(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Err(c, 400, "bad id")
		return
	}
	member, err := uuid.Parse(c.Param("userId"))
	if err != nil {
		httpx.Err(c, 400, "bad user id")
		return
	}
	if err := h.Repo.KickMember(uid, id, member); err != nil {
		writeErr(c, err)
		return
	}
	c.Status(204)
}

func (h *Handlers) Leave(c *drift.Context) {
	uid := auth.UserID(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Err(c, 400, "bad id")
		return
	}
	if err := h.Repo.Leave(uid, id); err != nil {
		writeErr(c, err)
		return
	}
	c.Status(204)
}
```

- [ ] **Step 4: Build**

Run: `cd backend && go build ./...`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/workspaces/handlers.go
git commit -m "workspaces: HTTP handlers for list/create/patch/delete/join/members"
```

---

### Task 7: Wire workspace routes in main.go

**Files:**
- Modify: `backend/cmd/server/main.go`

- [ ] **Step 1: Add import and repo instantiation**

After `colorRepo := cardtypecolors.NewRepo(pg)`:

```go
wsRepo := workspaces.NewRepo(pg)
```

And:

```go
wsH := &workspaces.Handlers{Repo: wsRepo, Log: nlog}
```

Add the import `"github.com/m1z23r/nikohub/internal/workspaces"`.

- [ ] **Step 2: Register routes**

After existing protected routes, add:

```go
api.Get("/workspaces", auth.RequireAccess(secret), wsH.List)
api.Post("/workspaces", auth.RequireAccess(secret), wsH.Create)
api.Patch("/workspaces/:id", auth.RequireAccess(secret), wsH.Patch)
api.Delete("/workspaces/:id", auth.RequireAccess(secret), wsH.Delete)
api.Post("/workspaces/join", auth.RequireAccess(secret), wsH.Join)
api.Get("/workspaces/:id/members", auth.RequireAccess(secret), wsH.Members)
api.Delete("/workspaces/:id/members/me", auth.RequireAccess(secret), wsH.Leave)
api.Delete("/workspaces/:id/members/:userId", auth.RequireAccess(secret), wsH.Kick)
```

- [ ] **Step 3: Build and run smoke test**

Run: `cd backend && go build ./... && ./bin/nikohub &`
Then in another shell, with a valid session cookie/bearer (use the browser app), verify `GET /api/v1/workspaces` returns `[]`.

- [ ] **Step 4: Commit**

```bash
git add backend/cmd/server/main.go
git commit -m "wire workspace routes"
```

---

## Phase 3 — Backend card endpoint updates

### Task 8: Workspace-aware card List + Create

**Files:**
- Modify: `backend/internal/cards/handlers.go`
- Modify: `backend/cmd/server/main.go`

- [ ] **Step 1: Inject workspaces.Repo into card Handlers**

Add field to `cards.Handlers`:

```go
type Handlers struct {
	Repo      *Repo
	Workspaces *workspaces.Repo
	Log       *nikologs.Client
}
```

Update `main.go`:

```go
cardH := &cards.Handlers{Repo: cardRepo, Workspaces: wsRepo, Log: nlog}
```

(Add `"github.com/m1z23r/nikohub/internal/workspaces"` import to the cards package.)

- [ ] **Step 2: Add scope helper**

In `cards/handlers.go`:

```go
// resolveScope returns (workspaceID, role, httpStatus, message).
// workspaceID == nil means personal scope.
// role is "personal", "owner", "editor", or "viewer".
func (h *Handlers) resolveScope(c *drift.Context, uid uuid.UUID, raw string) (*uuid.UUID, string, int, string) {
	if raw == "" || raw == "personal" {
		return nil, "personal", 0, ""
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return nil, "", 400, "bad workspace id"
	}
	role, err := h.Workspaces.AuthorizeWorkspace(uid, id)
	if err != nil {
		if errors.Is(err, workspaces.ErrForbidden) || errors.Is(err, workspaces.ErrNotFound) {
			return nil, "", 403, "forbidden"
		}
		return nil, "", 500, "authz error"
	}
	return &id, string(role), 0, ""
}
```

- [ ] **Step 3: Replace List**

```go
func (h *Handlers) List(c *drift.Context) {
	uid := auth.UserID(c)
	wsID, role, code, msg := h.resolveScope(c, uid, c.Query("workspace_id"))
	if code != 0 {
		httpx.Err(c, code, msg)
		return
	}
	var list []Card
	var err error
	if wsID == nil {
		list, err = h.Repo.ListPersonal(uid)
	} else {
		list, err = h.Repo.ListWorkspace(*wsID)
	}
	if err != nil {
		httpx.Err(c, 500, "list failed")
		return
	}
	c.JSON(200, RedactList(list, role))
}
```

- [ ] **Step 4: Replace Create**

Add `WorkspaceID *string \`json:"workspace_id,omitempty"\`` to `createReq`. In `Create`:

```go
func (h *Handlers) Create(c *drift.Context) {
	uid := auth.UserID(c)
	var in createReq
	if err := c.BindJSON(&in); err != nil {
		httpx.Err(c, 400, "bad json")
		return
	}
	wsRaw := ""
	if in.WorkspaceID != nil {
		wsRaw = *in.WorkspaceID
	}
	wsID, role, code, msg := h.resolveScope(c, uid, wsRaw)
	if code != 0 {
		httpx.Err(c, code, msg)
		return
	}
	if wsID != nil && role == string(workspaces.RoleViewer) {
		httpx.Err(c, 403, "viewers cannot create")
		return
	}
	if in.CardType == "totp" && in.TotpSecret == "" {
		httpx.Err(c, 400, "totp_secret required for totp card")
		return
	}
	card, err := h.Repo.Create(uid, CreateInput{
		WorkspaceID: wsID,
		X: in.X, Y: in.Y, Width: in.Width, Height: in.Height,
		Color: in.Color, Text: in.Text, Title: in.Title,
		CardType: in.CardType, IsSecret: in.IsSecret,
		TotpSecret: in.TotpSecret, TotpName: in.TotpName,
	})
	if err != nil {
		log.Printf("CREATE CARD ERROR: %v", err)
		httpx.Err(c, 500, "create failed")
		return
	}
	c.JSON(201, RedactForRole(*card, role))
}
```

- [ ] **Step 5: Build**

Run: `cd backend && go build ./...`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/cards/handlers.go backend/cmd/server/main.go
git commit -m "cards: workspace-aware List/Create with viewer redaction"
```

---

### Task 9: Workspace-aware card Patch, Delete, Images, TOTP

**Files:**
- Modify: `backend/internal/cards/handlers.go`
- Modify: `backend/internal/cards/cards.go` (remove `ForUser` variants once all callers are migrated)

- [ ] **Step 1: Add authorizeCard helper**

In `cards/handlers.go`:

```go
// authorizeCard loads the card and returns (card, role, 0, "") on success
// or (nil, "", status, message) on failure. "role" is "personal", "owner",
// "editor", or "viewer".
func (h *Handlers) authorizeCard(uid, cardID uuid.UUID) (*Card, string, int, string) {
	card, err := h.Repo.GetByID(cardID)
	if err == sql.ErrNoRows {
		return nil, "", 404, "not found"
	}
	if err != nil {
		return nil, "", 500, "lookup failed"
	}
	if card.WorkspaceID == nil {
		// Personal: must be same user.
		ownerID, err := h.Repo.OwnerOfPersonal(cardID)
		if err != nil || ownerID != uid {
			return nil, "", 403, "forbidden"
		}
		return card, "personal", 0, ""
	}
	role, err := h.Workspaces.AuthorizeWorkspace(uid, *card.WorkspaceID)
	if err != nil {
		return nil, "", 403, "forbidden"
	}
	return card, string(role), 0, ""
}
```

Add to `cards/cards.go`:

```go
func (r *Repo) OwnerOfPersonal(id uuid.UUID) (uuid.UUID, error) {
	var uid uuid.UUID
	err := r.db.QueryRow(
		`SELECT user_id FROM cards WHERE id=$1 AND workspace_id IS NULL`, id,
	).Scan(&uid)
	return uid, err
}
```

- [ ] **Step 2: Replace Patch**

```go
func (h *Handlers) Patch(c *drift.Context) {
	uid := auth.UserID(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Err(c, 400, "bad id")
		return
	}
	_, role, code, msg := h.authorizeCard(uid, id)
	if code != 0 {
		httpx.Err(c, code, msg)
		return
	}
	if role == string(workspaces.RoleViewer) {
		httpx.Err(c, 403, "viewers cannot edit")
		return
	}
	var in patchReq
	if err := c.BindJSON(&in); err != nil {
		httpx.Err(c, 400, "bad json")
		return
	}
	// ... existing container_id parsing unchanged ...
	card, err := h.Repo.Update(id, UpdateInput{
		X: in.X, Y: in.Y, Width: in.Width, Height: in.Height, ZIndex: in.ZIndex,
		SidebarOrder: in.SidebarOrder,
		Color: in.Color, Text: in.Text, Title: in.Title, IsSecret: in.IsSecret, IsFavorite: in.IsFavorite,
		ContainerID: containerID, ClearContainerID: clearContainerID,
	})
	if err == sql.ErrNoRows {
		httpx.Err(c, 404, "not found")
		return
	}
	if err != nil {
		log.Printf("UPDATE CARD ERROR: %v", err)
		httpx.Err(c, 500, "update failed")
		return
	}
	c.JSON(200, RedactForRole(*card, role))
}
```

- [ ] **Step 3: Replace Delete, UploadImage, DeleteImage, GetImage, GetTOTP, GetAllTOTP**

Same pattern: call `authorizeCard(uid, id)`, gate viewers out of mutations, call repo with just `id`. For reads (`GetImage`), viewers are allowed (an image card's content isn't marked secret today — treat it as non-secret). For `GetTOTP` / `GetAllTOTP`, viewers are **rejected** (secret).

For `GetAllTOTP` (no id in URL), take workspace_id from query string via `resolveScope`, reject viewer role, call `GetAllSecretsForScope(uid, wsID)`.

- [ ] **Step 4: Remove `ForUser` variants from repo, fix call sites**

Delete the temporary `UpdateForUser`, `DeleteForUser`, `SetImageForUser`, etc. Grep for any remaining callers; there should be none.

Run: `cd backend && go build ./... && go test ./...`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/cards/
git commit -m "cards: all handlers use workspace-aware authz; remove ForUser variants"
```

---

## Phase 4 — Backend realtime

### Task 10: Realtime hub with concurrency tests

**Files:**
- Create: `backend/internal/realtime/hub.go`
- Create: `backend/internal/realtime/hub_test.go`
- Create: `backend/internal/realtime/events.go`
- Create: `backend/internal/realtime/color.go`

- [ ] **Step 1: Events and colors**

`events.go`:

```go
package realtime

import (
	"encoding/json"

	"github.com/google/uuid"
)

type Event struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"-"`
}

// Pre-marshaled event; hub sends raw bytes.
type encoded struct {
	// Per-role payloads. "editor" includes owner.
	editorBytes []byte
	viewerBytes []byte
	// skipUser is never broadcast to this user id (e.g., broadcasting user for cursor echoes).
	skipUser *uuid.UUID
}
```

`color.go`:

```go
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
```

- [ ] **Step 2: Hub skeleton (single-goroutine, CSP-style)**

`hub.go`:

```go
package realtime

import (
	"sync/atomic"

	"github.com/google/uuid"
)

type Conn struct {
	UserID      uuid.UUID
	UserName    string
	Color       string
	Role        string // owner | editor | viewer
	WorkspaceID uuid.UUID
	send        chan []byte
	closed      atomic.Bool // used to prevent double writes from conn side
}

func (c *Conn) Send() <-chan []byte { return c.send }

type broadcastMsg struct {
	workspaceID uuid.UUID
	enc         encoded
}

type Hub struct {
	register   chan *Conn
	unregister chan *Conn
	broadcast  chan broadcastMsg
	done       chan struct{}
	rooms      map[uuid.UUID]map[*Conn]struct{} // only touched by Run()
}

func NewHub() *Hub {
	return &Hub{
		register:   make(chan *Conn, 32),
		unregister: make(chan *Conn, 32),
		broadcast:  make(chan broadcastMsg, 256),
		done:       make(chan struct{}),
		rooms:      make(map[uuid.UUID]map[*Conn]struct{}),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case <-h.done:
			for _, room := range h.rooms {
				for c := range room {
					h.closeConn(c)
				}
			}
			return
		case c := <-h.register:
			room, ok := h.rooms[c.WorkspaceID]
			if !ok {
				room = make(map[*Conn]struct{})
				h.rooms[c.WorkspaceID] = room
			}
			room[c] = struct{}{}
		case c := <-h.unregister:
			if room, ok := h.rooms[c.WorkspaceID]; ok {
				if _, present := room[c]; present {
					delete(room, c)
					h.closeConn(c)
					if len(room) == 0 {
						delete(h.rooms, c.WorkspaceID)
					}
				}
			}
		case msg := <-h.broadcast:
			room := h.rooms[msg.workspaceID]
			for c := range room {
				if msg.enc.skipUser != nil && *msg.enc.skipUser == c.UserID {
					continue
				}
				payload := msg.enc.editorBytes
				if c.Role == "viewer" {
					payload = msg.enc.viewerBytes
				}
				select {
				case c.send <- payload:
				default:
					// slow client — evict
					delete(room, c)
					h.closeConn(c)
				}
			}
			if len(room) == 0 {
				delete(h.rooms, msg.workspaceID)
			}
		}
	}
}

func (h *Hub) closeConn(c *Conn) {
	if c.closed.CompareAndSwap(false, true) {
		close(c.send)
	}
}

func (h *Hub) Stop() { close(h.done) }

func (h *Hub) Register(c *Conn) { h.register <- c }
func (h *Hub) Unregister(c *Conn) {
	select {
	case h.unregister <- c:
	case <-h.done:
	}
}

func (h *Hub) Broadcast(wsID uuid.UUID, editorPayload, viewerPayload []byte, skipUser *uuid.UUID) {
	select {
	case h.broadcast <- broadcastMsg{
		workspaceID: wsID,
		enc:         encoded{editorBytes: editorPayload, viewerBytes: viewerPayload, skipUser: skipUser},
	}:
	case <-h.done:
	}
}

// NewConn constructs a Conn with a buffered send channel.
func NewConn(userID uuid.UUID, userName string, role string, workspaceID uuid.UUID) *Conn {
	return &Conn{
		UserID:      userID,
		UserName:    userName,
		Color:       ColorFor(userID),
		Role:        role,
		WorkspaceID: workspaceID,
		send:        make(chan []byte, 32),
	}
}
```

- [ ] **Step 3: Write hub tests**

`hub_test.go`:

```go
package realtime

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestHub_BroadcastsToRoomExcludingSelf(t *testing.T) {
	h := NewHub()
	go h.Run()
	defer h.Stop()

	ws := uuid.New()
	me := uuid.New()
	peer := uuid.New()

	cSelf := NewConn(me, "me", "editor", ws)
	cPeer := NewConn(peer, "peer", "editor", ws)
	h.Register(cSelf)
	h.Register(cPeer)
	time.Sleep(10 * time.Millisecond) // let register land

	h.Broadcast(ws, []byte(`{"t":"x"}`), []byte(`{"t":"x"}`), &me)

	select {
	case msg := <-cPeer.Send():
		if string(msg) != `{"t":"x"}` {
			t.Fatalf("unexpected payload %s", string(msg))
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("peer did not receive")
	}

	select {
	case msg := <-cSelf.Send():
		t.Fatalf("self should not have received %s", string(msg))
	case <-time.After(50 * time.Millisecond):
	}
}

func TestHub_ViewerGetsRedactedPayload(t *testing.T) {
	h := NewHub()
	go h.Run()
	defer h.Stop()
	ws := uuid.New()
	v := NewConn(uuid.New(), "v", "viewer", ws)
	e := NewConn(uuid.New(), "e", "editor", ws)
	h.Register(v)
	h.Register(e)
	time.Sleep(10 * time.Millisecond)

	h.Broadcast(ws, []byte("EDIT"), []byte("VIEW"), nil)

	select {
	case m := <-v.Send():
		if string(m) != "VIEW" {
			t.Fatalf("viewer got %s", string(m))
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("viewer timeout")
	}
	select {
	case m := <-e.Send():
		if string(m) != "EDIT" {
			t.Fatalf("editor got %s", string(m))
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("editor timeout")
	}
}

func TestHub_UnregisterClosesSendOnce(t *testing.T) {
	h := NewHub()
	go h.Run()
	defer h.Stop()
	ws := uuid.New()
	c := NewConn(uuid.New(), "u", "editor", ws)
	h.Register(c)
	time.Sleep(10 * time.Millisecond)

	h.Unregister(c)
	// second unregister is a no-op — must not panic
	h.Unregister(c)
	time.Sleep(10 * time.Millisecond)

	// send should be closed
	if _, ok := <-c.Send(); ok {
		t.Fatal("expected closed send channel")
	}
}

func TestHub_SlowConsumerEvicted(t *testing.T) {
	h := NewHub()
	go h.Run()
	defer h.Stop()
	ws := uuid.New()
	c := NewConn(uuid.New(), "u", "editor", ws)
	h.Register(c)
	time.Sleep(10 * time.Millisecond)

	// Fill the send buffer (32) without draining.
	for i := 0; i < 40; i++ {
		h.Broadcast(ws, []byte("X"), []byte("X"), nil)
	}
	time.Sleep(50 * time.Millisecond)

	// eviction closes the send channel
	drained := 0
	for range c.Send() {
		drained++
		if drained > 32 {
			t.Fatal("send should have been closed")
		}
	}
}

func TestHub_StopIsClean(t *testing.T) {
	h := NewHub()
	go h.Run()
	ws := uuid.New()
	c := NewConn(uuid.New(), "u", "editor", ws)
	h.Register(c)
	time.Sleep(10 * time.Millisecond)

	h.Stop()
	time.Sleep(10 * time.Millisecond)

	if _, ok := <-c.Send(); ok {
		t.Fatal("expected send closed after Stop")
	}
}
```

- [ ] **Step 4: Run tests (with race detector)**

Run: `cd backend && go test -race ./internal/realtime/...`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/realtime/
git commit -m "realtime: CSP-style hub with race-tested broadcast/unregister/eviction"
```

---

### Task 11: WebSocket endpoint + read/write pumps

**Files:**
- Create: `backend/internal/realtime/handlers.go`
- Modify: `backend/cmd/server/main.go`

- [ ] **Step 1: Handler, upgrade, auth (using `drift/pkg/websocket`)**

`handlers.go`:

```go
package realtime

import (
	"encoding/json"
	"net/http"
	"time"

	nikologs "github.com/M1z23r/nikologs-go"
	"github.com/google/uuid"
	"github.com/m1z23r/drift/pkg/drift"
	"github.com/m1z23r/drift/pkg/middleware"
	driftws "github.com/m1z23r/drift/pkg/websocket"
	"github.com/m1z23r/nikohub/internal/auth"
	"github.com/m1z23r/nikohub/internal/httpx"
	"github.com/m1z23r/nikohub/internal/users"
	"github.com/m1z23r/nikohub/internal/workspaces"
)

type Handlers struct {
	Hub        *Hub
	Workspaces *workspaces.Repo
	Users      *users.Repo
	Log        *nikologs.Client
}

var upgrader = &driftws.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	ReadLimit:       1024,
	CheckOrigin:     func(r *http.Request) bool { return true }, // CORS already gates
}

const writeWait = 10 * time.Second

// Middleware returned from SkipCompression must be passed to the /ws route
// alongside auth.RequireAccess when registering. Exported helper for main.go.
func SkipCompression() drift.HandlerFunc { return middleware.SkipCompression() }

func (h *Handlers) Serve(c *drift.Context) {
	uid := auth.UserID(c)

	wsIDStr := c.Query("workspace_id")
	wsID, err := uuid.Parse(wsIDStr)
	if err != nil {
		httpx.Err(c, 400, "bad workspace_id")
		return
	}
	role, err := h.Workspaces.AuthorizeWorkspace(uid, wsID)
	if err != nil {
		httpx.Err(c, 403, "forbidden")
		return
	}

	user, err := h.Users.Get(uid)
	if err != nil {
		httpx.Err(c, 500, "user lookup failed")
		return
	}

	ws, err := upgrader.Upgrade(c)
	if err != nil {
		return // Upgrade writes its own response on failure
	}

	rtConn := NewConn(uid, user.Name, string(role), wsID)
	h.Hub.Register(rtConn)
	h.announceJoin(rtConn)

	defer func() {
		h.Hub.Unregister(rtConn)
		h.announceLeave(rtConn)
		ws.Close(driftws.CloseNormalClosure, "bye")
	}()

	// Write pump in its own goroutine (drift's Conn has separate read/write mutexes).
	writeDone := make(chan struct{})
	go func() {
		defer close(writeDone)
		h.writePump(ws, rtConn)
	}()

	// Read pump runs in the handler goroutine; blocks until the client
	// disconnects or sends a close frame.
	h.readPump(ws, rtConn)

	<-writeDone
}
```

- [ ] **Step 2: Read/write pumps**

Append:

```go
func (h *Handlers) writePump(ws *driftws.Conn, c *Conn) {
	for msg := range c.Send() {
		_ = ws.SetWriteDeadline(time.Now().Add(writeWait))
		if err := ws.WriteMessage(driftws.TextMessage, msg); err != nil {
			return
		}
	}
	// send channel closed by the hub — close the socket cleanly.
	_ = ws.SetWriteDeadline(time.Now().Add(writeWait))
	_ = ws.Close(driftws.CloseNormalClosure, "")
}

type inboundMsg struct {
	Type string  `json:"type"`
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
}

func (h *Handlers) readPump(ws *driftws.Conn, c *Conn) {
	for {
		_, data, err := ws.ReadMessage()
		if err != nil {
			return
		}
		var in inboundMsg
		if err := json.Unmarshal(data, &in); err != nil {
			continue
		}
		if in.Type == "cursor.move" {
			h.broadcastCursor(c, in.X, in.Y)
		}
		// Unknown types: drop silently.
	}
}
```

**Keepalive notes:** drift's `Conn.ReadMessage` auto-responds to incoming pings (see `pkg/websocket/websocket.go` `case OpPing`), so clients that ping us get ponged for free. We don't send server-originated pings — idle connections rely on TCP keepalive and client-side reconnection logic to recover from dropped links. For v1 single-instance deployment this is acceptable; revisit if "phantom peers" become a UX issue.

- [ ] **Step 3: Presence + cursor broadcasts**

Append:

```go
type presencePeer struct {
	UserID string `json:"userId"`
	Name   string `json:"name"`
	Color  string `json:"color"`
}

func (h *Handlers) announceJoin(c *Conn) {
	// Snapshot to self (HACK: hub doesn't expose room, so we do a minimal presence protocol:
	// server sends presence.snapshot built from a fresh query into the hub state via a
	// dedicated method).
	// For v1, we skip the snapshot and rely on joins being announced per-connection:
	// when a new peer arrives, existing peers get presence.join; the new peer receives
	// no snapshot but will receive presence.join events as others move (first cursor
	// move doubles as presence). This is acceptable for v1. Snapshot can be added later.
	msg, _ := json.Marshal(map[string]any{
		"type":   "presence.join",
		"userId": c.UserID.String(),
		"name":   c.UserName,
		"color":  c.Color,
	})
	h.Hub.Broadcast(c.WorkspaceID, msg, msg, &c.UserID)
}

func (h *Handlers) announceLeave(c *Conn) {
	msg, _ := json.Marshal(map[string]any{
		"type":   "presence.leave",
		"userId": c.UserID.String(),
	})
	h.Hub.Broadcast(c.WorkspaceID, msg, msg, &c.UserID)
}

func (h *Handlers) broadcastCursor(c *Conn, x, y float64) {
	msg, _ := json.Marshal(map[string]any{
		"type":   "cursor.move",
		"userId": c.UserID.String(),
		"name":   c.UserName,
		"color":  c.Color,
		"x":      x,
		"y":      y,
	})
	h.Hub.Broadcast(c.WorkspaceID, msg, msg, &c.UserID)
}
```

**Note on snapshot:** The v1 compromise is acceptable per the spec (presence is lossy on reconnect; clients refetch authoritative state from the DB). A follow-up task can add an explicit `Snapshot(ws)` method on the hub if we find the UX problematic.

- [ ] **Step 4: Use existing `users.Repo.Get(id)`**

The users package already exposes `Get(id uuid.UUID) (*User, error)` returning a `User` with `Name`. No new code here; the T11 Serve handler calls `h.Users.Get(uid)` — update the handler snippet from Step 1 to use `Get` (not `GetByID`):

```go
user, err := h.Users.Get(uid)
```

- [ ] **Step 5: Wire in main.go**

```go
hub := realtime.NewHub()
go hub.Run()

rtH := &realtime.Handlers{Hub: hub, Workspaces: wsRepo, Users: userRepo, Log: nlog}
api.Get("/ws", realtime.SkipCompression(), auth.RequireAccess(secret), rtH.Serve)
```

- [ ] **Step 6: Build + smoke**

Run: `cd backend && go build ./... && ./bin/nikohub &`
Expected: server starts, `GET /api/v1/ws?workspace_id=<id>` upgrades successfully when called from a browser with the cookie set (via the frontend's future websocket client — not easy to test by hand, will be validated in Task 24).

- [ ] **Step 7: Commit**

```bash
git add backend/internal/realtime/handlers.go backend/internal/users/users.go backend/cmd/server/main.go
git commit -m "realtime: /ws endpoint with read/write pumps, cursor + presence broadcasts"
```

---

### Task 12: Broadcast card mutations from handlers

**Files:**
- Modify: `backend/internal/cards/handlers.go`
- Modify: `backend/cmd/server/main.go`

- [ ] **Step 1: Add Hub field to cards.Handlers**

```go
type Handlers struct {
	Repo       *Repo
	Workspaces *workspaces.Repo
	Hub        *realtime.Hub
	Log        *nikologs.Client
}
```

Wire in main.go:

```go
cardH := &cards.Handlers{Repo: cardRepo, Workspaces: wsRepo, Hub: hub, Log: nlog}
```

Add import `"github.com/m1z23r/nikohub/internal/realtime"`.

- [ ] **Step 2: Add broadcast helper**

In `handlers.go`:

```go
func (h *Handlers) broadcastCard(wsID *uuid.UUID, eventType string, card Card, actorID uuid.UUID) {
	if wsID == nil || h.Hub == nil {
		return
	}
	editorBytes, _ := json.Marshal(map[string]any{
		"type": eventType,
		"card": card,
		"by":   actorID.String(),
	})
	viewerBytes, _ := json.Marshal(map[string]any{
		"type": eventType,
		"card": RedactForRole(card, "viewer"),
		"by":   actorID.String(),
	})
	h.Hub.Broadcast(*wsID, editorBytes, viewerBytes, nil)
}

func (h *Handlers) broadcastDelete(wsID *uuid.UUID, cardID uuid.UUID, actorID uuid.UUID) {
	if wsID == nil || h.Hub == nil {
		return
	}
	msg, _ := json.Marshal(map[string]any{
		"type": "card.deleted",
		"id":   cardID.String(),
		"by":   actorID.String(),
	})
	h.Hub.Broadcast(*wsID, msg, msg, nil)
}
```

(Add `"encoding/json"` import.)

- [ ] **Step 3: Call broadcasts after successful mutations**

In `Create`, after `c.JSON(201, …)`:

```go
h.broadcastCard(card.WorkspaceID, "card.created", *card, uid)
```

In `Patch`, after `c.JSON(200, …)`:

```go
h.broadcastCard(card.WorkspaceID, "card.updated", *card, uid)
```

In `Delete`, before `c.Status(204)`, capture the card first via `GetByID` to know its workspace_id; after successful delete:

```go
h.broadcastDelete(card.WorkspaceID, id, uid)
```

In `UploadImage`/`DeleteImage`, after success, re-fetch the card and broadcast `card.updated`.

- [ ] **Step 4: Build + test**

Run: `cd backend && go build ./... && go test -race ./...`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/cards/handlers.go backend/cmd/server/main.go
git commit -m "cards: broadcast create/update/delete/image events to workspace peers"
```

---

## Phase 5 — Frontend service + UI foundation

### Task 13: WorkspaceService

**Files:**
- Create: `frontend/src/app/core/workspace/workspace.service.ts`

- [ ] **Step 1: Write service**

```typescript
import { Injectable, computed, signal } from '@angular/core';
import { http } from '../api/http';

export type WorkspaceRole = 'owner' | 'editor' | 'viewer';

export interface IWorkspace {
  id: string | null;
  owner_id?: string;
  name: string;
  role: WorkspaceRole;
  viewer_code?: string | null;
  editor_code?: string | null;
}

export interface IWorkspaceMember {
  user_id: string;
  name: string;
  email: string;
  role: 'viewer' | 'editor';
}

const PERSONAL: IWorkspace = { id: null, name: 'Personal', role: 'owner' };

@Injectable({ providedIn: 'root' })
export class WorkspaceService {
  private base = '/workspaces';
  private _list = signal<IWorkspace[]>([PERSONAL]);
  private _activeId = signal<string | null>(null);

  readonly list = this._list.asReadonly();
  readonly activeId = this._activeId.asReadonly();
  readonly active = computed<IWorkspace>(() => {
    return this._list().find((w) => w.id === this._activeId()) ?? PERSONAL;
  });

  async load(): Promise<void> {
    const { data } = await http.get<IWorkspace[]>(this.base);
    this._list.set([PERSONAL, ...data]);
  }

  async create(name: string): Promise<IWorkspace> {
    const { data } = await http.post<IWorkspace>(this.base, { name });
    this._list.update((l) => [...l, data]);
    return data;
  }

  async join(code: string): Promise<IWorkspace> {
    const { data } = await http.post<IWorkspace>(`${this.base}/join`, { code });
    this._list.update((l) => {
      const existing = l.findIndex((w) => w.id === data.id);
      if (existing >= 0) {
        const next = [...l];
        next[existing] = { ...next[existing], ...data };
        return next;
      }
      return [...l, data];
    });
    return data;
  }

  async rename(id: string, name: string): Promise<void> {
    await http.patch(`${this.base}/${id}`, { name });
    this._list.update((l) => l.map((w) => (w.id === id ? { ...w, name } : w)));
  }

  async rotateCode(id: string, kind: 'viewer' | 'editor'): Promise<string> {
    const body = kind === 'viewer' ? { rotate_viewer_code: true } : { rotate_editor_code: true };
    const { data } = await http.patch<{ viewer_code?: string; editor_code?: string }>(
      `${this.base}/${id}`,
      body,
    );
    const code = kind === 'viewer' ? data.viewer_code! : data.editor_code!;
    this._list.update((l) =>
      l.map((w) => (w.id === id ? { ...w, [`${kind}_code`]: code } as IWorkspace : w)),
    );
    return code;
  }

  async disableCode(id: string, kind: 'viewer' | 'editor'): Promise<void> {
    const body = kind === 'viewer' ? { disable_viewer_code: true } : { disable_editor_code: true };
    await http.patch(`${this.base}/${id}`, body);
    this._list.update((l) =>
      l.map((w) => (w.id === id ? { ...w, [`${kind}_code`]: null } as IWorkspace : w)),
    );
  }

  async delete(id: string): Promise<void> {
    await http.delete(`${this.base}/${id}`);
    this._list.update((l) => l.filter((w) => w.id !== id));
    if (this._activeId() === id) this._activeId.set(null);
  }

  async leave(id: string): Promise<void> {
    await http.delete(`${this.base}/${id}/members/me`);
    this._list.update((l) => l.filter((w) => w.id !== id));
    if (this._activeId() === id) this._activeId.set(null);
  }

  async members(id: string): Promise<IWorkspaceMember[]> {
    const { data } = await http.get<IWorkspaceMember[]>(`${this.base}/${id}/members`);
    return data;
  }

  async kick(id: string, userId: string): Promise<void> {
    await http.delete(`${this.base}/${id}/members/${userId}`);
  }

  setActive(id: string | null): void {
    this._activeId.set(id);
  }
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc -p tsconfig.app.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/core/workspace/workspace.service.ts
git commit -m "frontend: WorkspaceService with signal store + HTTP wiring"
```

---

### Task 14: Update CardService to scope by workspace

**Files:**
- Modify: `frontend/src/app/core/api/card.service.ts`

- [ ] **Step 1: Extend ICard**

Add `workspace_id: string | null;` to the interface.

- [ ] **Step 2: Accept workspaceId in list/create/createTotp/getAllTotp**

```typescript
async list(workspaceId: string | null): Promise<ICard[]> {
  const qs = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';
  const { data } = await http.get<ICard[]>(`${this.base}${qs}`);
  return data;
}

async create(body: {
  workspace_id: string | null;
  x: number;
  y: number;
  // ... rest unchanged ...
}): Promise<ICard> {
  const payload: any = { ...body };
  if (body.workspace_id === null) delete payload.workspace_id;
  const { data } = await http.post<ICard>(this.base, payload);
  return data;
}

async createTotp(body: {
  workspace_id: string | null;
  x: number;
  y: number;
  color?: string;
  totp_secret: string;
  totp_name: string;
}): Promise<ICard> {
  const payload: any = { ...body, card_type: 'totp' };
  if (body.workspace_id === null) delete payload.workspace_id;
  const { data } = await http.post<ICard>(this.base, payload);
  return data;
}

async getAllTotp(workspaceId: string | null): Promise<ITotpBatchResponse> {
  const qs = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';
  const { data } = await http.get<ITotpBatchResponse>(`${this.totpBase}${qs}`);
  return data;
}
```

- [ ] **Step 3: Fix all call sites**

Grep `card.service.ts` callers: `cd frontend && grep -rn "cardService" src/app`. Every `.list()` / `.create()` / `.getAllTotp()` call must pass the active workspace id.

Simplest pattern: inject `WorkspaceService` in callers and pass `workspaceService.active().id`.

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc -p tsconfig.app.json --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/core/api/card.service.ts frontend/src/app/
git commit -m "frontend: CardService scoped by workspace_id"
```

---

### Task 15: Left workspace sidebar component

**Files:**
- Create: `frontend/src/app/components/workspace-sidebar/workspace-sidebar.ts`
- Create: `frontend/src/app/components/workspace-sidebar/workspace-sidebar.html`
- Create: `frontend/src/app/components/workspace-sidebar/workspace-sidebar.css`

- [ ] **Step 1: Component class**

`workspace-sidebar.ts`:

```typescript
import { Component, inject, signal } from '@angular/core';
import { WorkspaceService, IWorkspace } from '../../core/workspace/workspace.service';
import { WorkspaceDialog } from '../workspace-dialog/workspace-dialog';

@Component({
  selector: 'app-workspace-sidebar',
  standalone: true,
  imports: [WorkspaceDialog],
  templateUrl: './workspace-sidebar.html',
  styleUrl: './workspace-sidebar.css',
})
export class WorkspaceSidebar {
  private svc = inject(WorkspaceService);

  readonly list = this.svc.list;
  readonly activeId = this.svc.activeId;
  readonly dialogOpen = signal(false);
  readonly menuFor = signal<IWorkspace | null>(null);

  select(w: IWorkspace): void {
    this.svc.setActive(w.id);
  }

  openDialog(): void {
    this.dialogOpen.set(true);
  }

  toggleMenu(w: IWorkspace, ev: MouseEvent): void {
    ev.stopPropagation();
    this.menuFor.update((m) => (m?.id === w.id ? null : w));
  }

  async leave(w: IWorkspace): Promise<void> {
    if (!w.id) return;
    this.menuFor.set(null);
    await this.svc.leave(w.id);
  }
}
```

- [ ] **Step 2: Template**

`workspace-sidebar.html`:

```html
<div class="ws-sidebar">
  @for (w of list(); track w.id ?? 'personal') {
    <div class="ws-row"
         [class.active]="activeId() === w.id"
         (click)="select(w)">
      <span class="ws-name">{{ w.name }}</span>
      @if (w.id) {
        <button class="ws-menu-btn"
                (click)="toggleMenu(w, $event)"
                aria-label="Workspace actions">…</button>
      }
      @if (menuFor()?.id === w.id) {
        <div class="ws-menu" (click)="$event.stopPropagation()">
          @if (w.role === 'owner') {
            <!-- Owner menu is filled in by Task 17 -->
            <span class="ws-menu-placeholder">Owner menu (Task 17)</span>
          } @else {
            <button (click)="leave(w)">Leave</button>
          }
        </div>
      }
    </div>
  }
  <button class="ws-add" (click)="openDialog()">+</button>
</div>

@if (dialogOpen()) {
  <app-workspace-dialog (closed)="dialogOpen.set(false)" />
}
```

- [ ] **Step 3: Styles**

`workspace-sidebar.css`:

```css
.ws-sidebar {
  position: fixed;
  top: 60px;
  left: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 20;
}
.ws-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(255,255,255,0.9);
  border: 1px solid #d4d4d8;
  border-radius: 6px;
  cursor: pointer;
  min-width: 140px;
}
.ws-row.active { background: #fde68a; }
.ws-row:hover .ws-menu-btn { opacity: 1; }
.ws-menu-btn {
  opacity: 0;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 16px;
  padding: 0 4px;
}
.ws-menu {
  position: absolute;
  top: 100%;
  left: 0;
  background: white;
  border: 1px solid #d4d4d8;
  border-radius: 6px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
  z-index: 21;
}
.ws-add {
  padding: 6px 10px;
  background: #a7f3d0;
  border: 1px solid #6ee7b7;
  border-radius: 6px;
  cursor: pointer;
  font-size: 18px;
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/components/workspace-sidebar/
git commit -m "frontend: left workspace sidebar (skeleton — owner menu placeholder)"
```

---

### Task 16: Create/Join dialog

**Files:**
- Create: `frontend/src/app/components/workspace-dialog/workspace-dialog.ts`
- Create: `frontend/src/app/components/workspace-dialog/workspace-dialog.html`
- Create: `frontend/src/app/components/workspace-dialog/workspace-dialog.css`

- [ ] **Step 1: Component**

```typescript
import { Component, inject, output, signal } from '@angular/core';
import { WorkspaceService } from '../../core/workspace/workspace.service';

@Component({
  selector: 'app-workspace-dialog',
  standalone: true,
  templateUrl: './workspace-dialog.html',
  styleUrl: './workspace-dialog.css',
})
export class WorkspaceDialog {
  private svc = inject(WorkspaceService);
  readonly closed = output<void>();

  readonly name = signal('');
  readonly code = signal('');
  readonly busy = signal(false);
  readonly error = signal('');

  async create(): Promise<void> {
    const n = this.name().trim();
    if (!n || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const ws = await this.svc.create(n);
      this.svc.setActive(ws.id);
      this.closed.emit();
    } catch {
      this.error.set('Could not create workspace');
    } finally {
      this.busy.set(false);
    }
  }

  async join(): Promise<void> {
    const c = this.code().trim();
    if (!c || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const ws = await this.svc.join(c);
      this.svc.setActive(ws.id);
      this.closed.emit();
    } catch {
      this.error.set('Invalid or disabled code');
    } finally {
      this.busy.set(false);
    }
  }

  dismiss(): void {
    this.closed.emit();
  }
}
```

- [ ] **Step 2: Template**

```html
<div class="backdrop" (click)="dismiss()"></div>
<div class="dialog" (click)="$event.stopPropagation()">
  <h3>New workspace</h3>
  <input placeholder="Workspace name" [value]="name()" (input)="name.set($any($event.target).value)" />
  <button (click)="create()" [disabled]="!name().trim() || busy()">Create</button>

  <hr />

  <h3>Or join</h3>
  <input placeholder="Invite code" [value]="code()" (input)="code.set($any($event.target).value)" />
  <button (click)="join()" [disabled]="!code().trim() || busy()">Join</button>

  @if (error()) { <div class="err">{{ error() }}</div> }

  <button class="close" (click)="dismiss()">Close</button>
</div>
```

- [ ] **Step 3: Styles**

```css
.backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 40;
}
.dialog {
  position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%);
  background: white; padding: 16px 20px; border-radius: 8px;
  display: flex; flex-direction: column; gap: 8px;
  min-width: 320px; z-index: 41;
}
.dialog h3 { margin: 0; font-size: 14px; }
.dialog input { padding: 6px 8px; border: 1px solid #d4d4d8; border-radius: 4px; }
.dialog hr { width: 100%; border: none; border-top: 1px solid #e5e7eb; margin: 8px 0; }
.dialog .err { color: #b91c1c; font-size: 12px; }
.dialog .close { margin-top: 8px; }
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/components/workspace-dialog/
git commit -m "frontend: create/join workspace dialog"
```

---

### Task 17: Owner menu — rename, invite codes, members, delete

**Files:**
- Create: `frontend/src/app/components/workspace-settings/workspace-settings.ts`
- Create: `frontend/src/app/components/workspace-settings/workspace-settings.html`
- Create: `frontend/src/app/components/workspace-settings/workspace-settings.css`
- Modify: `frontend/src/app/components/workspace-sidebar/workspace-sidebar.ts`
- Modify: `frontend/src/app/components/workspace-sidebar/workspace-sidebar.html`

- [ ] **Step 1: Settings component**

`workspace-settings.ts`:

```typescript
import { Component, inject, input, output, signal } from '@angular/core';
import { WorkspaceService, IWorkspace, IWorkspaceMember } from '../../core/workspace/workspace.service';

type Pane = 'rename' | 'codes' | 'members' | 'delete';

@Component({
  selector: 'app-workspace-settings',
  standalone: true,
  templateUrl: './workspace-settings.html',
  styleUrl: './workspace-settings.css',
})
export class WorkspaceSettings {
  private svc = inject(WorkspaceService);
  readonly workspace = input.required<IWorkspace>();
  readonly closed = output<void>();

  readonly pane = signal<Pane>('rename');
  readonly renameValue = signal('');
  readonly members = signal<IWorkspaceMember[] | null>(null);
  readonly confirmName = signal('');
  readonly busy = signal(false);
  readonly error = signal('');

  open(p: Pane): void {
    this.pane.set(p);
    this.error.set('');
    if (p === 'rename') this.renameValue.set(this.workspace().name);
    if (p === 'members') this.loadMembers();
    if (p === 'delete') this.confirmName.set('');
  }

  async rename(): Promise<void> {
    const n = this.renameValue().trim();
    if (!n || !this.workspace().id) return;
    await this.svc.rename(this.workspace().id!, n);
    this.closed.emit();
  }

  async rotate(kind: 'viewer' | 'editor'): Promise<void> {
    await this.svc.rotateCode(this.workspace().id!, kind);
  }
  async disable(kind: 'viewer' | 'editor'): Promise<void> {
    await this.svc.disableCode(this.workspace().id!, kind);
  }
  async copy(code: string): Promise<void> {
    await navigator.clipboard.writeText(code);
  }

  async loadMembers(): Promise<void> {
    const m = await this.svc.members(this.workspace().id!);
    this.members.set(m);
  }
  async kick(userId: string): Promise<void> {
    await this.svc.kick(this.workspace().id!, userId);
    this.members.update((m) => (m ?? []).filter((x) => x.user_id !== userId));
  }

  async remove(): Promise<void> {
    if (this.confirmName() !== this.workspace().name) {
      this.error.set('Name mismatch');
      return;
    }
    await this.svc.delete(this.workspace().id!);
    this.closed.emit();
  }
}
```

- [ ] **Step 2: Template**

```html
<div class="backdrop" (click)="closed.emit()"></div>
<div class="panel" (click)="$event.stopPropagation()">
  <div class="tabs">
    <button (click)="open('rename')" [class.active]="pane() === 'rename'">Rename</button>
    <button (click)="open('codes')" [class.active]="pane() === 'codes'">Invite codes</button>
    <button (click)="open('members')" [class.active]="pane() === 'members'">Members</button>
    <button (click)="open('delete')" [class.active]="pane() === 'delete'">Delete</button>
  </div>

  @if (pane() === 'rename') {
    <input [value]="renameValue()" (input)="renameValue.set($any($event.target).value)" />
    <button (click)="rename()">Save</button>
  }

  @if (pane() === 'codes') {
    <div class="code-row">
      <span>Viewer:</span>
      <code>{{ workspace().viewer_code ?? '(disabled)' }}</code>
      @if (workspace().viewer_code) {
        <button (click)="copy(workspace().viewer_code!)">Copy</button>
      }
      <button (click)="rotate('viewer')">Regenerate</button>
      <button (click)="disable('viewer')">Disable</button>
    </div>
    <div class="code-row">
      <span>Editor:</span>
      <code>{{ workspace().editor_code ?? '(disabled)' }}</code>
      @if (workspace().editor_code) {
        <button (click)="copy(workspace().editor_code!)">Copy</button>
      }
      <button (click)="rotate('editor')">Regenerate</button>
      <button (click)="disable('editor')">Disable</button>
    </div>
  }

  @if (pane() === 'members') {
    @if (members(); as list) {
      @if (!list.length) { <div>No members yet.</div> }
      @for (m of list; track m.user_id) {
        <div class="member-row">
          <span>{{ m.name }} ({{ m.role }})</span>
          <button (click)="kick(m.user_id)">Kick</button>
        </div>
      }
    } @else {
      <div>Loading…</div>
    }
  }

  @if (pane() === 'delete') {
    <div>Type <b>{{ workspace().name }}</b> to confirm deletion:</div>
    <input [value]="confirmName()" (input)="confirmName.set($any($event.target).value)" />
    @if (error()) { <div class="err">{{ error() }}</div> }
    <button class="danger" (click)="remove()">Delete workspace</button>
  }

  <button class="close" (click)="closed.emit()">Close</button>
</div>
```

- [ ] **Step 3: Styles**

```css
.backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 40; }
.panel {
  position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%);
  background: white; padding: 16px 20px; border-radius: 8px;
  min-width: 420px; z-index: 41; display: flex; flex-direction: column; gap: 8px;
}
.tabs { display: flex; gap: 4px; }
.tabs button.active { background: #fde68a; }
.code-row { display: flex; align-items: center; gap: 6px; }
.code-row code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; }
.member-row { display: flex; justify-content: space-between; align-items: center; }
.err { color: #b91c1c; }
.danger { background: #fecaca; border: 1px solid #f87171; }
```

- [ ] **Step 4: Wire into sidebar**

In `workspace-sidebar.ts` add:

```typescript
import { WorkspaceSettings } from '../workspace-settings/workspace-settings';

@Component({
  // ...
  imports: [WorkspaceDialog, WorkspaceSettings],
})
export class WorkspaceSidebar {
  // ...
  readonly settingsFor = signal<IWorkspace | null>(null);

  openSettings(w: IWorkspace): void {
    this.menuFor.set(null);
    this.settingsFor.set(w);
  }
}
```

In `workspace-sidebar.html`, replace the owner-menu placeholder:

```html
@if (w.role === 'owner') {
  <button (click)="openSettings(w)">Settings</button>
} @else {
  <button (click)="leave(w)">Leave</button>
}
```

And at the bottom:

```html
@if (settingsFor(); as w) {
  <app-workspace-settings [workspace]="w" (closed)="settingsFor.set(null)" />
}
```

- [ ] **Step 5: Type-check**

Run: `cd frontend && npx tsc -p tsconfig.app.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/components/
git commit -m "frontend: workspace owner settings (rename, codes, members, delete)"
```

---

### Task 18: Mount sidebar and load workspaces on app init

**Files:**
- Modify: `frontend/src/app/components/canvas-board/canvas-board.ts`
- Modify: `frontend/src/app/components/canvas-board/canvas-board.html`
- Modify: `frontend/src/app/pages/canvas/canvas.ts` (or wherever the page root lives)

- [ ] **Step 1: Locate the canvas page root**

Run: `cd frontend && ls src/app/pages/canvas/` and inspect `canvas.ts`. Add `<app-workspace-sidebar />` to the page's template alongside the existing canvas.

- [ ] **Step 2: Load workspaces once on canvas init**

In the canvas page component:

```typescript
import { Component, OnInit, inject } from '@angular/core';
import { WorkspaceService } from '../../core/workspace/workspace.service';

// ...

export class CanvasPage implements OnInit {
  private ws = inject(WorkspaceService);

  async ngOnInit(): Promise<void> {
    await this.ws.load();
  }
}
```

- [ ] **Step 3: Run dev server, smoke test**

Run: `cd frontend && npm start &`
Open http://localhost:4200. Log in. Confirm the left sidebar shows "Personal" and a "+" button. Open the dialog, create a workspace called "Test", confirm it appears.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/
git commit -m "frontend: mount workspace sidebar, load workspaces on canvas init"
```

---

## Phase 6 — Frontend real-time + canvas reactivity

### Task 19: RealtimeService

**Files:**
- Create: `frontend/src/app/core/realtime/realtime.service.ts`
- Create: `frontend/src/app/core/realtime/cursor-color.ts`

- [ ] **Step 1: Color helper (matches backend palette)**

`cursor-color.ts`:

```typescript
const palette = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16',
  '#10b981', '#06b6d4', '#3b82f6', '#6366f1',
  '#8b5cf6', '#d946ef', '#ec4899', '#14b8a6',
];

export function colorForUser(userId: string): string {
  // Match backend SHA1 of raw UUID bytes mod 12.
  // Approximation: use first hex byte of userId (after stripping dashes).
  const hex = userId.replace(/-/g, '').slice(0, 2);
  const n = parseInt(hex, 16);
  return palette[n % palette.length];
}
```

**Important:** this client-side approximation does NOT match backend SHA1 output. Backend includes the authoritative `color` in every presence/cursor event — always trust the event's `color` field. This helper is only a fallback for "your own cursor" (not broadcast back to self anyway) and can be removed if unused.

- [ ] **Step 2: RealtimeService**

`realtime.service.ts`:

```typescript
import { Injectable, signal } from '@angular/core';
import { environment } from '../../../environments/environment';

export interface IPeer {
  userId: string;
  name: string;
  color: string;
}
export interface ICursor extends IPeer {
  x: number;
  y: number;
  lastSeen: number;
}

export type CardEvent =
  | { type: 'card.created'; card: any; by: string }
  | { type: 'card.updated'; card: any; by: string }
  | { type: 'card.deleted'; id: string; by: string };

export type RealtimeEvent =
  | CardEvent
  | { type: 'cursor.move'; userId: string; name: string; color: string; x: number; y: number }
  | { type: 'presence.join'; userId: string; name: string; color: string }
  | { type: 'presence.leave'; userId: string }
  | { type: 'member.kicked'; userId: string }
  | { type: 'workspace.deleted' };

@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private ws: WebSocket | null = null;
  private currentWorkspaceId: string | null = null;
  private reconnectDelay = 1000;

  readonly peers = signal<Map<string, IPeer>>(new Map());
  readonly cursors = signal<Map<string, ICursor>>(new Map());

  private cardListeners: ((ev: CardEvent) => void)[] = [];
  private workspaceEventListeners: ((type: 'kicked' | 'deleted') => void)[] = [];

  onCardEvent(fn: (ev: CardEvent) => void): () => void {
    this.cardListeners.push(fn);
    return () => { this.cardListeners = this.cardListeners.filter((l) => l !== fn); };
  }
  onWorkspaceEvent(fn: (t: 'kicked' | 'deleted') => void): () => void {
    this.workspaceEventListeners.push(fn);
    return () => { this.workspaceEventListeners = this.workspaceEventListeners.filter((l) => l !== fn); };
  }

  connect(workspaceId: string | null): void {
    if (this.currentWorkspaceId === workspaceId) return;
    this.disconnect();
    this.currentWorkspaceId = workspaceId;
    if (!workspaceId) return; // personal — never connect
    this.openSocket(workspaceId);
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.currentWorkspaceId = null;
    this.peers.set(new Map());
    this.cursors.set(new Map());
  }

  sendCursor(x: number, y: number): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'cursor.move', x, y }));
  }

  private openSocket(workspaceId: string): void {
    const url = environment.apiBase.replace(/^http/, 'ws') + `/ws?workspace_id=${workspaceId}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onmessage = (ev) => {
      let msg: RealtimeEvent;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this.handle(msg);
    };

    ws.onclose = () => {
      if (this.currentWorkspaceId === workspaceId) {
        setTimeout(() => this.openSocket(workspaceId), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15000);
      }
    };

    ws.onopen = () => { this.reconnectDelay = 1000; };
  }

  private handle(msg: RealtimeEvent): void {
    switch (msg.type) {
      case 'presence.join':
        this.peers.update((m) => {
          const n = new Map(m);
          n.set(msg.userId, { userId: msg.userId, name: msg.name, color: msg.color });
          return n;
        });
        break;
      case 'presence.leave':
        this.peers.update((m) => { const n = new Map(m); n.delete(msg.userId); return n; });
        this.cursors.update((m) => { const n = new Map(m); n.delete(msg.userId); return n; });
        break;
      case 'cursor.move':
        this.cursors.update((m) => {
          const n = new Map(m);
          n.set(msg.userId, { ...msg, lastSeen: Date.now() });
          return n;
        });
        // cursor events imply presence — ensure peer exists
        this.peers.update((m) => {
          if (m.has(msg.userId)) return m;
          const n = new Map(m);
          n.set(msg.userId, { userId: msg.userId, name: msg.name, color: msg.color });
          return n;
        });
        break;
      case 'card.created':
      case 'card.updated':
      case 'card.deleted':
        this.cardListeners.forEach((fn) => fn(msg as CardEvent));
        break;
      case 'member.kicked':
        this.workspaceEventListeners.forEach((fn) => fn('kicked'));
        break;
      case 'workspace.deleted':
        this.workspaceEventListeners.forEach((fn) => fn('deleted'));
        break;
    }
  }
}
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc -p tsconfig.app.json --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/core/realtime/
git commit -m "frontend: RealtimeService (ws + signals for peers/cursors + card events)"
```

---

### Task 20: Canvas reactivity to active workspace

**Files:**
- Modify: `frontend/src/app/components/canvas-board/canvas-board.ts`
- Modify: `frontend/src/app/components/canvas-board/canvas-board.html`
- Modify: `frontend/src/app/components/canvas-board/canvas-board.css`

- [ ] **Step 1: Inject WorkspaceService + RealtimeService**

In `canvas-board.ts`:

```typescript
import { WorkspaceService } from '../../core/workspace/workspace.service';
import { RealtimeService, CardEvent } from '../../core/realtime/realtime.service';

// inside component class:
private workspaces = inject(WorkspaceService);
private realtime = inject(RealtimeService);
```

- [ ] **Step 2: Refetch cards + reconnect ws on active change**

Add in component constructor/init (using `effect`):

```typescript
import { effect } from '@angular/core';

constructor() {
  effect(async () => {
    const wsId = this.workspaces.active().id;
    await this.reloadForScope(wsId);
    this.realtime.connect(wsId);
  });

  this.realtime.onCardEvent((ev) => this.applyRemoteCardEvent(ev));
  this.realtime.onWorkspaceEvent((kind) => {
    // kicked or deleted → bounce to personal
    this.workspaces.setActive(null);
  });
}

async reloadForScope(wsId: string | null): Promise<void> {
  const list = await this.cardService.list(wsId);
  this.list.set(list);
}

applyRemoteCardEvent(ev: CardEvent): void {
  if (ev.type === 'card.created') {
    this.list.update((l) => l.some((c) => c.id === ev.card.id) ? l : [...l, ev.card]);
  } else if (ev.type === 'card.updated') {
    this.list.update((l) => l.map((c) => c.id === ev.card.id ? ev.card : c));
  } else if (ev.type === 'card.deleted') {
    this.list.update((l) => l.filter((c) => c.id !== ev.id));
  }
}
```

- [ ] **Step 3: Pass workspace_id on create/patch**

Every call to `cardService.create({...})` must include `workspace_id: this.workspaces.active().id`. Grep for `cardService.create` and fix each site.

- [ ] **Step 4: Type-check + dev run**

Run: `cd frontend && npx tsc -p tsconfig.app.json --noEmit && npm start`
Expected: no errors. Manually verify: create a new workspace, switch to it — the canvas clears (empty list). Right-click to create a card — it shows up. Switch back to Personal — previous cards reappear.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/components/canvas-board/
git commit -m "frontend: canvas reacts to active workspace, applies remote card events"
```

---

### Task 21: Remote cursor overlay + outbound throttle

**Files:**
- Modify: `frontend/src/app/components/canvas-board/canvas-board.ts`
- Modify: `frontend/src/app/components/canvas-board/canvas-board.html`
- Modify: `frontend/src/app/components/canvas-board/canvas-board.css`

- [ ] **Step 1: Throttled outbound cursor**

In `canvas-board.ts`, add:

```typescript
private lastCursorSent = 0;

onBoardPointerMove(ev: PointerEvent): void {
  // existing handler might exist; extend it. If not:
  const now = performance.now();
  if (now - this.lastCursorSent < 50) return; // ~20Hz
  this.lastCursorSent = now;
  const rect = this.board.nativeElement.getBoundingClientRect();
  const canvasX = (ev.clientX - rect.left - this.panX()) / this.scale();
  const canvasY = (ev.clientY - rect.top - this.panY()) / this.scale();
  this.realtime.sendCursor(canvasX, canvasY);
}
```

Wire in `canvas-board.html` on the `.board` div:
```html
(pointermove)="onBoardPointerMove($event)"
```

- [ ] **Step 2: Remote cursor rendering**

In `canvas-board.ts`:

```typescript
readonly remoteCursors = computed(() => Array.from(this.realtime.cursors().values()));
```

In `canvas-board.html`, inside the `.sheet` div (so they transform with pan/zoom):

```html
@for (cur of remoteCursors(); track cur.userId) {
  <div class="remote-cursor"
       [style.left.px]="cur.x"
       [style.top.px]="cur.y"
       [style.color]="cur.color">
    <div class="dot" [style.background]="cur.color"></div>
    <div class="label" [style.background]="cur.color">{{ cur.name }}</div>
  </div>
}
```

In `canvas-board.css`:

```css
.remote-cursor {
  position: absolute;
  pointer-events: none;
  transform: translate(-4px, -4px);
  z-index: 100;
}
.remote-cursor .dot {
  width: 10px; height: 10px; border-radius: 50%;
  border: 2px solid white;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.remote-cursor .label {
  position: absolute;
  top: 14px; left: 8px;
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  white-space: nowrap;
}
```

- [ ] **Step 3: Smoke test cross-tab**

Run: `cd frontend && npm start` in one terminal, `cd backend && ./bin/nikohub` in another. Open two different Google accounts in two browsers. From account A, create a workspace, rotate the editor code, share it. From account B, paste code → join. Confirm:
- Both see each other's cursors
- Creating a card in A appears in B
- Switching back to personal in either hides the cursors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/components/canvas-board/
git commit -m "frontend: remote cursor overlay + throttled outbound cursor"
```

---

### Task 22: Viewer "hidden" state on secret cards

**Files:**
- Modify: `frontend/src/app/components/card/card.ts`

- [ ] **Step 1: Read active role + show placeholder**

In `card.ts`:

```typescript
import { WorkspaceService } from '../../core/workspace/workspace.service';
// ...
private workspaces = inject(WorkspaceService);

readonly isViewer = computed(() => this.workspaces.active().role === 'viewer');
readonly displayText = computed(() => {
  const c = this.card();
  if (!this.isViewer()) return c.text;
  if (c.card_type === 'password' || c.is_secret) return '••• hidden •••';
  return c.text;
});
```

Replace `{{ card.text }}` in the template with `{{ displayText() }}`.

Also disable inputs for viewers:

```html
<textarea [disabled]="isViewer()" ...></textarea>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/components/card/
git commit -m "frontend: viewer sees '••• hidden •••' for secret/password cards, inputs disabled"
```

---

## Phase 7 — Final integration

### Task 23: member.kicked / workspace.deleted bounce

**Files:**
- Already handled in Task 20 via `realtime.onWorkspaceEvent` → `setActive(null)`. Validate here.

- [ ] **Step 1: Add server-side broadcast of workspace.deleted and member.kicked**

In `workspaces/handlers.go` `Delete` handler (Task 6 — return here and amend):

```go
// Requires hub injected into workspaces.Handlers
if h.Hub != nil {
    msg, _ := json.Marshal(map[string]any{"type": "workspace.deleted"})
    h.Hub.Broadcast(id, msg, msg, nil)
}
```

Add `Hub *realtime.Hub` to `workspaces.Handlers` and wire in main.go.

For `Kick`:

```go
if h.Hub != nil {
    msg, _ := json.Marshal(map[string]any{
        "type": "member.kicked",
        "userId": member.String(),
    })
    // Everyone in room gets the message; only the kicked user acts on it.
    h.Hub.Broadcast(id, msg, msg, nil)
}
```

(Consumer on the client: if `msg.userId === myUserID`, bounce to personal; others just update presence.)

- [ ] **Step 2: Build**

Run: `cd backend && go build ./...`
Expected: success.

- [ ] **Step 3: Smoke test**

From two browsers: owner kicks member → member's UI bounces to Personal. Owner deletes workspace → member's UI bounces to Personal.

- [ ] **Step 4: Commit**

```bash
git add backend/
git commit -m "workspaces: broadcast workspace.deleted / member.kicked to room"
```

---

### Task 24: Full cross-browser smoke test

**Files:** (no changes)

- [ ] **Step 1: Build + serve**

Run:
```bash
cd backend && make build && ./bin/nikohub &
cd frontend && npm start &
```

- [ ] **Step 2: Two-account test checklist**

With account A in Chrome and account B in Firefox (both logged in), verify each:

- [ ] A creates workspace "Shared" → appears in A's sidebar
- [ ] A generates editor code, copies it
- [ ] B opens dialog, pastes code, joins → workspace appears in B's sidebar
- [ ] B switches to "Shared" → sees A's cursor if A is on that workspace
- [ ] A creates a note card → appears immediately in B's view
- [ ] B moves a card → A sees the move after B releases the drag (PATCH commits)
- [ ] B types in a note, blurs → A sees the updated text
- [ ] A rotates editor code → B's existing access unchanged (uses membership, not the code)
- [ ] A generates viewer code, gives to account C → C sees cards but secret-note/password text is redacted
- [ ] A visits editor code (already owner) → no-op
- [ ] B (editor) visits viewer code → no demote; role stays editor
- [ ] C (viewer) visits editor code → promoted to editor
- [ ] A kicks B → B's UI jumps to Personal
- [ ] A deletes workspace → C's UI jumps to Personal

- [ ] **Step 3: Document any bugs as follow-up tasks, fix blockers, re-run**

- [ ] **Step 4: Final commit if any polish needed**

```bash
git add -A
git commit -m "polish from cross-browser smoke test"
```

---

## Self-review notes (author)

- **Spec coverage:** each section of the spec maps to tasks: data model → T1, realtime hub → T10/T11/T12/T23, HTTP API → T6/T7/T8/T9, frontend service → T13/T14/T19, sidebar/dialog/settings → T15/T16/T17/T18, canvas reactivity → T20, cursors → T21, viewer UI → T22, invite flow end-to-end validated in T24. ✅
- **Concurrency model** from spec is directly implemented and tested in T10. ✅
- **Viewer redaction** both in HTTP and broadcast paths: T5 (helper), T8/T9 (HTTP), T12 (broadcast dual-payload). ✅
- **Personal workspace = `workspace_id IS NULL`** never stored — only implicit. ✅
- **Auto-promote logic** in `JoinByCode` (T3 step 5): never demotes, promotes viewer→editor on editor-code visit. ✅
- **Delete confirm ("type name")** in T17. ✅

## Risks / open questions

- **Snapshot on ws join** is deferred (T11 note). If presence feels jumpy in practice, add `Hub.Snapshot(wsID)` — pulls peer list from the room and sends to the new conn. Single task.
- **Image broadcast** in T12 refetches the card after upload — verify no race where the broadcast fires before the new `updated_at` is committed. The repo's `SetImage` commits synchronously so this should be fine, but worth eyeballing during T24.
- **CORS for ws** — `CheckOrigin: true` in `upgrader` is deliberate (cookies + CORS middleware already enforce origin via access control). If we ever host frontend cross-origin for real, tighten this.
