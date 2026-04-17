package realtime

import (
	"encoding/json"

	"github.com/google/uuid"
)

type Event struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"-"`
}

type encoded struct {
	editorBytes []byte
	viewerBytes []byte
	skipUser    *uuid.UUID
}
