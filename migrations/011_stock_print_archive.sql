CREATE TABLE IF NOT EXISTS stock_print_archive (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  trade_id TEXT NOT NULL,
  trade_timestamp TIMESTAMPTZ NOT NULL,
  price NUMERIC(18,6) NOT NULL CHECK (price > 0),
  size BIGINT NOT NULL CHECK (size > 0),
  notional NUMERIC(24,6) NOT NULL CHECK (notional >= 0),
  exchange TEXT,
  trade_side TEXT,
  source TEXT NOT NULL DEFAULT 'stockflow_tradier_timesale',
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (symbol, trade_id, trade_timestamp)
);

CREATE INDEX IF NOT EXISTS stock_print_archive_timestamp_idx
  ON stock_print_archive (trade_timestamp DESC);

CREATE INDEX IF NOT EXISTS stock_print_archive_symbol_timestamp_idx
  ON stock_print_archive (symbol, trade_timestamp DESC);
