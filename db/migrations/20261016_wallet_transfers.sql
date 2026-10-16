BEGIN;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS privy_wallet_id TEXT;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS hd_wallet_index INTEGER;
CREATE TABLE IF NOT EXISTS wallet_identity_audit (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id TEXT NOT NULL, network TEXT NOT NULL,
 previous_address TEXT NOT NULL, primary_address TEXT NOT NULL, verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wallet_transfers (
 id UUID PRIMARY KEY, user_id TEXT NOT NULL, network TEXT NOT NULL,
 from_address TEXT NOT NULL, to_address TEXT NOT NULL, usdc_raw BIGINT NOT NULL CHECK(usdc_raw>0),
 kind TEXT NOT NULL CHECK(kind IN ('pay','voice','charge_p2p')), recipient_name TEXT NOT NULL,
 idempotency_key UUID NOT NULL, status TEXT NOT NULL DEFAULT 'awaiting_signature',
 unsigned_wire TEXT NOT NULL, last_valid_block_height BIGINT NOT NULL, memo TEXT NOT NULL,
 fee_payer TEXT NOT NULL, cost_lamports BIGINT NOT NULL CHECK(cost_lamports>0),
 signature TEXT UNIQUE, signed_wire TEXT, sponsor_day DATE, submitted_at TIMESTAMPTZ,
 fx_rate NUMERIC NOT NULL, ars NUMERIC NOT NULL, block BIGINT, last_error TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), finalized_at TIMESTAMPTZ,
 next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(user_id,network,idempotency_key)
);
CREATE INDEX IF NOT EXISTS wallet_transfers_user_idx ON wallet_transfers(user_id,network,created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_transfers_jobs_idx ON wallet_transfers(next_attempt_at) WHERE signature IS NOT NULL AND status IN ('broadcasting','confirmed','manual_review');
CREATE INDEX IF NOT EXISTS wallet_transfers_budget_idx ON wallet_transfers(network,sponsor_day) WHERE signature IS NOT NULL;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_id UUID REFERENCES wallet_transfers(id);
CREATE UNIQUE INDEX IF NOT EXISTS transactions_transfer_uidx ON transactions(transfer_id) WHERE transfer_id IS NOT NULL;
COMMIT;
