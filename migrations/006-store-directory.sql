ALTER TABLE collection_jobs ADD COLUMN topic_label TEXT;

CREATE TABLE directory_rights (
  rights_id INTEGER PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(source_id),
  status TEXT NOT NULL CHECK (status IN ('verified', 'revoked')),
  is_current INTEGER NOT NULL CHECK (is_current IN (0, 1)),
  evidence_reference TEXT NOT NULL,
  review_reference TEXT NOT NULL,
  verified_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > verified_at),
  retention_days INTEGER NOT NULL CHECK (retention_days BETWEEN 1 AND 3660),
  allowed_zips TEXT NOT NULL CHECK (json_valid(allowed_zips)),
  UNIQUE (source_id, evidence_reference, review_reference, verified_at)
) STRICT;
CREATE UNIQUE INDEX directory_current_rights ON directory_rights(source_id) WHERE is_current = 1;

CREATE TABLE directory_runs (
  run_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(source_id),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  target_zips TEXT NOT NULL CHECK (json_valid(target_zips)),
  failure_category TEXT
) STRICT;

CREATE TABLE directory_snapshots (
  snapshot_id INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES directory_runs(run_id),
  source_id TEXT NOT NULL REFERENCES sources(source_id),
  job_key TEXT NOT NULL,
  zip_code TEXT NOT NULL,
  radius_miles INTEGER NOT NULL CHECK (radius_miles = 10),
  query_limit INTEGER NOT NULL CHECK (query_limit = 10),
  returned_store_count INTEGER NOT NULL CHECK (returned_store_count BETWEEN 0 AND 10),
  observed_at INTEGER NOT NULL,
  rights_id INTEGER NOT NULL REFERENCES directory_rights(rights_id),
  retain_until INTEGER NOT NULL,
  UNIQUE(source_id, job_key)
) STRICT;
CREATE INDEX directory_latest_snapshot ON directory_snapshots(source_id, zip_code, observed_at DESC, snapshot_id DESC);

CREATE TABLE directory_stores (
  snapshot_id INTEGER NOT NULL REFERENCES directory_snapshots(snapshot_id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 9),
  location_id TEXT NOT NULL,
  name TEXT,
  address_json TEXT NOT NULL CHECK (json_valid(address_json)),
  PRIMARY KEY(snapshot_id, location_id),
  UNIQUE(snapshot_id, position)
) STRICT;
