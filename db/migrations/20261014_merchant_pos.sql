BEGIN;
CREATE TABLE IF NOT EXISTS merchant_payment_pos (
  user_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK(environment IN ('test','production')),
  seller_id TEXT NOT NULL,
  merchant_email TEXT NOT NULL,
  pos_name TEXT NOT NULL,
  store_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  pos_id TEXT,
  creation_key UUID NOT NULL UNIQUE,
  creation_body JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'creating' CHECK(status IN ('creating','ready')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,environment,seller_id),
  UNIQUE(environment,seller_id,external_id),
  UNIQUE(environment,seller_id,pos_id)
);
COMMIT;
