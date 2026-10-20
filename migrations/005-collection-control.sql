CREATE TABLE collection_control (
  source_id TEXT PRIMARY KEY REFERENCES sources(source_id),
  lease_owner TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  cooldown_until INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE collection_reservations (
  reservation_id INTEGER PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(source_id),
  reserved_at INTEGER NOT NULL
) STRICT;

CREATE INDEX collection_reservations_window ON collection_reservations(source_id, reserved_at, reservation_id);
