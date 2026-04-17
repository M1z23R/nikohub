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
	time.Sleep(10 * time.Millisecond)

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
	h.Unregister(c)
	time.Sleep(10 * time.Millisecond)

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

	for i := 0; i < 40; i++ {
		h.Broadcast(ws, []byte("X"), []byte("X"), nil)
	}
	time.Sleep(50 * time.Millisecond)

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
