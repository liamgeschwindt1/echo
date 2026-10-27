-- Saved simulations. Each save appends an immutable version; the parent row tracks the latest one.
CREATE TABLE simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  latest_version integer NOT NULL DEFAULT 0,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX simulations_updated_at_idx ON simulations (updated_at DESC);

CREATE TABLE simulation_versions (
  simulation_id uuid NOT NULL REFERENCES simulations (id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  scenario jsonb NOT NULL,
  results jsonb,
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  size_bytes integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (simulation_id, version)
);
