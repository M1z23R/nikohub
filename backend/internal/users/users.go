package users

import (
	"database/sql"
	"time"

	"github.com/google/uuid"
)

type User struct {
	ID        uuid.UUID `json:"id"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	AvatarURL string    `json:"avatar_url"`
	CreatedAt time.Time `json:"created_at"`
}

type Repo struct{ db *sql.DB }

func NewRepo(db *sql.DB) *Repo { return &Repo{db: db} }

// UpsertByGoogleSub inserts a new user or updates mutable fields; returns the resulting user.
func (r *Repo) UpsertByGoogleSub(sub, email, name, avatar string) (*User, error) {
	const q = `
		INSERT INTO users (google_sub, email, name, avatar_url)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (google_sub) DO UPDATE SET
		  email = EXCLUDED.email,
		  name = EXCLUDED.name,
		  avatar_url = EXCLUDED.avatar_url
		RETURNING id, email, name, coalesce(avatar_url,''), created_at
	`
	u := &User{}
	err := r.db.QueryRow(q, sub, email, name, avatar).
		Scan(&u.ID, &u.Email, &u.Name, &u.AvatarURL, &u.CreatedAt)
	if err != nil {
		return nil, err
	}
	return u, nil
}

func (r *Repo) Get(id uuid.UUID) (*User, error) {
	u := &User{}
	err := r.db.QueryRow(
		`SELECT id,email,name,coalesce(avatar_url,''),created_at FROM users WHERE id=$1`, id,
	).Scan(&u.ID, &u.Email, &u.Name, &u.AvatarURL, &u.CreatedAt)
	if err != nil {
		return nil, err
	}
	return u, nil
}
