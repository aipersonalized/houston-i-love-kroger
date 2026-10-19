ALTER TABLE collection_jobs ADD COLUMN topic_key TEXT;
CREATE INDEX jobs_topic_scope ON collection_jobs(source_id, location_id, topic_key);
