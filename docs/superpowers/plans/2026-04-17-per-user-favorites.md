# Per-user Favorites Implementation Plan

**Goal:** Move `is_favorite` + `sidebar_order` from `cards` (shared) to a new `card_favorites` table keyed by `(user_id, card_id)`. Each user gets their own bookmarks regardless of workspace role.

**Architecture:** New table; backfill from existing personal favorites; list queries LEFT JOIN it; Patch handler splits favorite fields off the card write path; no broadcast on favorite-only changes.

**Spec:** `docs/superpowers/specs/2026-04-17-per-user-favorites-addendum.md`

---

## Task F1: Migration 011 — card_favorites table

**Files:**
- Create: `backend/internal/migrations/011_card_favorites.sql`

- [ ] **Step 1: Write migration**

```sql
CREATE TABLE card_favorites (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id       UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  sidebar_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, card_id)
);
CREATE INDEX idx_card_favorites_card ON card_favorites(card_id);

INSERT INTO card_favorites (user_id, card_id, sidebar_order)
SELECT user_id, id, sidebar_order FROM cards WHERE is_favorite = true;

ALTER TABLE cards DROP COLUMN is_favorite;
ALTER TABLE cards DROP COLUMN sidebar_order;
```

- [ ] **Step 2: Build** — `cd backend && go build ./...`. Expect **failure**: `Card.IsFavorite` and `Card.SidebarOrder` fields no longer have backing columns. Task F2 fixes that.

- [ ] **Step 3: Commit** — do NOT commit yet; wait until F2 is complete and build passes. F1 + F2 commit together.

---

## Task F2: Cards repo — per-user favorites

**Files:**
- Modify: `backend/internal/cards/cards.go`

- [ ] **Step 1: Update `returnCols` and `scanCard`**

Replace `returnCols`:

```go
// Note: is_favorite / sidebar_order come from a LEFT JOIN against card_favorites
// parameterized by the calling user ($<user>).
const returnCols = `c.id,c.workspace_id,c.x,c.y,c.width,c.height,c.color,c.text,(c.image_data IS NOT NULL),c.z_index,c.card_type,c.is_secret,(f.card_id IS NOT NULL) AS is_favorite,COALESCE(f.sidebar_order,0) AS sidebar_order,COALESCE(c.totp_name,''),c.container_id,c.title,c.updated_at`
```

(Scan order stays the same — the `scanCard` signature doesn't change.)

- [ ] **Step 2: Rewrite list queries with user-scoped join**

```go
func (r *Repo) ListPersonal(userID uuid.UUID) ([]Card, error) {
	rows, err := r.db.Query(`
		SELECT `+returnCols+`
		FROM cards c
		LEFT JOIN card_favorites f ON f.card_id = c.id AND f.user_id = $1
		WHERE c.user_id=$1 AND c.workspace_id IS NULL
		ORDER BY c.z_index ASC, c.created_at ASC`, userID)
	return r.scanList(rows, err)
}

func (r *Repo) ListWorkspace(userID, workspaceID uuid.UUID) ([]Card, error) {
	rows, err := r.db.Query(`
		SELECT `+returnCols+`
		FROM cards c
		LEFT JOIN card_favorites f ON f.card_id = c.id AND f.user_id = $1
		WHERE c.workspace_id=$2
		ORDER BY c.z_index ASC, c.created_at ASC`, userID, workspaceID)
	return r.scanList(rows, err)
}
```

Note: `ListWorkspace` signature gains `userID` — call site in `cards/handlers.go` must update (Task F3 handles).

- [ ] **Step 3: Rewrite `GetByID`, `Create`, `Update`**

`GetByID` needs the favorite join too — it now takes userID:

```go
func (r *Repo) GetByID(userID, id uuid.UUID) (*Card, error) {
	c := &Card{}
	row := r.db.QueryRow(
		`SELECT `+returnCols+`
		 FROM cards c
		 LEFT JOIN card_favorites f ON f.card_id = c.id AND f.user_id = $1
		 WHERE c.id=$2`,
		userID, id,
	)
	if err := scanCard(row, c); err != nil {
		return nil, err
	}
	return c, nil
}
```

`Create`'s RETURNING clause now needs the join. Simplest: INSERT then re-query via GetByID. Replace:

```go
func (r *Repo) Create(userID uuid.UUID, in CreateInput) (*Card, error) {
	// ... existing default setting ...
	var id uuid.UUID
	err := r.db.QueryRow(`
		INSERT INTO cards(user_id,workspace_id,x,y,width,height,color,text,title,card_type,is_secret,totp_secret,totp_name)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		RETURNING id`,
		userID, in.WorkspaceID, in.X, in.Y, width, height, color, in.Text, in.Title, cardType, in.IsSecret, totpSecret, totpName,
	).Scan(&id)
	if err != nil {
		return nil, err
	}
	return r.GetByID(userID, id)
}
```

`Update` drops `is_favorite` and `sidebar_order` from its SQL and `UpdateInput`:

```go
type UpdateInput struct {
	X, Y, Width, Height, ZIndex *int
	Color, Text, Title          *string
	IsSecret                    *bool
	ContainerID                 *uuid.UUID
	ClearContainerID            bool
}

func (r *Repo) Update(userID, id uuid.UUID, in UpdateInput) (*Card, error) {
	_, err := r.db.Exec(`
		UPDATE cards SET
		  x = COALESCE($2,x),
		  y = COALESCE($3,y),
		  width = COALESCE($4,width),
		  height = COALESCE($5,height),
		  z_index = COALESCE($6,z_index),
		  color = COALESCE($7,color),
		  text = COALESCE($8,text),
		  title = COALESCE($9,title),
		  is_secret = COALESCE($10,is_secret),
		  container_id = CASE WHEN $12 THEN NULL WHEN $11::uuid IS NOT NULL THEN $11::uuid ELSE container_id END,
		  updated_at = now()
		WHERE id=$1`,
		id, in.X, in.Y, in.Width, in.Height, in.ZIndex, in.Color, in.Text, in.Title, in.IsSecret,
		in.ContainerID, in.ClearContainerID,
	)
	if err != nil {
		return nil, err
	}
	return r.GetByID(userID, id)
}
```

`Update` signature also gains `userID` (needed for the post-update GetByID).

- [ ] **Step 4: Add favorite methods**

```go
// SetFavorite toggles the per-user favorite bit. If on=true, inserts or
// preserves the row; if on=false, deletes it. sidebarOrder is applied only
// when on=true and the caller passed a non-nil value.
func (r *Repo) SetFavorite(userID, cardID uuid.UUID, on bool, sidebarOrder *int) error {
	if !on {
		_, err := r.db.Exec(
			`DELETE FROM card_favorites WHERE user_id=$1 AND card_id=$2`,
			userID, cardID,
		)
		return err
	}
	order := 0
	if sidebarOrder != nil {
		order = *sidebarOrder
	}
	_, err := r.db.Exec(`
		INSERT INTO card_favorites(user_id, card_id, sidebar_order)
		VALUES($1, $2, $3)
		ON CONFLICT (user_id, card_id) DO UPDATE
		SET sidebar_order = CASE WHEN $4 THEN EXCLUDED.sidebar_order ELSE card_favorites.sidebar_order END`,
		userID, cardID, order, sidebarOrder != nil,
	)
	return err
}

// SetFavoriteOrder updates only sidebar_order, requiring the favorite to exist.
func (r *Repo) SetFavoriteOrder(userID, cardID uuid.UUID, order int) error {
	res, err := r.db.Exec(
		`UPDATE card_favorites SET sidebar_order=$3 WHERE user_id=$1 AND card_id=$2`,
		userID, cardID, order,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}
```

- [ ] **Step 5: Build & test**

```bash
cd backend && go build ./... && go test ./...
```

Build will fail because `cards/handlers.go` callers haven't migrated. Proceed to F3 immediately; commit F1+F2+F3 together.

---

## Task F3: Cards handlers — split favorite fields, skip broadcast

**Files:**
- Modify: `backend/internal/cards/handlers.go`
- Modify: `backend/internal/cards/serializer.go` (if `IsFavorite`/`SidebarOrder` referenced — they shouldn't be; favorite fields stay on the Card struct, only the DB column is gone)

- [ ] **Step 1: Update `patchReq`**

Fields `IsFavorite` and `SidebarOrder` stay in `patchReq` — that's the wire format. Nothing changes here.

- [ ] **Step 2: Rewrite `Patch` — split favorite fields from intrinsic fields**

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
	var in patchReq
	if err := c.BindJSON(&in); err != nil {
		httpx.Err(c, 400, "bad json")
		return
	}

	// Favorite fields are always allowed (even for viewers — personal bookmark).
	favoriteTouched := in.IsFavorite != nil || in.SidebarOrder != nil
	if favoriteTouched {
		if in.IsFavorite != nil {
			if err := h.Repo.SetFavorite(uid, id, *in.IsFavorite, in.SidebarOrder); err != nil {
				httpx.Err(c, 500, "favorite failed")
				return
			}
		} else {
			// sidebar_order alone: only meaningful if favorite row exists
			if err := h.Repo.SetFavoriteOrder(uid, id, *in.SidebarOrder); err != nil && err != sql.ErrNoRows {
				httpx.Err(c, 500, "reorder failed")
				return
			}
		}
	}

	// Intrinsic fields require non-viewer role.
	intrinsicTouched := in.X != nil || in.Y != nil || in.Width != nil || in.Height != nil ||
		in.ZIndex != nil || in.Color != nil || in.Text != nil || in.Title != nil ||
		in.IsSecret != nil || in.ContainerID != nil
	if intrinsicTouched {
		if role == string(workspaces.RoleViewer) {
			httpx.Err(c, 403, "viewers cannot edit")
			return
		}
		var containerID *uuid.UUID
		clearContainerID := false
		if in.ContainerID != nil {
			if *in.ContainerID == "" {
				clearContainerID = true
			} else {
				parsed, err := uuid.Parse(*in.ContainerID)
				if err != nil {
					httpx.Err(c, 400, "bad container_id")
					return
				}
				containerID = &parsed
			}
		}
		card, err := h.Repo.Update(uid, id, UpdateInput{
			X: in.X, Y: in.Y, Width: in.Width, Height: in.Height, ZIndex: in.ZIndex,
			Color: in.Color, Text: in.Text, Title: in.Title, IsSecret: in.IsSecret,
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
		h.broadcastCard(card.WorkspaceID, "card.updated", *card, uid)
		return
	}

	// Favorite-only patch: return updated card (per this user) with no broadcast.
	card, err := h.Repo.GetByID(uid, id)
	if err != nil {
		httpx.Err(c, 500, "read failed")
		return
	}
	c.JSON(200, RedactForRole(*card, role))
}
```

- [ ] **Step 3: Update other `GetByID`, `Update` call sites**

`authorizeCard` uses `h.Repo.GetByID(cardID)` — update to `h.Repo.GetByID(uid, cardID)`:

```go
func (h *Handlers) authorizeCard(uid, cardID uuid.UUID) (*Card, string, int, string) {
	card, err := h.Repo.GetByID(uid, cardID)
	// ... rest unchanged
}
```

`UploadImage` and `DeleteImage` re-fetch via `GetByID` — also update:

```go
if updated, err := h.Repo.GetByID(uid, id); err == nil {
	h.broadcastCard(updated.WorkspaceID, "card.updated", *updated, uid)
}
```

Any other `h.Repo.List` / `h.Repo.Update` / `h.Repo.GetByID` call sites — grep and add `uid`.

- [ ] **Step 4: Update `List` handler**

`ListWorkspace` now needs `uid`:

```go
if wsID == nil {
	list, err = h.Repo.ListPersonal(uid)
} else {
	list, err = h.Repo.ListWorkspace(uid, *wsID)
}
```

- [ ] **Step 5: Build & test**

```bash
cd backend && go build ./... && go test -race ./...
```

All must pass.

- [ ] **Step 6: Commit (F1+F2+F3 together)**

```bash
git add backend/internal/migrations/011_card_favorites.sql backend/internal/cards/
git commit -m "cards: per-user favorites (new card_favorites table, no broadcast on toggle)"
```

---

## Task F4: Verify frontend + smoke

**Files:** none (type-check only)

- [ ] **Step 1: Frontend type-check**

```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit
```

`ICard.is_favorite` and `ICard.sidebar_order` are still in the type. `cards.patch({ is_favorite, sidebar_order })` is still the API. No frontend code changes expected.

- [ ] **Step 2: Two-account smoke**

Start backend + frontend. With accounts A and B both in a shared workspace:

- [ ] Each independently favorites a different card. Verify A's sidebar shows only A's favorite, B's sidebar shows only B's.
- [ ] Favorite the same card in both accounts. Verify neither user's favorite toggle affects the other's view.
- [ ] Reorder favorites in A via drag — verify B's order is untouched.
- [ ] Verify unrelated cross-user updates (card move, text edit) still broadcast correctly — favorite change should NOT have appeared in the peer's canvas.

- [ ] **Step 3: Done**

No commit for this task.
