CREATE TABLE IF NOT EXISTS seasonal_finish (
  season INTEGER NOT NULL, board TEXT NOT NULL, seed INTEGER NOT NULL, hash INTEGER NOT NULL,
  pilot TEXT NOT NULL, points INTEGER NOT NULL, score INTEGER NOT NULL, bonus INTEGER NOT NULL,
  stage INTEGER NOT NULL, kills INTEGER NOT NULL, time REAL NOT NULL,
  difficulty TEXT NOT NULL, replay_version INTEGER NOT NULL, version TEXT NOT NULL,
  PRIMARY KEY (season,board,seed,hash)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS seasonal_best ON seasonal_finish(season,board,pilot,points DESC);
CREATE INDEX IF NOT EXISTS seasonal_history ON seasonal_finish(pilot,season,board);
