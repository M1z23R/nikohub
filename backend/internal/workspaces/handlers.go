package workspaces

import (
	"database/sql"
	"errors"

	nikologs "github.com/M1z23r/nikologs-go"
	"github.com/google/uuid"
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
	list, err := h.Repo.ListForUser(uid)
	if err != nil {
		httpx.Err(c, 500, "list failed")
		return
	}
	c.JSON(200, list)
}

type createReq struct {
	Name string `json:"name"`
}

func (h *Handlers) Create(c *drift.Context) {
	uid := auth.UserID(c)
	var in createReq
	if err := c.BindJSON(&in); err != nil || in.Name == "" {
		httpx.Err(c, 400, "bad json")
		return
	}
	w, err := h.Repo.Create(uid, in.Name)
	if err != nil {
		httpx.Err(c, 500, "create failed")
		return
	}
	c.JSON(201, w)
}

type patchReq struct {
	Name              *string `json:"name,omitempty"`
	RotateViewerCode  bool    `json:"rotate_viewer_code,omitempty"`
	RotateEditorCode  bool    `json:"rotate_editor_code,omitempty"`
	DisableViewerCode bool    `json:"disable_viewer_code,omitempty"`
	DisableEditorCode bool    `json:"disable_editor_code,omitempty"`
}

type patchResp struct {
	ViewerCode *string `json:"viewer_code,omitempty"`
	EditorCode *string `json:"editor_code,omitempty"`
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

	resp := patchResp{}

	if in.Name != nil {
		if err := h.Repo.Rename(uid, id, *in.Name); err != nil {
			writeErr(c, err)
			return
		}
	}
	if in.RotateViewerCode {
		code, err := h.Repo.RotateCode(uid, id, CodeViewer)
		if err != nil {
			writeErr(c, err)
			return
		}
		resp.ViewerCode = &code
	}
	if in.RotateEditorCode {
		code, err := h.Repo.RotateCode(uid, id, CodeEditor)
		if err != nil {
			writeErr(c, err)
			return
		}
		resp.EditorCode = &code
	}
	if in.DisableViewerCode {
		if err := h.Repo.DisableCode(uid, id, CodeViewer); err != nil {
			writeErr(c, err)
			return
		}
	}
	if in.DisableEditorCode {
		if err := h.Repo.DisableCode(uid, id, CodeEditor); err != nil {
			writeErr(c, err)
			return
		}
	}
	c.JSON(200, resp)
}

func writeErr(c *drift.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		httpx.Err(c, 404, "not found")
	case errors.Is(err, ErrForbidden):
		httpx.Err(c, 403, "forbidden")
	case errors.Is(err, ErrNotOwner):
		httpx.Err(c, 403, "forbidden")
	case errors.Is(err, sql.ErrNoRows):
		httpx.Err(c, 404, "not found")
	default:
		httpx.Err(c, 500, "error")
	}
}

func (h *Handlers) Delete(c *drift.Context) {
	uid := auth.UserID(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Err(c, 400, "bad id")
		return
	}
	if err := h.Repo.Delete(uid, id); err != nil {
		writeErr(c, err)
		return
	}
	c.Status(204)
}

type joinReq struct {
	Code string `json:"code"`
}

func (h *Handlers) Join(c *drift.Context) {
	uid := auth.UserID(c)
	var in joinReq
	if err := c.BindJSON(&in); err != nil || in.Code == "" {
		httpx.Err(c, 400, "bad json")
		return
	}
	w, err := h.Repo.JoinByCode(uid, in.Code)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(200, w)
}

func (h *Handlers) Members(c *drift.Context) {
	uid := auth.UserID(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Err(c, 400, "bad id")
		return
	}
	list, err := h.Repo.ListMembers(uid, id)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(200, list)
}

func (h *Handlers) Kick(c *drift.Context) {
	uid := auth.UserID(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Err(c, 400, "bad id")
		return
	}
	member, err := uuid.Parse(c.Param("userId"))
	if err != nil {
		httpx.Err(c, 400, "bad user id")
		return
	}
	if err := h.Repo.KickMember(uid, id, member); err != nil {
		writeErr(c, err)
		return
	}
	c.Status(204)
}

func (h *Handlers) Leave(c *drift.Context) {
	uid := auth.UserID(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Err(c, 400, "bad id")
		return
	}
	if err := h.Repo.Leave(uid, id); err != nil {
		writeErr(c, err)
		return
	}
	c.Status(204)
}
