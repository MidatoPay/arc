BEGIN;
CREATE TABLE IF NOT EXISTS merchant_profiles (
  user_id TEXT PRIMARY KEY, -- Authenticated Privy DID; one business profile per user.
  user_name TEXT NOT NULL CHECK (char_length(user_name) BETWEEN 1 AND 100),
  business_name TEXT CHECK (business_name IS NULL OR
    (char_length(business_name) BETWEEN 1 AND 100 AND business_name = btrim(business_name))),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMIT;
