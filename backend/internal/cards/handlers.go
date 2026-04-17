package cards

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log"
	"time"

	nikologs "github.com/M1z23r/nikologs-go"
	"github.com/google/uuid"
	"github.com/m1z23r/drift/pkg/drift"
	"github.com/m1z23r/nikohub/internal/auth"
	"github.com/m1z23r/nikohub/internal/httpx"
	"github.com/m1z23r/nikohub/internal/realtime"
	"github.com/m1z23r/nikohub/internal/workspaces"
)

const MaxImageBytes = 5 * 1024 * 1024

type Handlers struct {
	Repo       *Repo
	Workspaces *workspaces.Repo
	Hub        *realtime.Hub
	Log        *nikologs.Client
}

func (h *Handlers) List(c *drift.Context) {
	uid := auth.UserID(c)
	wsID, role, code, msg := h.resolveScope(uid, c.QueryParam("workspace_id"))
	if code != 0 {
		httpx.Err(c, code, msg)
		return
	}
	var list []Card
	var err error
	if wsID == nil {
		list, err = h.Repo.ListPersonal(uid)
	} else {
		list, err = h.Repo.ListWorkspace(*wsID)
	}
	if err != nil {
		httpx.Err(c, 500, "list failed")
		return
	}
	c.JSON(200, RedactList(list, role))
}

type createReq struct {
	X           int     `json:"x"`
	Y           int     `json:"y"`
	Width       int     `json:"width"`
	Height      int     `json:"height"`
	Color       string  `json:"color"`
	Text        string  `json:"text"`
	Title       string  `json:"title"`
	CardType    string  `json:"card_type"`
	IsSecret    bool    `json:"is_secret"`
	TotpSecret  string  `json:"totp_secret,omitempty"`
	TotpName    string  `json:"totp_name,omitempty"`
	WorkspaceID *string `json:"workspace_id,omitempty"`
}

func (h *Handlers) Create(c *drift.Context) {
	uid := auth.UserID(c)
	var in createReq
	if err := c.BindJSON(&in); err != nil {
		httpx.Err(c, 400, "bad json")
		return
	}
	wsRaw := ""
	if in.WorkspaceID != nil {
		wsRaw = *in.WorkspaceID
	}
	wsID, role, code, msg := h.resolveScope(uid, wsRaw)
	if code != 0 {
		httpx.Err(c, code, msg)
		return
	}
	if wsID != nil && role == string(workspaces.RoleViewer) {
		httpx.Err(c, 403, "viewers cannot create")
		return
	}
	if in.CardType == "totp" && in.TotpSecret == "" {
		httpx.Err(c, 400, "totp_secret required for totp card")
		return
	}
	card, err := h.Repo.Create(uid, CreateInput{
		WorkspaceID: wsID,
		X: in.X, Y: in.Y, Width: in.Width, Height: in.Height,
		Color: in.Color, Text: in.Text, Title: in.Title,
		CardType: in.CardType, IsSecret: in.IsSecret,
		TotpSecret: in.TotpSecret, TotpName: in.TotpName,
	})
	if err != nil {
		log.Printf("CREATE CARD ERROR: %v", err)
		httpx.Err(c, 500, "create failed")
		return
	}
	c.JSON(201, RedactForRole(*card, role))
	h.broadcastCard(card.WorkspaceID, "card.created", *card, uid)
}

type patchReq struct {
	X            *int    `json:"x,omitempty"`
	Y            *int    `json:"y,omitempty"`
	Width        *int    `json:"width,omitempty"`
	Height       *int    `json:"height,omitempty"`
	ZIndex       *int    `json:"z_index,omitempty"`
	Color        *string `json:"color,omitempty"`
	Text         *string `json:"text,omitempty"`
	Title        *string `json:"title,omitempty"`
	IsSecret     *bool   `json:"is_secret,omitempty"`
	IsFavorite   *bool   `json:"is_favorite,omitempty"`
	SidebarOrder *int    `json:"sidebar_order,omitempty"`
	ContainerID  *string `json:"container_id,omitempty"`
}

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
	if role == string(workspaces.RoleViewer) {
		httpx.Err(c, 403, "viewers cannot edit")
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

	card, err := h.Repo.Update(id, UpdateInput{
		X: in.X, Y: in.Y, Width: in.Width, Height: in.Height, ZIndex: in.ZIndex,
		SidebarOrder: in.SidebarOrder,
		Color: in.Color, Text: in.Text, Title: in.Title, IsSecret: in.IsSecret, IsFavorite: in.IsFavorite,
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
}

func (h *Handlers) Delete(c *drift.Context) {
	uid := auth.UserID(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Err(c, 400, "bad id")
		return
	}
	card, role, code, msg := h.authorizeCard(uid, id)
	if code != 0 {
		httpx.Err(c, code, msg)
		return
	}
	if role == string(workspaces.RoleViewer) {
		httpx.Err(c, 403, "viewers cannot delete")
		return
	}
	if err := h.Repo.Delete(id); err == sql.ErrNoRows {
		httpx.Err(c, 404, "not found")
		return
	} else if err != nil {
		httpx.Err(c, 500, "delete failed")
		return
	}
	c.Status(204)
	h.broadcastDelete(card.WorkspaceID, id, uid)
}

func (h *Handlers) UploadImage(c *drift.Context) {
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
	if role == string(workspaces.RoleViewer) {
		httpx.Err(c, 403, "viewers cannot upload")
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
	if err := h.Repo.SetImage(id, mime, data); err == sql.ErrNoRows {
		httpx.Err(c, 404, "not found")
		return
	} else if err != nil {
		httpx.Err(c, 500, "save failed")
		return
	}
	c.Status(204)
	if updated, err := h.Repo.GetByID(id); err == nil {
		h.broadcastCard(updated.WorkspaceID, "card.updated", *updated, uid)
	}
}

func (h *Handlers) DeleteImage(c *drift.Context) {
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
	if role == string(workspaces.RoleViewer) {
		httpx.Err(c, 403, "viewers cannot delete image")
		return
	}
	if err := h.Repo.ClearImage(id); err == sql.ErrNoRows {
		httpx.Err(c, 404, "not found")
		return
	} else if err != nil {
		httpx.Err(c, 500, "clear failed")
		return
	}
	c.Status(204)
	if updated, err := h.Repo.GetByID(id); err == nil {
		h.broadcastCard(updated.WorkspaceID, "card.updated", *updated, uid)
	}
}

func (h *Handlers) GetImage(c *drift.Context) {
	uid := auth.UserID(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Err(c, 400, "bad id")
		return
	}
	_, _, code, msg := h.authorizeCard(uid, id)
	if code != 0 {
		httpx.Err(c, code, msg)
		return
	}
	mime, data, err := h.Repo.GetImage(id)
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

func (h *Handlers) GetTOTP(c *drift.Context) {
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
	if role == string(workspaces.RoleViewer) {
		httpx.Err(c, 403, "viewers cannot read totp")
		return
	}
	secret, err := h.Repo.GetSecret(id)
	if err == sql.ErrNoRows {
		httpx.Err(c, 404, "not found")
		return
	}
	if err != nil {
		httpx.Err(c, 500, "read failed")
		return
	}
	now := time.Now()
	code2, err := GenerateTOTP(secret, now)
	if err != nil {
		httpx.Err(c, 500, "totp generation failed")
		return
	}
	remaining := 30 - int(now.Unix()%30)
	c.JSON(200, TotpCode{Code: code2, Remaining: remaining, Period: 30})
}

func (h *Handlers) GetAllTOTP(c *drift.Context) {
	uid := auth.UserID(c)
	wsID, role, code, msg := h.resolveScope(uid, c.QueryParam("workspace_id"))
	if code != 0 {
		httpx.Err(c, code, msg)
		return
	}
	if role == string(workspaces.RoleViewer) {
		httpx.Err(c, 403, "viewers cannot read totp")
		return
	}
	secrets, err := h.Repo.GetAllSecretsForScope(uid, wsID)
	if err != nil {
		httpx.Err(c, 500, "read failed")
		return
	}
	now := time.Now()
	codes := make(map[string]TotpBatchEntry, len(secrets))
	for id, secret := range secrets {
		generated, err := GenerateTOTP(secret, now)
		if err != nil {
			continue
		}
		codes[id.String()] = TotpBatchEntry{Code: generated}
	}
	remaining := 30 - int(now.Unix()%30)
	c.JSON(200, TotpBatchResponse{Codes: codes, Remaining: remaining, Period: 30})
}

func (h *Handlers) resolveScope(uid uuid.UUID, raw string) (*uuid.UUID, string, int, string) {
	if raw == "" || raw == "personal" {
		return nil, "personal", 0, ""
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return nil, "", 400, "bad workspace id"
	}
	role, err := h.Workspaces.AuthorizeWorkspace(uid, id)
	if err != nil {
		if errors.Is(err, workspaces.ErrForbidden) || errors.Is(err, workspaces.ErrNotFound) {
			return nil, "", 403, "forbidden"
		}
		return nil, "", 500, "authz error"
	}
	return &id, string(role), 0, ""
}

func (h *Handlers) authorizeCard(uid, cardID uuid.UUID) (*Card, string, int, string) {
	card, err := h.Repo.GetByID(cardID)
	if err == sql.ErrNoRows {
		return nil, "", 404, "not found"
	}
	if err != nil {
		return nil, "", 500, "lookup failed"
	}
	if card.WorkspaceID == nil {
		ownerID, err := h.Repo.OwnerOfPersonal(cardID)
		if err != nil || ownerID != uid {
			return nil, "", 403, "forbidden"
		}
		return card, "personal", 0, ""
	}
	role, err := h.Workspaces.AuthorizeWorkspace(uid, *card.WorkspaceID)
	if err != nil {
		return nil, "", 403, "forbidden"
	}
	return card, string(role), 0, ""
}

func (h *Handlers) broadcastCard(wsID *uuid.UUID, eventType string, card Card, actorID uuid.UUID) {
	if wsID == nil || h.Hub == nil {
		return
	}
	editorBytes, _ := json.Marshal(map[string]any{
		"type": eventType,
		"card": card,
		"by":   actorID.String(),
	})
	viewerBytes, _ := json.Marshal(map[string]any{
		"type": eventType,
		"card": RedactForRole(card, "viewer"),
		"by":   actorID.String(),
	})
	h.Hub.Broadcast(*wsID, editorBytes, viewerBytes, nil)
}

func (h *Handlers) broadcastDelete(wsID *uuid.UUID, cardID uuid.UUID, actorID uuid.UUID) {
	if wsID == nil || h.Hub == nil {
		return
	}
	msg, _ := json.Marshal(map[string]any{
		"type": "card.deleted",
		"id":   cardID.String(),
		"by":   actorID.String(),
	})
	h.Hub.Broadcast(*wsID, msg, msg, nil)
}
