package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"time"

	"github.com/google/uuid"
)

var ErrRefreshInvalid = errors.New("refresh token invalid")

func generateRaw() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func hashRaw(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func IssueRefreshToken(db *sql.DB, userID uuid.UUID, ttl time.Duration) (string, error) {
	raw, err := generateRaw()
	if err != nil {
		return "", err
	}
	_, err = db.Exec(
		`INSERT INTO refresh_tokens(user_id, token_hash, expires_at) VALUES($1,$2,$3)`,
		userID, hashRaw(raw), time.Now().Add(ttl),
	)
	if err != nil {
		return "", err
	}
	return raw, nil
}

func ValidateRefreshToken(db *sql.DB, raw string) (uuid.UUID, error) {
	if raw == "" {
		return uuid.Nil, ErrRefreshInvalid
	}
	var uid uuid.UUID
	var expires time.Time
	var revoked bool
	err := db.QueryRow(
		`SELECT user_id, expires_at, revoked FROM refresh_tokens WHERE token_hash=$1`,
		hashRaw(raw),
	).Scan(&uid, &expires, &revoked)
	if err == sql.ErrNoRows {
		return uuid.Nil, ErrRefreshInvalid
	}
	if err != nil {
		return uuid.Nil, err
	}
	if revoked || time.Now().After(expires) {
		return uuid.Nil, ErrRefreshInvalid
	}
	return uid, nil
}

func RotateRefreshToken(db *sql.DB, oldRaw string, ttl time.Duration) (string, error) {
	uid, err := ValidateRefreshToken(db, oldRaw)
	if err != nil {
		return "", err
	}
	tx, err := db.Begin()
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec(`UPDATE refresh_tokens SET revoked=TRUE WHERE token_hash=$1`, hashRaw(oldRaw)); err != nil {
		_ = tx.Rollback()
		return "", err
	}
	raw, err := generateRaw()
	if err != nil {
		_ = tx.Rollback()
		return "", err
	}
	if _, err := tx.Exec(
		`INSERT INTO refresh_tokens(user_id, token_hash, expires_at) VALUES($1,$2,$3)`,
		uid, hashRaw(raw), time.Now().Add(ttl),
	); err != nil {
		_ = tx.Rollback()
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return raw, nil
}

func RevokeRefreshToken(db *sql.DB, raw string) error {
	if raw == "" {
		return nil
	}
	_, err := db.Exec(`UPDATE refresh_tokens SET revoked=TRUE WHERE token_hash=$1`, hashRaw(raw))
	return err
}
