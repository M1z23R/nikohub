package cardtypecolors

import (
	"strings"

	nikologs "github.com/M1z23r/nikologs-go"
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
	colors, err := h.Repo.List(uid)
	if err != nil {
		httpx.Err(c, 500, "list failed")
		return
	}
	c.JSON(200, colors)
}

type patchReq struct {
	Color string `json:"color"`
}

func (h *Handlers) Patch(c *drift.Context) {
	uid := auth.UserID(c)
	cardType := c.Param("cardType")
	if !IsKnownType(cardType) {
		httpx.Err(c, 400, "unknown card type")
		return
	}
	var in patchReq
	if err := c.BindJSON(&in); err != nil {
		httpx.Err(c, 400, "bad json")
		return
	}
	color := strings.TrimSpace(in.Color)
	if color == "" {
		httpx.Err(c, 400, "color required")
		return
	}
	if err := h.Repo.Upsert(uid, cardType, color); err != nil {
		httpx.Err(c, 500, "update failed")
		return
	}
	c.JSON(200, map[string]string{"card_type": cardType, "color": color})
}
