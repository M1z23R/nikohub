package cards

import (
	"crypto/hmac"
	"crypto/sha1"
	"database/sql"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

type TotpCode struct {
	Code      string `json:"code"`
	Remaining int    `json:"remaining"`
	Period    int    `json:"period"`
}

type TotpBatchEntry struct {
	Code string `json:"code"`
}

type TotpBatchResponse struct {
	Codes     map[string]TotpBatchEntry `json:"codes"`
	Remaining int                       `json:"remaining"`
	Period    int                       `json:"period"`
}

func GenerateTOTP(secret string, t time.Time) (string, error) {
	secret = strings.TrimSpace(strings.ToUpper(secret))
	secret = strings.ReplaceAll(secret, " ", "")
	for len(secret)%8 != 0 {
		secret += "="
	}
	key, err := base32.StdEncoding.DecodeString(secret)
	if err != nil {
		return "", fmt.Errorf("invalid secret: %w", err)
	}

	counter := uint64(t.Unix()) / 30
	buf := make([]byte, 8)
	binary.BigEndian.PutUint64(buf, counter)

	mac := hmac.New(sha1.New, key)
	mac.Write(buf)
	h := mac.Sum(nil)

	offset := h[len(h)-1] & 0x0f
	code := binary.BigEndian.Uint32(h[offset:offset+4]) & 0x7fffffff
	return fmt.Sprintf("%06d", code%1000000), nil
}

func (r *Repo) GetSecret(userID, id uuid.UUID) (string, error) {
	var secret sql.NullString
	err := r.db.QueryRow(
		`SELECT totp_secret FROM cards WHERE id=$1 AND user_id=$2 AND card_type='totp'`, id, userID,
	).Scan(&secret)
	if err != nil {
		return "", err
	}
	if !secret.Valid {
		return "", sql.ErrNoRows
	}
	return secret.String, nil
}

func (r *Repo) GetAllSecrets(userID uuid.UUID) (map[uuid.UUID]string, error) {
	rows, err := r.db.Query(
		`SELECT id, totp_secret FROM cards WHERE user_id=$1 AND card_type='totp' AND totp_secret IS NOT NULL`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[uuid.UUID]string)
	for rows.Next() {
		var id uuid.UUID
		var secret string
		if err := rows.Scan(&id, &secret); err != nil {
			return nil, err
		}
		out[id] = secret
	}
	return out, rows.Err()
}

type Card struct {
	ID          uuid.UUID  `json:"id"`
	WorkspaceID *uuid.UUID `json:"workspace_id"`
	X           int        `json:"x"`
	Y           int        `json:"y"`
	Width       int        `json:"width"`
	Height      int        `json:"height"`
	Color       string     `json:"color"`
	Text        string     `json:"text"`
	HasImage    bool       `json:"has_image"`
	ZIndex      int        `json:"z_index"`
	CardType    string     `json:"card_type"`
	IsSecret     bool      `json:"is_secret"`
	IsFavorite   bool      `json:"is_favorite"`
	SidebarOrder int       `json:"sidebar_order"`
	TotpName    string     `json:"totp_name,omitempty"`
	ContainerID *uuid.UUID `json:"container_id"`
	Title       string     `json:"title"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

type Repo struct{ db *sql.DB }

func NewRepo(db *sql.DB) *Repo { return &Repo{db: db} }

func (r *Repo) List(userID uuid.UUID) ([]Card, error) {
	rows, err := r.db.Query(`
		SELECT `+returnCols+`
		FROM cards WHERE user_id=$1 ORDER BY z_index ASC, created_at ASC`, userID)
	return r.scanList(rows, err)
}

func (r *Repo) ListPersonal(userID uuid.UUID) ([]Card, error) {
	rows, err := r.db.Query(`
		SELECT `+returnCols+`
		FROM cards WHERE user_id=$1 AND workspace_id IS NULL
		ORDER BY z_index ASC, created_at ASC`, userID)
	return r.scanList(rows, err)
}

func (r *Repo) ListWorkspace(workspaceID uuid.UUID) ([]Card, error) {
	rows, err := r.db.Query(`
		SELECT `+returnCols+`
		FROM cards WHERE workspace_id=$1
		ORDER BY z_index ASC, created_at ASC`, workspaceID)
	return r.scanList(rows, err)
}

func (r *Repo) scanList(rows *sql.Rows, err error) ([]Card, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Card{}
	for rows.Next() {
		var c Card
		if err := scanCard(rows, &c); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

type CreateInput struct {
	WorkspaceID         *uuid.UUID
	X, Y, Width, Height int
	Color, Text, Title  string
	CardType            string
	IsSecret            bool
	TotpSecret          string
	TotpName            string
}

const returnCols = `id,workspace_id,x,y,width,height,color,text,(image_data IS NOT NULL),z_index,card_type,is_secret,is_favorite,sidebar_order,COALESCE(totp_name,''),container_id,title,updated_at`

func scanCard(row interface{ Scan(...any) error }, c *Card) error {
	var containerID uuid.NullUUID
	var workspaceID uuid.NullUUID
	err := row.Scan(&c.ID, &workspaceID, &c.X, &c.Y, &c.Width, &c.Height, &c.Color, &c.Text, &c.HasImage, &c.ZIndex, &c.CardType, &c.IsSecret, &c.IsFavorite, &c.SidebarOrder, &c.TotpName, &containerID, &c.Title, &c.UpdatedAt)
	if containerID.Valid {
		c.ContainerID = &containerID.UUID
	}
	if workspaceID.Valid {
		c.WorkspaceID = &workspaceID.UUID
	}
	return err
}

func (r *Repo) Create(userID uuid.UUID, in CreateInput) (*Card, error) {
	cardType := in.CardType
	if cardType == "" {
		cardType = "note"
	}
	color := in.Color
	if color == "" && cardType == "container" {
		color = "#fde68a"
	}
	if cardType != "container" {
		color = ""
	}
	width := in.Width
	if width <= 0 {
		width = 220
	}
	height := in.Height
	if height <= 0 {
		height = 160
	}
	c := &Card{}
	var totpSecret, totpName *string
	if cardType == "totp" {
		totpSecret = &in.TotpSecret
		totpName = &in.TotpName
	}
	err := r.db.QueryRow(`
		INSERT INTO cards(user_id,workspace_id,x,y,width,height,color,text,title,card_type,is_secret,totp_secret,totp_name)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		RETURNING `+returnCols,
		userID, in.WorkspaceID, in.X, in.Y, width, height, color, in.Text, in.Title, cardType, in.IsSecret, totpSecret, totpName,
	)
	if err := scanCard(err, c); err != nil {
		return nil, err
	}
	return c, nil
}

type UpdateInput struct {
	X, Y, Width, Height, ZIndex *int
	SidebarOrder                *int
	Color, Text, Title          *string
	IsSecret                    *bool
	IsFavorite                  *bool
	ContainerID                 *uuid.UUID
	ClearContainerID            bool
}

func (r *Repo) Update(userID, id uuid.UUID, in UpdateInput) (*Card, error) {
	c := &Card{}
	row := r.db.QueryRow(`
		UPDATE cards SET
		  x = COALESCE($3,x),
		  y = COALESCE($4,y),
		  width = COALESCE($5,width),
		  height = COALESCE($6,height),
		  z_index = COALESCE($7,z_index),
		  color = COALESCE($8,color),
		  text = COALESCE($9,text),
		  title = COALESCE($10,title),
		  is_secret = COALESCE($11,is_secret),
		  is_favorite = COALESCE($14,is_favorite),
		  sidebar_order = COALESCE($15,sidebar_order),
		  container_id = CASE WHEN $13 THEN NULL WHEN $12::uuid IS NOT NULL THEN $12::uuid ELSE container_id END,
		  updated_at = now()
		WHERE id=$1 AND user_id=$2
		RETURNING `+returnCols,
		id, userID, in.X, in.Y, in.Width, in.Height, in.ZIndex, in.Color, in.Text, in.Title, in.IsSecret,
		in.ContainerID, in.ClearContainerID, in.IsFavorite, in.SidebarOrder,
	)
	if err := scanCard(row, c); err != nil {
		return nil, err
	}
	return c, nil
}

func (r *Repo) Delete(userID, id uuid.UUID) error {
	res, err := r.db.Exec(`DELETE FROM cards WHERE id=$1 AND user_id=$2`, id, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (r *Repo) SetImage(userID, id uuid.UUID, mime string, data []byte) error {
	res, err := r.db.Exec(
		`UPDATE cards SET image_mime=$3, image_data=$4, updated_at=now() WHERE id=$1 AND user_id=$2`,
		id, userID, mime, data,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (r *Repo) ClearImage(userID, id uuid.UUID) error {
	res, err := r.db.Exec(
		`UPDATE cards SET image_mime=NULL, image_data=NULL, updated_at=now() WHERE id=$1 AND user_id=$2`,
		id, userID,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (r *Repo) GetImage(userID, id uuid.UUID) (string, []byte, error) {
	var mime sql.NullString
	var data []byte
	err := r.db.QueryRow(
		`SELECT image_mime, image_data FROM cards WHERE id=$1 AND user_id=$2`, id, userID,
	).Scan(&mime, &data)
	if err != nil {
		return "", nil, err
	}
	if !mime.Valid || data == nil {
		return "", nil, sql.ErrNoRows
	}
	return mime.String, data, nil
}

func (r *Repo) GetByID(id uuid.UUID) (*Card, error) {
	c := &Card{}
	row := r.db.QueryRow(
		`SELECT `+returnCols+` FROM cards WHERE id=$1`, id,
	)
	if err := scanCard(row, c); err != nil {
		return nil, err
	}
	return c, nil
}

func (r *Repo) OwnerOfPersonal(id uuid.UUID) (uuid.UUID, error) {
	var uid uuid.UUID
	err := r.db.QueryRow(
		`SELECT user_id FROM cards WHERE id=$1 AND workspace_id IS NULL`, id,
	).Scan(&uid)
	return uid, err
}

func (r *Repo) GetAllSecretsForScope(userID uuid.UUID, workspaceID *uuid.UUID) (map[uuid.UUID]string, error) {
	var rows *sql.Rows
	var err error
	if workspaceID == nil {
		rows, err = r.db.Query(
			`SELECT id, totp_secret FROM cards
			 WHERE user_id=$1 AND workspace_id IS NULL AND card_type='totp' AND totp_secret IS NOT NULL`,
			userID,
		)
	} else {
		rows, err = r.db.Query(
			`SELECT id, totp_secret FROM cards
			 WHERE workspace_id=$1 AND card_type='totp' AND totp_secret IS NOT NULL`,
			*workspaceID,
		)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[uuid.UUID]string)
	for rows.Next() {
		var id uuid.UUID
		var s string
		if err := rows.Scan(&id, &s); err != nil {
			return nil, err
		}
		out[id] = s
	}
	return out, rows.Err()
}
