CREATE TABLE IF NOT EXISTS options_flow_archive (
  id BIGSERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_timestamp TIMESTAMPTZ NOT NULL,
  contract TEXT NOT NULL,
  option_type TEXT,
  strike NUMERIC(18,6),
  expiration DATE,
  contracts INTEGER NOT NULL CHECK (contracts > 0),
  premium NUMERIC(24,6) NOT NULL CHECK (premium > 0),
  notional NUMERIC(24,6),
  direction TEXT NOT NULL CHECK (direction IN ('BUY')),
  direction_confidence NUMERIC(8,6),
  order_type TEXT,
  source TEXT NOT NULL DEFAULT 'optionwhales',
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ticker, event_id, event_timestamp)
);

CREATE INDEX IF NOT EXISTS options_flow_archive_timestamp_idx
  ON options_flow_archive (event_timestamp DESC);

CREATE INDEX IF NOT EXISTS options_flow_archive_ticker_timestamp_idx
  ON options_flow_archive (ticker, event_timestamp DESC);
