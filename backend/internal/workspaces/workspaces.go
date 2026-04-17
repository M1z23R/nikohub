package workspaces

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"

	"github.com/google/uuid"
)

type Role string

const (
	RoleOwner  Role = "owner"
	RoleEditor Role = "editor"
	RoleViewer Role = "viewer"
)

type Workspace struct {
	ID         uuid.UUID `json:"id"`
	OwnerID    uuid.UUID `json:"owner_id"`
	Name       string    `json:"name"`
	ViewerCode *string   `json:"viewer_code,omitempty"`
	EditorCode *string   `json:"editor_code,omitempty"`
	Role       Role      `json:"role"`
}

type Member struct {
	UserID uuid.UUID `json:"user_id"`
	Name   string    `json:"name"`
	Email  string    `json:"email"`
	Role   Role      `json:"role"`
}

var ErrNotFound = errors.New("workspace not found")
var ErrForbidden = errors.New("forbidden")
var ErrNotOwner = errors.New("not owner")

type Repo struct{ db *sql.DB }

func NewRepo(db *sql.DB) *Repo { return &Repo{db: db} }

func newCode() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func (r *Repo) ListForUser(userID uuid.UUID) ([]Workspace, error) {
	rows, err := r.db.Query(`
		SELECT id, owner_id, name, viewer_code, editor_code, 'owner'::text AS role
		FROM workspaces WHERE owner_id = $1
		UNION ALL
		SELECT w.id, w.owner_id, w.name, NULL, NULL, wm.role
		FROM workspaces w
		JOIN workspace_members wm ON wm.workspace_id = w.id
		WHERE wm.user_id = $1
		ORDER BY name`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Workspace{}
	for rows.Next() {
		var w Workspace
		var viewerCode, editorCode sql.NullString
		var role string
		if err := rows.Scan(&w.ID, &w.OwnerID, &w.Name, &viewerCode, &editorCode, &role); err != nil {
			return nil, err
		}
		if viewerCode.Valid {
			s := viewerCode.String
			w.ViewerCode = &s
		}
		if editorCode.Valid {
			s := editorCode.String
			w.EditorCode = &s
		}
		w.Role = Role(role)
		out = append(out, w)
	}
	return out, rows.Err()
}

func (r *Repo) Create(ownerID uuid.UUID, name string) (*Workspace, error) {
	w := &Workspace{OwnerID: ownerID, Name: name, Role: RoleOwner}
	err := r.db.QueryRow(
		`INSERT INTO workspaces(owner_id, name) VALUES($1, $2) RETURNING id`,
		ownerID, name,
	).Scan(&w.ID)
	return w, err
}

func (r *Repo) Rename(ownerID, id uuid.UUID, name string) error {
	res, err := r.db.Exec(
		`UPDATE workspaces SET name=$3 WHERE id=$1 AND owner_id=$2`,
		id, ownerID, name,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repo) Delete(ownerID, id uuid.UUID) error {
	res, err := r.db.Exec(
		`DELETE FROM workspaces WHERE id=$1 AND owner_id=$2`, id, ownerID,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

type CodeKind string

const (
	CodeViewer CodeKind = "viewer"
	CodeEditor CodeKind = "editor"
)

func (r *Repo) RotateCode(ownerID, id uuid.UUID, kind CodeKind) (string, error) {
	code, err := newCode()
	if err != nil {
		return "", err
	}
	col := "viewer_code"
	if kind == CodeEditor {
		col = "editor_code"
	}
	res, err := r.db.Exec(
		`UPDATE workspaces SET `+col+`=$3 WHERE id=$1 AND owner_id=$2`,
		id, ownerID, code,
	)
	if err != nil {
		return "", err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return "", ErrNotFound
	}
	return code, nil
}

func (r *Repo) DisableCode(ownerID, id uuid.UUID, kind CodeKind) error {
	col := "viewer_code"
	if kind == CodeEditor {
		col = "editor_code"
	}
	res, err := r.db.Exec(
		`UPDATE workspaces SET `+col+`=NULL WHERE id=$1 AND owner_id=$2`,
		id, ownerID,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repo) JoinByCode(userID uuid.UUID, code string) (*Workspace, error) {
	var ws Workspace
	var viewerCode, editorCode sql.NullString
	err := r.db.QueryRow(`
		SELECT id, owner_id, name, viewer_code, editor_code
		FROM workspaces
		WHERE viewer_code = $1 OR editor_code = $1`,
		code,
	).Scan(&ws.ID, &ws.OwnerID, &ws.Name, &viewerCode, &editorCode)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	if ws.OwnerID == userID {
		ws.Role = RoleOwner
		return &ws, nil
	}

	newRole := RoleViewer
	if editorCode.Valid && editorCode.String == code {
		newRole = RoleEditor
	}

	var currentRole sql.NullString
	_ = r.db.QueryRow(
		`SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2`,
		ws.ID, userID,
	).Scan(&currentRole)

	if !currentRole.Valid {
		if _, err := r.db.Exec(
			`INSERT INTO workspace_members(workspace_id, user_id, role) VALUES($1,$2,$3)`,
			ws.ID, userID, string(newRole),
		); err != nil {
			return nil, err
		}
		ws.Role = newRole
	} else if currentRole.String == string(RoleViewer) && newRole == RoleEditor {
		if _, err := r.db.Exec(
			`UPDATE workspace_members SET role='editor' WHERE workspace_id=$1 AND user_id=$2`,
			ws.ID, userID,
		); err != nil {
			return nil, err
		}
		ws.Role = RoleEditor
	} else {
		ws.Role = Role(currentRole.String)
	}
	return &ws, nil
}

func (r *Repo) ListMembers(ownerID, workspaceID uuid.UUID) ([]Member, error) {
	var owner uuid.UUID
	if err := r.db.QueryRow(
		`SELECT owner_id FROM workspaces WHERE id=$1`, workspaceID,
	).Scan(&owner); err == sql.ErrNoRows {
		return nil, ErrNotFound
	} else if err != nil {
		return nil, err
	}
	if owner != ownerID {
		return nil, ErrNotOwner
	}

	rows, err := r.db.Query(`
		SELECT u.id, u.name, u.email, wm.role
		FROM workspace_members wm
		JOIN users u ON u.id = wm.user_id
		WHERE wm.workspace_id = $1
		ORDER BY wm.joined_at ASC`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Member{}
	for rows.Next() {
		var m Member
		var role string
		if err := rows.Scan(&m.UserID, &m.Name, &m.Email, &role); err != nil {
			return nil, err
		}
		m.Role = Role(role)
		out = append(out, m)
	}
	return out, rows.Err()
}

func (r *Repo) KickMember(ownerID, workspaceID, memberID uuid.UUID) error {
	res, err := r.db.Exec(`
		DELETE FROM workspace_members
		WHERE workspace_id = $1 AND user_id = $2
		  AND workspace_id IN (SELECT id FROM workspaces WHERE owner_id = $3)`,
		workspaceID, memberID, ownerID,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repo) Leave(userID, workspaceID uuid.UUID) error {
	res, err := r.db.Exec(
		`DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2`,
		workspaceID, userID,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repo) AuthorizeWorkspace(userID, workspaceID uuid.UUID) (Role, error) {
	var owner uuid.UUID
	if err := r.db.QueryRow(
		`SELECT owner_id FROM workspaces WHERE id=$1`, workspaceID,
	).Scan(&owner); err == sql.ErrNoRows {
		return "", ErrNotFound
	} else if err != nil {
		return "", err
	}
	if owner == userID {
		return RoleOwner, nil
	}
	var role string
	err := r.db.QueryRow(
		`SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2`,
		workspaceID, userID,
	).Scan(&role)
	if err == sql.ErrNoRows {
		return "", ErrForbidden
	}
	if err != nil {
		return "", err
	}
	return Role(role), nil
}
