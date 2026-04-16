package cardtypecolors

import (
	"database/sql"

	"github.com/google/uuid"
)

var Defaults = map[string]string{
	"note":     "#fde68a",
	"secret":   "#fbcfe8",
	"image":    "#bfdbfe",
	"totp":     "#bbf7d0",
	"password": "#ddd6fe",
}

func IsKnownType(t string) bool {
	_, ok := Defaults[t]
	return ok
}

type Repo struct{ db *sql.DB }

func NewRepo(db *sql.DB) *Repo { return &Repo{db: db} }

func (r *Repo) List(userID uuid.UUID) (map[string]string, error) {
	rows, err := r.db.Query(`SELECT card_type, color FROM card_type_colors WHERE user_id=$1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var t, c string
		if err := rows.Scan(&t, &c); err != nil {
			return nil, err
		}
		out[t] = c
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	missing := false
	for t := range Defaults {
		if _, ok := out[t]; !ok {
			missing = true
			break
		}
	}
	if !missing {
		return out, nil
	}
	tx, err := r.db.Begin()
	if err != nil {
		return nil, err
	}
	for t, def := range Defaults {
		if _, ok := out[t]; ok {
			continue
		}
		if _, err := tx.Exec(
			`INSERT INTO card_type_colors(user_id, card_type, color) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
			userID, t, def,
		); err != nil {
			_ = tx.Rollback()
			return nil, err
		}
		out[t] = def
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}

func (r *Repo) Upsert(userID uuid.UUID, cardType, color string) error {
	_, err := r.db.Exec(`
		INSERT INTO card_type_colors(user_id, card_type, color)
		VALUES($1,$2,$3)
		ON CONFLICT (user_id, card_type) DO UPDATE
		SET color = EXCLUDED.color, updated_at = now()`,
		userID, cardType, color,
	)
	return err
}
