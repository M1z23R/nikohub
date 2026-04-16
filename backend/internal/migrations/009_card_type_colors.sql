CREATE TABLE card_type_colors (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_type  TEXT NOT NULL,
  color      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, card_type)
);
