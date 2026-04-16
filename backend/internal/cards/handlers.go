package cards

import (
	"database/sql"
	"io"
	"log"
	"time"

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
	X          int    `json:"x"`
	Y          int    `json:"y"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	Color      string `json:"color"`
	Text       string `json:"text"`
	Title      string `json:"title"`
	CardType   string `json:"card_type"`
	IsSecret   bool   `json:"is_secret"`
	TotpSecret string `json:"totp_secret,omitempty"`
	TotpName   string `json:"totp_name,omitempty"`
}

func (h *Handlers) Create(c *drift.Context) {
	uid := auth.UserID(c)
	var in createReq
	if err := c.BindJSON(&in); err != nil {
		httpx.Err(c, 400, "bad json")
		return
	}
	if in.CardType == "totp" && in.TotpSecret == "" {
		httpx.Err(c, 400, "totp_secret required for totp card")
		return
	}
	card, err := h.Repo.Create(uid, CreateInput{
		X: in.X, Y: in.Y, Width: in.Width, Height: in.Height,
		Color: in.Color, Text: in.Text, Title: in.Title,
		CardType: in.CardType, IsSecret: in.IsSecret, TotpSecret: in.TotpSecret, TotpName: in.TotpName,
	})
	if err != nil {
		log.Printf("CREATE CARD ERROR: %v", err)
		httpx.Err(c, 500, "create failed")
		return
	}
	c.JSON(201, card)
}

type patchReq struct {
	X           *int    `json:"x,omitempty"`
	Y           *int    `json:"y,omitempty"`
	Width       *int    `json:"width,omitempty"`
	Height      *int    `json:"height,omitempty"`
	ZIndex      *int    `json:"z_index,omitempty"`
	Color       *string `json:"color,omitempty"`
	Text        *string `json:"text,omitempty"`
	Title       *string `json:"title,omitempty"`
	IsSecret    *bool   `json:"is_secret,omitempty"`
	ContainerID *string `json:"container_id,omitempty"`
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

func (h *Handlers) GetAllTOTP(c *drift.Context) {
	uid := auth.UserID(c)
	secrets, err := h.Repo.GetAllSecrets(uid)
	if err != nil {
		httpx.Err(c, 500, "read failed")
		return
	}
	now := time.Now()
	codes := make(map[string]TotpBatchEntry, len(secrets))
	for id, secret := range secrets {
		code, err := GenerateTOTP(secret, now)
		if err != nil {
			continue
		}
		codes[id.String()] = TotpBatchEntry{Code: code}
	}
	remaining := 30 - int(now.Unix()%30)
	c.JSON(200, TotpBatchResponse{Codes: codes, Remaining: remaining, Period: 30})
}

func (h *Handlers) GetTOTP(c *drift.Context) {
	uid := auth.UserID(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Err(c, 400, "bad id")
		return
	}
	secret, err := h.Repo.GetSecret(uid, id)
	if err == sql.ErrNoRows {
		httpx.Err(c, 404, "not found")
		return
	}
	if err != nil {
		httpx.Err(c, 500, "read failed")
		return
	}
	now := time.Now()
	code, err := GenerateTOTP(secret, now)
	if err != nil {
		httpx.Err(c, 500, "totp generation failed")
		return
	}
	remaining := 30 - int(now.Unix()%30)
	c.JSON(200, TotpCode{Code: code, Remaining: remaining, Period: 30})
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
