BEGIN;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS network TEXT NOT NULL DEFAULT 'devnet';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS charge_id UUID;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_user_hash_key;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_user_network_hash_uidx ON transactions(user_id, network, hash);
CREATE UNIQUE INDEX IF NOT EXISTS transactions_charge_uidx ON transactions(charge_id) WHERE charge_id IS NOT NULL;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS network TEXT NOT NULL DEFAULT 'devnet';
ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_pkey;
ALTER TABLE wallets ADD PRIMARY KEY(user_id, network);

CREATE TABLE IF NOT EXISTS payment_user_blocks (
  user_id TEXT NOT NULL, environment TEXT NOT NULL, reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(user_id, environment)
);
CREATE TABLE IF NOT EXISTS charges (
  id UUID PRIMARY KEY, user_id TEXT NOT NULL, wallet_address TEXT NOT NULL,
  environment TEXT NOT NULL CHECK(environment IN ('test','production')),
  network TEXT NOT NULL CHECK(network IN ('devnet','mainnet-beta')),
  seller_id TEXT NOT NULL, pos_id TEXT NOT NULL, treasury_address TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK(amount_cents > 0), fee_cents BIGINT NOT NULL,
  fee_bps INTEGER NOT NULL CHECK(fee_bps = 50), usdc_raw BIGINT NOT NULL CHECK(usdc_raw >= 10000),
  fx_rate NUMERIC NOT NULL CHECK(fx_rate > 0), quote_round TEXT NOT NULL, quote_updated_at TIMESTAMPTZ NOT NULL,
  external_reference TEXT NOT NULL UNIQUE, idempotency_key UUID NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'creating', order_body JSONB NOT NULL,
  order_id TEXT, payment_id TEXT, qr_data TEXT, provider_status TEXT, provider_detail TEXT,
  reserved BOOLEAN NOT NULL DEFAULT true, cancel_requested BOOLEAN NOT NULL DEFAULT false,
  signature TEXT UNIQUE, signed_wire TEXT, last_valid_block_height BIGINT, payout_memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ, reconciled_at TIMESTAMPTZ, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  UNIQUE(user_id, environment, idempotency_key), UNIQUE(environment, order_id), UNIQUE(environment, payment_id)
);
CREATE INDEX IF NOT EXISTS charges_user_idx ON charges(user_id, environment, created_at DESC);
CREATE INDEX IF NOT EXISTS charges_jobs_idx ON charges(next_attempt_at);
CREATE TABLE IF NOT EXISTS payment_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), environment TEXT NOT NULL,
  event_key TEXT NOT NULL, order_id TEXT NOT NULL, payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(), processed_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(), attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT, quarantined BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(environment, event_key)
);
CREATE INDEX IF NOT EXISTS payment_inbox_pending_idx ON payment_inbox(next_attempt_at) WHERE processed_at IS NULL;
CREATE TABLE IF NOT EXISTS payment_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), charge_id UUID NOT NULL REFERENCES charges(id),
  reason TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), resolved_at TIMESTAMPTZ,
  UNIQUE(charge_id, reason)
);
COMMIT;
