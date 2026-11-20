CREATE TABLE telemetry_runs (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, install TEXT NOT NULL, id TEXT NOT NULL,
  received INTEGER NOT NULL, payload TEXT NOT NULL, UNIQUE(install,id)
);
CREATE INDEX telemetry_runs_quota ON telemetry_runs(install,received);
CREATE TABLE telemetry_reports (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, install TEXT NOT NULL, id TEXT NOT NULL,
  received INTEGER NOT NULL, version TEXT NOT NULL, category TEXT NOT NULL, note TEXT NOT NULL,
  replay BLOB, screenshot BLOB, UNIQUE(install,id)
);
CREATE INDEX telemetry_reports_quota ON telemetry_reports(install,received);
-- A short-lived digest prevents late requests from recreating deleted data.
CREATE TABLE telemetry_deleted (install TEXT PRIMARY KEY, until INTEGER NOT NULL);
CREATE INDEX telemetry_deleted_expiry ON telemetry_deleted(until);
