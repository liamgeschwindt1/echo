-- Sound and mic array models created in the simulator library. Body is the validated model JSON.
CREATE TABLE library_models (
  kind text NOT NULL CHECK (kind IN ('array', 'sound')),
  id text NOT NULL CHECK (id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, id)
);
