-- DT FLOW STEP 19 - Watchlists
-- Existing watchlist tables are created in 001_initial_schema.sql.
-- This migration adds safe indexes and a user/sort lookup index.
CREATE INDEX IF NOT EXISTS idx_watchlists_user_created ON watchlists(user_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_watchlist_items_symbol ON watchlist_items(symbol);
