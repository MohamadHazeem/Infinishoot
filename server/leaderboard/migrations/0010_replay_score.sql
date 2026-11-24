CREATE TABLE IF NOT EXISTS replay_score (
  board TEXT NOT NULL, receipt TEXT NOT NULL, hero TEXT NOT NULL, score INTEGER NOT NULL,
  stage INTEGER NOT NULL, kills INTEGER NOT NULL, time INTEGER NOT NULL, date TEXT NOT NULL,
  PRIMARY KEY (board,receipt)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS replay_score_rank ON replay_score(board,score DESC,receipt);
