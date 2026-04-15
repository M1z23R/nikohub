package db

import (
	"database/sql"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

func Open(url string) (*sql.DB, error) {
	d, err := sql.Open("postgres", url)
	if err != nil {
		return nil, err
	}
	d.SetMaxOpenConns(20)
	d.SetMaxIdleConns(5)
	d.SetConnMaxLifetime(30 * time.Minute)
	if err := d.Ping(); err != nil {
		return nil, fmt.Errorf("ping: %w", err)
	}
	return d, nil
}
