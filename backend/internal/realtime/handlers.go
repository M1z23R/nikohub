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
	CheckOrigin:     func(r *http.Request) bool { return true },
}

const writeWait = 10 * time.Second

func SkipCompression() drift.HandlerFunc { return middleware.SkipCompression() }

func (h *Handlers) Serve(c *drift.Context) {
	uid := auth.UserID(c)

	wsIDStr := c.QueryParam("workspace_id")
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
		return
	}

	rtConn := NewConn(uid, user.Name, string(role), wsID)
	h.Hub.Register(rtConn)
	h.announceJoin(rtConn)

	defer func() {
		h.Hub.Unregister(rtConn)
		h.announceLeave(rtConn)
		_ = ws.Close(driftws.CloseNormalClosure, "bye")
	}()

	writeDone := make(chan struct{})
	go func() {
		defer close(writeDone)
		h.writePump(ws, rtConn)
	}()

	h.readPump(ws, rtConn)
	<-writeDone
}

func (h *Handlers) writePump(ws *driftws.Conn, c *Conn) {
	for msg := range c.Send() {
		_ = ws.SetWriteDeadline(time.Now().Add(writeWait))
		if err := ws.WriteMessage(driftws.TextMessage, msg); err != nil {
			return
		}
	}
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
	}
}

func (h *Handlers) announceJoin(c *Conn) {
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
