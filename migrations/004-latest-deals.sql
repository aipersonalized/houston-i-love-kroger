ALTER TABLE collection_jobs ADD COLUMN rights_id INTEGER REFERENCES source_rights(rights_id);
ALTER TABLE collection_jobs ADD COLUMN retain_until INTEGER CHECK (retain_until IS NULL OR retain_until > observed_at);
ALTER TABLE collection_runs ADD COLUMN target_scope TEXT CHECK (target_scope IS NULL OR json_valid(target_scope));
ALTER TABLE observations ADD COLUMN instore INTEGER CHECK (instore IS NULL OR instore IN (0, 1));
ALTER TABLE observations ADD COLUMN stock_level TEXT;
ALTER TABLE observations ADD COLUMN reported_regular REAL;
ALTER TABLE observations ADD COLUMN reported_promo REAL;
ALTER TABLE observations ADD COLUMN price_qualified INTEGER CHECK (price_qualified IS NULL OR price_qualified IN (0, 1));

CREATE INDEX jobs_latest_snapshot ON collection_jobs(source_id, location_id, topic_key, observed_at DESC, job_id DESC);
CREATE INDEX observations_latest_item ON observations(source_id, location_id, product_id, item_id, observed_at DESC, observation_id DESC);
