# Workspaces & Real-time Cursors — Design

## Goals

Introduce shared, invite-only workspaces on top of the existing single-user canvas so small groups (2–5 people) can collaborate on a shared board. Every current user keeps their existing personal canvas untouched. While multiple people are in the same shared workspace, they see each other's cursors and each other's card edits in real time.

## Non-goals (out of scope for v1)

- Multi-instance scaling of the backend. The realtime hub is in-process.
- Live per-keystroke text sync. Text edits commit on blur/submit exactly like today; only the resulting DB write gets broadcast.
- Moving cards between workspaces. Cards live in whichever workspace they were created in.
- Ownership transfer. Owner cannot leave — owner can only delete.
- Public/anonymous access. Everything requires an authenticated session.
- Cursors or presence in the personal workspace (single-user by definition).

## Concepts

- **Personal workspace**: implicit, one per user, not a row in any table. Represented by `cards.workspace_id IS NULL`. Never deletable, never shareable.
- **Shared workspace**: explicit row in `workspaces`, owned by the user who created it. Has zero or more members.
- **Owner**: exactly one per shared workspace (`workspaces.owner_id`). Full access. Not listed in `workspace_members`.
- **Editor**: member who can read and mutate every card in the workspace, including secret content.
- **Viewer**: member who can read cards, but secret-card contents are redacted before leaving the server.
- **Invite code**: opaque random string. Each workspace has at most one active viewer code and one active editor code, both owner-controlled.

## Data model

New migration `backend/internal/migrations/010_workspaces.sql`:

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

Rules:

- `cards.workspace_id IS NULL` → personal card, access controlled by `cards.user_id` as today.
- `cards.workspace_id IS NOT NULL` → shared card, access controlled by membership/ownership of `workspaces.id`.
- Existing cards are left with `workspace_id = NULL` (personal). No backfill.
- Codes (`viewer_code`, `editor_code`) `NULL` means the code is disabled. Codes are generated as 16 random bytes → URL-safe base64.

## Authorization

Enforced in each card handler and introduced as a helper in a new package (e.g. `internal/workspaces/authz.go`):

- `AuthorizeCard(ctx, userID, cardID) → (role, error)` resolves the card, finds the owning workspace (or personal), and returns one of: `personal-owner`, `workspace-owner`, `workspace-editor`, `workspace-viewer`, or an error if the user has no access.
- `AuthorizeWorkspace(ctx, userID, workspaceID) → (role, error)` same shape for workspace-level operations.

Rules:

- Mutating endpoints (`POST/PATCH/DELETE /cards`, image upload/delete) require one of `personal-owner`, `workspace-owner`, `workspace-editor`.
- Read endpoints accept all roles.
- Owner-only endpoints (rename, rotate/disable codes, members list, kick, delete workspace) require `workspace-owner`.
- "Leave workspace" requires the caller to be a non-owner member.

**Viewer redaction.** The repository continues to return complete card rows. An HTTP-layer serializer function takes `(card, role)` and, when role is `workspace-viewer`, redacts:

- `text` → empty string for `card_type IN ('secret-note', 'password')`.
- TOTP seed / TOTP-derived data → omitted entirely for `card_type = 'totp'`.

The same serializer is applied to broadcast payloads (see Realtime), so a viewer connected over websocket also receives redacted events.

## HTTP API

New endpoints, all under `/api/v1`, all requiring `RequireAccess`:

```
GET    /workspaces                       list mine (owned + joined)
POST   /workspaces                       body: { name }
PATCH  /workspaces/:id                   body: { name?, rotate_viewer_code?, rotate_editor_code?, disable_viewer_code?, disable_editor_code? }  (owner only)
DELETE /workspaces/:id                   owner only; cascades cards
POST   /workspaces/join                  body: { code } → returns the joined workspace; auto-promotes viewer→editor if code matches editor_code
GET    /workspaces/:id/members           owner only
DELETE /workspaces/:id/members/me        leave (non-owner)
DELETE /workspaces/:id/members/:userId   kick (owner only)
```

Existing `GET /cards` gains a `workspace_id` query parameter:

- Omitted or `personal` → personal cards (`workspace_id IS NULL AND user_id = <me>`).
- UUID → cards where `workspace_id = <uuid>`, gated by membership/ownership.

`POST /cards` and related mutations accept an optional `workspace_id` in the body; when present the caller must be owner/editor of that workspace.

## Realtime layer

New package `backend/internal/realtime/` with a single in-process hub backed by `gorilla/websocket`.

### Connection endpoint

`GET /ws?workspace_id=<uuid>` (auth: existing JWT cookie/access token middleware).

- On upgrade, the server validates the caller's access to `workspace_id` using `AuthorizeWorkspace`.
- Personal workspace connections are rejected (no peers; nothing to broadcast).
- On success the connection is registered to the workspace's room and a `presence.join` is broadcast to other peers. The joining client receives a `presence.snapshot` with the current peer list.

### Hub structure

```go
type Conn struct {
    userID      uuid.UUID
    userName    string
    color       string               // derived from userID
    role        string               // viewer | editor | owner
    workspaceID uuid.UUID
    send        chan []byte          // buffered, owned-by-hub-close
    ws          *websocket.Conn
}

type Hub struct {
    register   chan *Conn
    unregister chan *Conn
    broadcast  chan broadcastMsg     // { workspaceID, payload, skipUserID? }
    done       chan struct{}
    rooms      map[uuid.UUID]map[*Conn]struct{}   // only touched by the hub goroutine
}

func (h *Hub) Run()                                  // single goroutine loop
func (h *Hub) Broadcast(wsID uuid.UUID, ev Event)    // pushes to broadcast chan, non-blocking
```

### Concurrency model (explicit — no races, no deadlocks)

- The hub's `rooms` map is only read/written by the single `Run()` goroutine. No mutex guards it.
- `register`, `unregister`, `broadcast` channels are buffered; producers never hold any lock while sending.
- Each `Conn` has its own write-pump goroutine draining `send` and writing to the socket.
- Each `Conn` has its own read-pump goroutine reading frames and forwarding cursor messages to the hub.
- Broadcast iteration in the hub is non-blocking per connection:
  ```go
  select {
  case c.send <- msg:
  default:
      // slow client — evict
      close(c.send)
      delete(room, c)
  }
  ```
- Only the hub goroutine closes `c.send`. Conn goroutines see the channel close, exit cleanly, and close the websocket.
- Disconnects on the conn side push an `unregister` event to the hub; the hub performs the `close(c.send) + delete(room, c)` there too. Never double-close — hub's unregister handler is the single writer.
- No nested locks exist anywhere in the package (there are no locks at all). No lock ordering → no A→B vs B→A deadlock possible.
- Graceful shutdown: closing `done` causes `Run()` to close all sends and exit. HTTP handlers that call `Broadcast` after shutdown fall into the `default` branch of a non-blocking send on `broadcast` and are dropped.

### Events

Server → client:

```json
{"type":"presence.snapshot","peers":[{"userId":"...","name":"...","color":"#..."}]}
{"type":"presence.join","userId":"...","name":"...","color":"#..."}
{"type":"presence.leave","userId":"..."}
{"type":"cursor.move","userId":"...","x":123,"y":456}
{"type":"card.created","card":{...},"by":"user-uuid"}
{"type":"card.updated","card":{...},"by":"user-uuid"}
{"type":"card.deleted","id":"uuid","by":"user-uuid"}
{"type":"member.kicked","userId":"..."}
{"type":"workspace.deleted"}
```

Client → server (only one message type accepted):

```json
{"type":"cursor.move","x":123,"y":456}
```

Any other inbound frame is ignored.

### Broadcast hook-in

Each mutating card handler, after a successful DB commit:

1. Loads the fresh card (it already does).
2. If `card.workspace_id IS NOT NULL`, calls `hub.Broadcast(card.workspace_id, event)` with the corresponding `card.created`/`card.updated`/`card.deleted` event.
3. For viewer redaction: the hub applies the viewer-serializer per-recipient before writing to `c.send`. Editors and owners get the full card; viewers get the redacted version. This is implemented as `serializeFor(role, event) []byte` called inside the hub's broadcast loop.

### Cursors

- Client throttles `pointermove` on the canvas to ~20Hz using a short debounce or time-gated signal.
- Coordinates sent are the canvas-space (pre-transform) `(x, y)` — the same coordinate system that cards use — so remote clients render the cursor at the correct spot regardless of their own pan/zoom.
- Colors derive deterministically from `userID` via hash → palette of 12 predefined colors. No storage.

## Frontend architecture

### Service layer

`frontend/src/app/core/workspace/workspace.service.ts`:

```typescript
interface IWorkspace {
  id: string | null;
  name: string;
  role: 'owner' | 'editor' | 'viewer';
  viewer_code?: string | null;
  editor_code?: string | null;
}

@Injectable({ providedIn: 'root' })
export class WorkspaceService {
  readonly list = signal<IWorkspace[]>([]);
  readonly activeId = signal<string | null>(null);
  readonly active = computed(() => this.list().find(w => w.id === this.activeId()) ?? PERSONAL);

  async load(): Promise<void>;
  async create(name: string): Promise<IWorkspace>;
  async join(code: string): Promise<IWorkspace>;
  async rename(id: string, name: string): Promise<void>;
  async rotateCode(id: string, kind: 'viewer' | 'editor'): Promise<string>;
  async disableCode(id: string, kind: 'viewer' | 'editor'): Promise<void>;
  async delete(id: string): Promise<void>;
  async leave(id: string): Promise<void>;
  async members(id: string): Promise<IWorkspaceMember[]>;
  async kick(id: string, userId: string): Promise<void>;
  setActive(id: string | null): void;
}
```

Changing `activeId` triggers: a re-fetch of cards for the new scope and a websocket reconnect (disconnect from prior room, connect to the new one if it is a shared workspace).

### Realtime service

`frontend/src/app/core/realtime/realtime.service.ts`:

- Opens `/api/v1/ws?workspace_id=<id>` only when the active workspace is a shared one.
- Exposes signals: `peers` (Map<userId, IPeer>), `cursors` (Map<userId, ICursor>).
- Exposes event streams consumed by `CardStore`: `cardCreated`, `cardUpdated`, `cardDeleted`.
- Handles `member.kicked` / `workspace.deleted` by switching active workspace to personal.
- Reconnects with exponential backoff on socket close; on reconnect, triggers a full card refetch (authoritative state is the DB; lossy broadcasts are acceptable).

### Components

**`components/workspace-sidebar/`** (new, left-side floating, mirroring the existing right-side sidebar's visual style):

- Always-present "Personal" row on top, highlighted when `activeId() === null`.
- `@for` over shared workspaces the user is in.
- Hover on a shared workspace row reveals a `"…"` button:
  - For owners: opens a context menu with Rename, Invite codes, Members, Delete.
  - For non-owners: opens a context menu with just Leave.
- Bottom button: single `"+"` that opens the Create/Join dialog.

**`components/workspace-dialog/`** (new): Create/Join dialog.

- Top section: "Create workspace" — name input + Create button.
- `<hr>`.
- Bottom section: "Or join a workspace" — code input + Join button.

**Owner-only context submenus** (can live inside the sidebar or as lightweight dialogs; implementation detail):

- **Invite codes**: show viewer and editor codes with copy buttons; buttons to rotate or disable each. Rotate produces a new code; disable clears it.
- **Members**: list of names with a Kick button per row. Server returns human-readable names via the existing `users` table join.
- **Delete workspace**: "type workspace name to confirm" dialog. On submit → `DELETE /workspaces/:id`.

**Existing components touched:**

- `canvas-board.ts` / `canvas-board.html`:
  - Subscribes to `WorkspaceService.active`; refetches cards and reconnects the websocket on change.
  - Reacts to incoming `card.*` events by updating its local card list signal.
  - Renders a remote-cursor overlay layer (one `<div>` per peer in `cursors()`), positioned with the same pan/scale transform as cards.
  - Emits cursor moves to `RealtimeService` from `pointermove`, throttled to 20Hz.
- `card.ts`:
  - When the active workspace role is `viewer` and the card is a secret type, display a clear "hidden" state (placeholder text / icon) instead of the empty string the backend returns.
- `card.service.ts`:
  - Accepts `workspace_id` in list/create calls. Defaults to the active workspace's id.

### Cursor color

Frontend mirrors the backend's deterministic user-color computation (hash of `userId` → palette index) so colors are consistent across peers without any round-trip.

## Invite flow

1. Owner opens the workspace's "…" → Invite codes. Initially both codes are `NULL` (disabled).
2. Owner clicks "Generate viewer code" or "Generate editor code". Backend produces a random token, stores it on `workspaces`, returns it. UI shows a Copy button.
3. Owner shares the code via any channel.
4. Recipient opens the app (logged in), clicks the "+" sidebar button, switches to the "Or join" section, pastes the code, submits.
5. Backend:
   - Looks up a workspace where `viewer_code = :code OR editor_code = :code`. Error if none.
   - If caller is already a member:
     - If the code matches the editor code and the caller's role is `viewer`, promote to `editor`.
     - Otherwise no-op (never demote).
   - Else insert a `workspace_members` row with the corresponding role.
   - Return the workspace.
6. Frontend sets the joined workspace as active.

Rotating regenerates the token (invalidating the old one). Disabling sets the column to `NULL` (future attempts with the old code fail). Existing members are unaffected by rotation or disabling.

## Error handling

- All workspace endpoints return `403` when the caller lacks the required role, `404` when the workspace doesn't exist, `400` on malformed input.
- `/workspaces/join` returns `404` on unknown/disabled code.
- Websocket upgrade returns `403` if the caller is not a member/owner of the workspace.
- Frontend surfaces these as toast-style error messages (reuse whatever pattern exists).

## Testing

Backend:

- Unit tests for the realtime hub covering: register/unregister, broadcast to multiple conns in a room, slow-consumer eviction, graceful shutdown.
- HTTP tests for the workspace endpoints covering the role matrix (owner/editor/viewer/stranger) on each mutating action.
- An integration test covering the join-and-promote flow end-to-end.
- Viewer redaction test: create a secret card as owner, fetch as viewer, assert `text` is empty and TOTP seed absent.

Frontend:

- Manual smoke test across two browser windows (two different users) verifying: create card in one appears in the other, cursor shows in both, deleting the workspace in one disconnects the other.
- Unit tests for `WorkspaceService` state transitions.

## Rollout

One migration (`010_workspaces.sql`). No backfill required. Existing personal data is unchanged because `workspace_id` defaults to `NULL` and the authorization rules for personal cards match today's behavior.
