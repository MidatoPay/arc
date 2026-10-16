BEGIN;
-- Preserve the original signed transaction before an explicitly reviewed retry.
CREATE TABLE IF NOT EXISTS payment_payout_attempts (
  signature TEXT PRIMARY KEY,
  charge_id UUID NOT NULL REFERENCES charges(id),
  signed_wire TEXT NOT NULL,
  last_valid_block_height BIGINT NOT NULL,
  payout_memo TEXT,
  reason TEXT NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_payout_attempts_charge_idx ON payment_payout_attempts(charge_id);
COMMIT;
