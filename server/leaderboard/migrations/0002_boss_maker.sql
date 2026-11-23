CREATE TABLE IF NOT EXISTS maker_design (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, published INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS maker_vote (
  week INTEGER NOT NULL, design TEXT NOT NULL REFERENCES maker_design(id),
  voter TEXT NOT NULL, stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  PRIMARY KEY (week, design, voter)
);
CREATE INDEX IF NOT EXISTS maker_votes_by_design ON maker_vote (design, week);
CREATE INDEX IF NOT EXISTS maker_newest ON maker_design (published DESC);
