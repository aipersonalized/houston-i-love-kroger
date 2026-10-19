ALTER TABLE observations ADD COLUMN description TEXT;
ALTER TABLE observations ADD COLUMN brand TEXT;
CREATE INDEX observations_source_store_page ON observations(source_id, location_id, observed_at DESC, observation_id DESC);
