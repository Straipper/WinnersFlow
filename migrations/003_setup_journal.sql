-- DT FLOW STEP 18 — setup history / journal helpers
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS setup_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS result_status TEXT CHECK (result_status IN ('open','win','loss','breakeven','cancelled'));

ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS r_multiple NUMERIC(12,4);

ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS outcome_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_journal_setup ON journal_entries(setup_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_journal_user_closed ON journal_entries(user_id, closed_at DESC);
