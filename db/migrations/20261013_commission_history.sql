BEGIN;
CREATE TABLE IF NOT EXISTS commission_ledger (
  charge_id UUID PRIMARY KEY REFERENCES charges(id),
  merchant_user_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK(environment IN ('test','production')),
  network TEXT NOT NULL CHECK(network IN ('arc-mainnet')),
  gross_amount_cents BIGINT NOT NULL CHECK(gross_amount_cents>0),
  fee_cents BIGINT NOT NULL CHECK(fee_cents>=0), fee_bps INTEGER NOT NULL,
  fx_rate NUMERIC NOT NULL CHECK(fx_rate>0), usdc_raw BIGINT NOT NULL,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commission_ledger_period_idx ON commission_ledger(environment,network,earned_at,merchant_user_id);
CREATE INDEX IF NOT EXISTS charges_history_idx ON charges(environment,network,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS transactions_history_idx ON transactions(network,created_at DESC,id DESC);
-- Backfill completed deliveries; their original amount/rate/fee remain unchanged.
INSERT INTO commission_ledger(charge_id,merchant_user_id,environment,network,gross_amount_cents,fee_cents,fee_bps,fx_rate,usdc_raw,earned_at)
SELECT id,user_id,environment,network,amount_cents,fee_cents,fee_bps,fx_rate,usdc_raw,delivered_at
FROM charges WHERE delivered_at IS NOT NULL
ON CONFLICT(charge_id) DO NOTHING;
COMMIT;
