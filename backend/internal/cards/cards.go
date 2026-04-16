package cards

import (
	"database/sql"
	"time"

	"github.com/google/uuid"
)

type Card struct {
	ID        uuid.UUID `json:"id"`
	X         int       `json:"x"`
	Y         int       `json:"y"`
	Width     int       `json:"width"`
	Height    int       `json:"height"`
	Color     string    `json:"color"`
	Text      string    `json:"text"`
	HasImage  bool      `json:"has_image"`
	ZIndex    int       `json:"z_index"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Repo struct{ db *sql.DB }

func NewRepo(db *sql.DB) *Repo { return &Repo{db: db} }

func (r *Repo) List(userID uuid.UUID) ([]Card, error) {
	rows, err := r.db.Query(`
		SELECT id,x,y,width,height,color,text,(image_data IS NOT NULL),z_index,updated_at
		FROM cards WHERE user_id=$1 ORDER BY z_index ASC, created_at ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Card{}
	for rows.Next() {
		var c Card
		if err := rows.Scan(&c.ID, &c.X, &c.Y, &c.Width, &c.Height, &c.Color, &c.Text, &c.HasImage, &c.ZIndex, &c.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

type CreateInput struct {
	X, Y        int
	Color, Text string
}

func (r *Repo) Create(userID uuid.UUID, in CreateInput) (*Card, error) {
	color := in.Color
	if color == "" {
		color = "#fde68a"
	}
	c := &Card{}
	err := r.db.QueryRow(`
		INSERT INTO cards(user_id,x,y,color,text)
		VALUES($1,$2,$3,$4,$5)
		RETURNING id,x,y,width,height,color,text,(image_data IS NOT NULL),z_index,updated_at`,
		userID, in.X, in.Y, color, in.Text,
	).Scan(&c.ID, &c.X, &c.Y, &c.Width, &c.Height, &c.Color, &c.Text, &c.HasImage, &c.ZIndex, &c.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return c, nil
}

type UpdateInput struct {
	X, Y, Width, Height, ZIndex *int
	Color, Text                 *string
}

func (r *Repo) Update(userID, id uuid.UUID, in UpdateInput) (*Card, error) {
	c := &Card{}
	err := r.db.QueryRow(`
		UPDATE cards SET
		  x = COALESCE($3,x),
		  y = COALESCE($4,y),
		  width = COALESCE($5,width),
		  height = COALESCE($6,height),
		  z_index = COALESCE($7,z_index),
		  color = COALESCE($8,color),
		  text = COALESCE($9,text),
		  updated_at = now()
		WHERE id=$1 AND user_id=$2
		RETURNING id,x,y,width,height,color,text,(image_data IS NOT NULL),z_index,updated_at`,
		id, userID, in.X, in.Y, in.Width, in.Height, in.ZIndex, in.Color, in.Text,
	).Scan(&c.ID, &c.X, &c.Y, &c.Width, &c.Height, &c.Color, &c.Text, &c.HasImage, &c.ZIndex, &c.UpdatedAt)
	if err != nil {
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
