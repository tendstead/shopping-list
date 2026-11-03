CREATE TABLE shared_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  body jsonb NOT NULL
);
CREATE TABLE trip_history (
  id text PRIMARY KEY,
  completed_at timestamptz NOT NULL,
  snapshot jsonb NOT NULL
);
CREATE TABLE acknowledged_operations (
  id text PRIMARY KEY,
  request_hash text NOT NULL,
  history_id text REFERENCES trip_history(id),
  acknowledged_at timestamptz NOT NULL DEFAULT now()
);
