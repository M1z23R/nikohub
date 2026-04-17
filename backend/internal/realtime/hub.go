package realtime

import (
	"sync/atomic"

	"github.com/google/uuid"
)

type Conn struct {
	UserID      uuid.UUID
	UserName    string
	Color       string
	Role        string
	WorkspaceID uuid.UUID
	send        chan []byte
	closed      atomic.Bool
}

func (c *Conn) Send() <-chan []byte { return c.send }

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

type broadcastMsg struct {
	workspaceID uuid.UUID
	enc         encoded
}

type Hub struct {
	register   chan *Conn
	unregister chan *Conn
	broadcast  chan broadcastMsg
	done       chan struct{}
	rooms      map[uuid.UUID]map[*Conn]struct{}
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
