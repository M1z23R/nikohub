# Per-user Favorites — Addendum

Addendum to `2026-04-17-workspaces-and-realtime-cursors-design.md`. This fixes the favorite/sidebar-order design gap surfaced after the v1 workspaces feature landed.

## Problem

`cards.is_favorite` and `cards.sidebar_order` are columns on the card row, so in a shared workspace all members see the same favorite state. Favoriting a shared card bookmarks it for everyone — semantically wrong.

## Fix

Favorites are a **per-user** concern. Move them from `cards` to a new `card_favorites` table keyed by `(user_id, card_id)`.

## Semantics

- **Any role** (owner/editor/viewer) can favorite any card they can see — favoriting is personal, not a collaborative action, so role gating does not apply.
- Favorite state is **not broadcast** over the websocket. Favoriting a card in a shared workspace does not notify peers.
- Backend emits `card.updated` events only for card-intrinsic changes (position, size, text, color, image, title, is_secret, container_id). Favorite-only patches do not broadcast.

## Data model

```sql
CREATE TABLE card_favorites (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id       UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  sidebar_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, card_id)
);
CREATE INDEX idx_card_favorites_card ON card_favorites(card_id);

-- Backfill from existing is_favorite cards
INSERT INTO card_favorites (user_id, card_id, sidebar_order)
SELECT user_id, id, sidebar_order FROM cards WHERE is_favorite = true;

ALTER TABLE cards DROP COLUMN is_favorite;
ALTER TABLE cards DROP COLUMN sidebar_order;
```

## API

No new endpoints. `PATCH /cards/:id` still accepts `is_favorite` and `sidebar_order`. The handler routes those fields to `card_favorites` for the calling user instead of updating the card row.

## Response shape

`ICard.is_favorite` and `ICard.sidebar_order` remain in the response, but are now derived per-user via `LEFT JOIN card_favorites`:

```sql
SELECT c.id, c.workspace_id, c.x, ...,
       (f.card_id IS NOT NULL) AS is_favorite,
       COALESCE(f.sidebar_order, 0) AS sidebar_order,
       ...
FROM cards c
LEFT JOIN card_favorites f ON f.card_id = c.id AND f.user_id = $<callerID>
WHERE ...
```

List queries (`ListPersonal`, `ListWorkspace`) gain a `userID` parameter. `ListPersonal` already had it; `ListWorkspace(workspaceID)` gets a new signature `ListWorkspace(userID, workspaceID)`.

## Broadcast behavior

`cards.Handlers.Patch` splits inbound fields:
- **Intrinsic** (x, y, width, height, color, text, title, is_secret, container_id): apply to `cards`, broadcast `card.updated` with the post-update card (full).
- **Favorite** (is_favorite, sidebar_order): apply to `card_favorites` for caller, do NOT broadcast.
- **Both**: intrinsic fields applied and broadcast; favorite fields applied to personal favorites silently. A single HTTP call can update both.

## Frontend

`ICard.is_favorite` and `ICard.sidebar_order` fields are unchanged. `CardService.patch(id, { is_favorite, sidebar_order })` still works. No frontend changes required; only end-to-end verification.
