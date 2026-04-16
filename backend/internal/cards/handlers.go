package cards

import (
	"database/sql"
	"io"

	nikologs "github.com/M1z23r/nikologs-go"
	"github.com/google/uuid"
	"github.com/m1z23r/drift/pkg/drift"
	"github.com/m1z23r/nikohub/internal/auth"
	"github.com/m1z23r/nikohub/internal/httpx"
)

const MaxImageBytes = 5 * 1024 * 1024

type Handlers struct {
	Repo *Repo
	Log  *nikologs.Client
}

func (h *Handlers) List(c *drift.Context) {
	uid := auth.UserID(c)
	list, err := h.Repo.List(uid)
	if err != nil {
		httpx.Err(c, 500, "list failed")
		return
	}
	c.JSON(200, list)
}

type createReq struct {
	X     int    `json:"x"`
	Y     int    `json:"y"`
	Color string `json:"color"`
	Text  string `json:"text"`
}

func (h *Handlers) Create(c *drift.Context) {
	uid := auth.UserID(c)
	var in createReq
	if err := c.BindJSON(&in); err != nil {
		httpx.Err(c, 400, "bad json")
		return
	}
	card, err := h.Repo.Create(uid, CreateInput{X: in.X, Y: in.Y, Color: in.Color, Text: in.Text})
	if err != nil {
		httpx.Err(c, 500, "create failed")
		return
	}
	c.JSON(201, card)
}

type patchReq struct {
	X      *int    `json:"x,omitempty"`
	Y      *int    `json:"y,omitempty"`
	Width  *int    `json:"width,omitempty"`
	Height *int    `json:"height,omitempty"`
	ZIndex *int    `json:"z_index,omitempty"`
	Color  *string `json:"color,omitempty"`
	Text   *string `json:"text,omitempty"`
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
	card, err := h.Repo.Update(uid, id, UpdateInput{
		X: in.X, Y: in.Y, Width: in.Width, Height: in.Height, ZIndex: in.ZIndex,
		Color: in.Color, Text: in.Text,
	})
	if err == sql.ErrNoRows {
		httpx.Err(c, 404, "not found")
		return
	}
	if err != nil {
		httpx.Err(c, 500, "update failed")
		return
	}
	c.JSON(200, card)
}

func (h *Handlers) Delete(c *drift.Context) {
	uid := auth.UserID(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Err(c, 400, "bad id")
		return
	}
	if err := h.Repo.Delete(uid, id); err == sql.ErrNoRows {
		httpx.Err(c, 404, "not found")
		return
	} else if err != nil {
		httpx.Err(c, 500, "delete failed")
		return
	}
	c.Status(204)
}

func (h *Handlers) UploadImage(c *drift.Context) {
	uid := auth.UserID(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Err(c, 400, "bad id")
		return
	}
	fh, err := c.FormFile("file")
	if err != nil {
		httpx.Err(c, 400, "file required")
		return
	}
	if fh.Size > MaxImageBytes {
		httpx.Err(c, 413, "file too large")
		return
	}
	f, err := fh.Open()
	if err != nil {
		httpx.Err(c, 500, "open failed")
		return
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, MaxImageBytes+1))
	if err != nil {
		httpx.Err(c, 500, "read failed")
		return
	}
	if len(data) > MaxImageBytes {
		httpx.Err(c, 413, "file too large")
		return
	}
	mime := fh.Header.Get("Content-Type")
	if mime == "" {
		mime = "application/octet-stream"
	}
	if err := h.Repo.SetImage(uid, id, mime, data); err == sql.ErrNoRows {
		httpx.Err(c, 404, "not found")
		return
	} else if err != nil {
		httpx.Err(c, 500, "save failed")
		return
	}
	c.Status(204)
}

func (h *Handlers) DeleteImage(c *drift.Context) {
	uid := auth.UserID(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Err(c, 400, "bad id")
		return
	}
	if err := h.Repo.ClearImage(uid, id); err == sql.ErrNoRows {
		httpx.Err(c, 404, "not found")
		return
	} else if err != nil {
		httpx.Err(c, 500, "clear failed")
		return
	}
	c.Status(204)
}

func (h *Handlers) GetImage(c *drift.Context) {
	uid := auth.UserID(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Err(c, 400, "bad id")
		return
	}
	mime, data, err := h.Repo.GetImage(uid, id)
	if err == sql.ErrNoRows {
		httpx.Err(c, 404, "not found")
		return
	}
	if err != nil {
		httpx.Err(c, 500, "read failed")
		return
	}
	c.Response.Header().Set("Cache-Control", "private, max-age=3600")
	c.Data(200, mime, data)
}
