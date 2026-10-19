CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at INTEGER NOT NULL
) STRICT;

CREATE TABLE sources (
  source_id TEXT PRIMARY KEY,
  source_label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'verified', 'revoked')),
  current_rights_id INTEGER,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE source_rights (
  rights_id INTEGER PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(source_id),
  status TEXT NOT NULL CHECK (status IN ('verified', 'revoked')),
  evidence_reference TEXT NOT NULL,
  review_reference TEXT NOT NULL,
  verified_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > verified_at),
  retention_days INTEGER NOT NULL CHECK (retention_days BETWEEN 1 AND 3660),
  collection_allowed INTEGER NOT NULL CHECK (collection_allowed IN (0, 1)),
  display_allowed INTEGER NOT NULL CHECK (display_allowed IN (0, 1)),
  agent_access_allowed INTEGER NOT NULL CHECK (agent_access_allowed IN (0, 1)),
  allowed_locations TEXT NOT NULL CHECK (json_valid(allowed_locations)),
  allowed_topics TEXT NOT NULL CHECK (json_valid(allowed_topics)),
  UNIQUE (source_id, evidence_reference, review_reference, verified_at)
) STRICT;

CREATE TABLE collection_runs (
  run_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(source_id),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'blocked')),
  failure_category TEXT,
  target_count INTEGER NOT NULL CHECK (target_count BETWEEN 0 AND 10),
  page_limit INTEGER NOT NULL CHECK (page_limit BETWEEN 1 AND 50),
  observation_count INTEGER NOT NULL DEFAULT 0 CHECK (observation_count >= 0),
  coverage_type TEXT NOT NULL CHECK (coverage_type = 'bounded_topic_sample')
) STRICT;

CREATE TABLE collection_jobs (
  job_id INTEGER PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(source_id),
  job_key TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES collection_runs(run_id),
  location_id TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  returned_product_count INTEGER NOT NULL CHECK (returned_product_count >= 0),
  UNIQUE (source_id, job_key)
) STRICT;

CREATE TABLE observations (
  observation_id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES collection_jobs(job_id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(source_id),
  rights_id INTEGER NOT NULL REFERENCES source_rights(rights_id),
  location_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  size TEXT,
  sold_by TEXT,
  currency TEXT,
  price_basis TEXT,
  modality TEXT,
  eligibility_key TEXT,
  regular_cents INTEGER CHECK (regular_cents IS NULL OR regular_cents >= 0),
  promo_cents INTEGER CHECK (promo_cents IS NULL OR promo_cents >= 0),
  regular_unit_estimate REAL CHECK (regular_unit_estimate IS NULL OR regular_unit_estimate >= 0),
  promo_unit_estimate REAL CHECK (promo_unit_estimate IS NULL OR promo_unit_estimate >= 0),
  unit_basis TEXT,
  effective_date TEXT CHECK (effective_date IS NULL OR json_valid(effective_date)),
  expiration_date TEXT CHECK (expiration_date IS NULL OR json_valid(expiration_date)),
  date_qualified INTEGER NOT NULL CHECK (date_qualified IN (0, 1)),
  observed_at INTEGER NOT NULL,
  retain_until INTEGER NOT NULL CHECK (retain_until > observed_at),
  UNIQUE (job_id, product_id, item_id)
) STRICT;

CREATE INDEX observations_lookup ON observations(location_id, product_id, item_id, observed_at DESC);
CREATE INDEX observations_retention ON observations(source_id, retain_until);
CREATE INDEX jobs_run ON collection_jobs(run_id);
