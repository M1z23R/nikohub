CREATE TABLE card_favorites (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id       UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  sidebar_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, card_id)
);
CREATE INDEX idx_card_favorites_card ON card_favorites(card_id);

INSERT INTO card_favorites (user_id, card_id, sidebar_order)
SELECT user_id, id, sidebar_order FROM cards WHERE is_favorite = true;

ALTER TABLE cards DROP COLUMN is_favorite;
ALTER TABLE cards DROP COLUMN sidebar_order;
