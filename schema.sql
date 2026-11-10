CREATE TABLE IF NOT EXISTS days (
  date TEXT PRIMARY KEY,          -- YYYY-MM-DD in the rollover timezone
  num INTEGER NOT NULL,           -- puzzle number shown to players
  levels TEXT NOT NULL,           -- JSON array of the day's 5 levels
  par_total INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS scores (
  date TEXT NOT NULL,
  player TEXT NOT NULL,           -- anonymous id from the player's browser
  moves INTEGER NOT NULL,         -- recomputed by the server from the move logs
  ms INTEGER NOT NULL,            -- client-reported, used only as a tiebreak
  per_level TEXT NOT NULL,        -- JSON array of moves per grid
  created INTEGER NOT NULL,
  PRIMARY KEY (date, player)      -- one scored attempt per player per day
);
CREATE INDEX IF NOT EXISTS scores_rank ON scores (date, moves, ms);
