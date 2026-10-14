BEGIN;
CREATE TABLE IF NOT EXISTS merchant_pos_assignments (
  environment TEXT NOT NULL CHECK(environment IN ('test','production')),
  seller_id TEXT NOT NULL,
  merchant_email TEXT NOT NULL CHECK(merchant_email=lower(merchant_email)),
  external_id TEXT NOT NULL,
  pos_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  pos_name TEXT NOT NULL,
  claimed_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ,
  PRIMARY KEY(environment,seller_id,merchant_email),
  UNIQUE(environment,seller_id,external_id),
  UNIQUE(environment,seller_id,pos_id),
  UNIQUE(environment,seller_id,claimed_user_id)
);
COMMIT;
