-- Invoice cession pilot (docs/factoring/PLAN_IMPLEMENTACION_PILOTO.md, section 4).
-- Idempotent. Not applied to any database: run only with explicit authorization.
BEGIN;

CREATE TABLE IF NOT EXISTS factoring_parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('issuer','investor','debtor')),
  cuit TEXT NOT NULL CHECK (cuit ~ '^[0-9]{11}$'),
  legal_name TEXT NOT NULL CHECK (char_length(legal_name) BETWEEN 1 AND 160),
  investor_type TEXT CHECK (investor_type IN ('entidad_financiera','proveedor_no_financiero_credito','persona_juridica','persona_humana')),
  kyc_status TEXT NOT NULL DEFAULT 'pending' CHECK (kyc_status IN ('pending','approved','rejected')),
  kyc_source TEXT,
  tw_customer_id TEXT CHECK (tw_customer_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  cvu TEXT CHECK (cvu ~ '^[0-9]{22}$'),
  framework_sha256 TEXT CHECK (framework_sha256 ~ '^[0-9a-f]{64}$'),
  terms_accepted_at TIMESTAMPTZ NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role),
  CHECK (role <> 'investor' OR investor_type IS NOT NULL),
  CHECK (role = 'debtor' OR cvu IS NOT NULL),
  CHECK (role = 'issuer' OR tw_customer_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS factoring_parties_debtor_cuit_uidx ON factoring_parties(cuit) WHERE role = 'debtor';

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY,
  issuer_user_id TEXT NOT NULL,
  issuer_party_id UUID NOT NULL REFERENCES factoring_parties(id),
  debtor_party_id UUID NOT NULL REFERENCES factoring_parties(id),
  idempotency_key UUID NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('form','qr')),
  simulated BOOLEAN NOT NULL,
  is_fce BOOLEAN NOT NULL,
  issuer_cuit TEXT NOT NULL CHECK (issuer_cuit ~ '^[0-9]{11}$'),
  debtor_cuit TEXT NOT NULL CHECK (debtor_cuit ~ '^[0-9]{11}$'),
  cbte_tipo INTEGER NOT NULL CHECK (cbte_tipo IN (1,6,11,201,206,211)),
  pto_vta INTEGER NOT NULL CHECK (pto_vta BETWEEN 1 AND 99999),
  cbte_nro BIGINT NOT NULL CHECK (cbte_nro BETWEEN 1 AND 99999999),
  issued_on DATE NOT NULL,
  due_on DATE NOT NULL CHECK (due_on > issued_on),
  nominal_cents BIGINT NOT NULL CHECK (nominal_cents > 0),
  currency TEXT NOT NULL DEFAULT 'PES' CHECK (currency = 'PES'),
  auth_mode TEXT CHECK (auth_mode IN ('CAE','CAEA')),
  auth_code TEXT CHECK (auth_code ~ '^[0-9]{14}$'),
  qr_payload JSONB,
  arca_status TEXT NOT NULL DEFAULT 'not_checked'
    CHECK (arca_status IN ('not_checked','pending','authorized','observed','rejected','error')),
  invoice_salt TEXT NOT NULL CHECK (invoice_salt ~ '^[0-9a-f]{64}$'),
  invoice_hash TEXT NOT NULL CHECK (invoice_hash ~ '^0x[0-9a-f]{64}$'),
  framework_sha256 TEXT CHECK (framework_sha256 ~ '^[0-9a-f]{64}$'),
  token_id TEXT UNIQUE CHECK (token_id ~ '^0x[0-9a-f]{64}$'),
  issuer_wallet TEXT CHECK (issuer_wallet ~ '^0x[0-9a-fA-F]{40}$'),
  status TEXT NOT NULL DEFAULT 'cargada' CHECK (status IN ('cargada','enviada','aceptada','rechazada','publicada',
    'oferta_vencida','tomada','pagos_en_curso','revision_manual','cedida','cobrada','en_mora')),
  acceptance_kind TEXT CHECK (acceptance_kind IN ('express','tacit')),
  sent_at TIMESTAMPTZ, accepted_at TIMESTAMPTZ, rejected_at TIMESTAMPTZ, published_at TIMESTAMPTZ,
  ceded_at TIMESTAMPTZ, collected_at TIMESTAMPTZ, defaulted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (issuer_user_id, idempotency_key),
  UNIQUE (issuer_cuit, cbte_tipo, pto_vta, cbte_nro),
  CHECK ((source = 'qr') = (qr_payload IS NOT NULL)),
  CHECK (source = 'qr' OR simulated),
  CHECK (status = 'cargada' OR (sent_at IS NOT NULL AND token_id IS NOT NULL AND issuer_wallet IS NOT NULL)),
  CHECK (status NOT IN ('aceptada','publicada','oferta_vencida','tomada','pagos_en_curso','revision_manual','cedida','cobrada','en_mora')
    OR acceptance_kind IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS invoices_issuer_idx ON invoices(issuer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS invoices_debtor_idx ON invoices(debtor_party_id, created_at DESC);
CREATE INDEX IF NOT EXISTS invoices_jobs_idx ON invoices(status, issued_on, due_on)
  WHERE status IN ('enviada','publicada','cedida','en_mora');

CREATE TABLE IF NOT EXISTS invoice_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','taken','expired','closed')),
  rate_bps INTEGER NOT NULL CHECK (rate_bps BETWEEN 1 AND 20000),
  fee_bps INTEGER NOT NULL CHECK (fee_bps BETWEEN 0 AND 10000),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  CHECK (expires_at > opened_at)
);
-- Una oferta activa por factura.
CREATE UNIQUE INDEX IF NOT EXISTS invoice_offers_active_uidx ON invoice_offers(invoice_id) WHERE status IN ('open','taken');
CREATE INDEX IF NOT EXISTS invoice_offers_open_idx ON invoice_offers(expires_at) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS invoice_takes (
  id UUID PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  offer_id UUID NOT NULL REFERENCES invoice_offers(id),
  investor_user_id TEXT NOT NULL,
  investor_party_id UUID NOT NULL REFERENCES factoring_parties(id),
  investor_wallet TEXT NOT NULL CHECK (investor_wallet ~ '^0x[0-9a-fA-F]{40}$'),
  investor_cvu TEXT NOT NULL CHECK (investor_cvu ~ '^[0-9]{22}$'),
  issuer_cvu TEXT NOT NULL CHECK (issuer_cvu ~ '^[0-9]{22}$'),
  fee_cvu TEXT NOT NULL CHECK (fee_cvu ~ '^[0-9]{22}$'),
  idempotency_key UUID NOT NULL,
  taken_on DATE NOT NULL,
  days INTEGER NOT NULL CHECK (days > 0),
  rate_bps INTEGER NOT NULL,
  fee_bps INTEGER NOT NULL,
  nominal_cents BIGINT NOT NULL CHECK (nominal_cents > 0),
  discount_cents BIGINT NOT NULL CHECK (discount_cents >= 0),
  advance_cents BIGINT NOT NULL CHECK (advance_cents > 0),
  fee_cents BIGINT NOT NULL CHECK (fee_cents >= 0),
  investor_outlay_cents BIGINT NOT NULL,
  investor_gain_cents BIGINT NOT NULL CHECK (investor_gain_cents >= 0),
  terms_hash TEXT NOT NULL CHECK (terms_hash ~ '^0x[0-9a-f]{64}$'),
  assignment_version TEXT NOT NULL,
  assignment_text TEXT NOT NULL,
  assignment_sha256 TEXT NOT NULL CHECK (assignment_sha256 ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'paying' CHECK (status IN ('paying','completed','failed_net','manual_review')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  UNIQUE (investor_user_id, idempotency_key),
  CHECK (discount_cents = nominal_cents - advance_cents),
  CHECK (investor_outlay_cents = advance_cents + fee_cents),
  CHECK (advance_cents + fee_cents + investor_gain_cents = nominal_cents)
);
-- Una toma activa o completada por factura.
CREATE UNIQUE INDEX IF NOT EXISTS invoice_takes_active_uidx ON invoice_takes(invoice_id)
  WHERE status IN ('paying','completed','manual_review');

CREATE TABLE IF NOT EXISTS factoring_orders (
  id UUID PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  take_id UUID NOT NULL REFERENCES invoice_takes(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('net_to_issuer','fee_to_midatopay','nominal_to_investor')),
  environment TEXT NOT NULL CHECK (environment IN ('simulated','staging','production')),
  payer_customer_id TEXT NOT NULL CHECK (payer_customer_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  destination_cvu TEXT NOT NULL CHECK (destination_cvu ~ '^[0-9]{22}$'),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 255),
  requested_by TEXT,
  client_key UUID,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','submitting','processing','completed','failed','cancelled','manual_review')),
  provider_order_id TEXT,
  provider_status TEXT,
  provider_error TEXT,
  provider_request_id TEXT,
  coelsa_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  UNIQUE (environment, payer_customer_id, idempotency_key),
  UNIQUE (environment, provider_order_id),
  CHECK ((purpose = 'nominal_to_investor') = (requested_by IS NOT NULL AND client_key IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS factoring_orders_take_purpose_uidx ON factoring_orders(take_id, purpose)
  WHERE purpose IN ('net_to_issuer','fee_to_midatopay') AND status NOT IN ('failed','cancelled');
CREATE UNIQUE INDEX IF NOT EXISTS factoring_orders_payment_active_uidx ON factoring_orders(invoice_id)
  WHERE purpose = 'nominal_to_investor' AND status NOT IN ('failed','cancelled');
CREATE UNIQUE INDEX IF NOT EXISTS factoring_orders_client_key_uidx ON factoring_orders(requested_by, client_key)
  WHERE client_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS factoring_orders_jobs_idx ON factoring_orders(next_attempt_at)
  WHERE status IN ('pending','submitting','processing');

CREATE TABLE IF NOT EXISTS factoring_provider_events (
  environment TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  provider_order_id TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  PRIMARY KEY (environment, event_id)
);

CREATE TABLE IF NOT EXISTS factoring_chain_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  seq INTEGER NOT NULL CHECK (seq > 0),
  kind TEXT NOT NULL CHECK (kind IN ('register','accepted','rejected','published','offer_expired','taken','cede','collected','defaulted')),
  args JSONB NOT NULL,
  network TEXT NOT NULL,
  registry_address TEXT,
  signer_address TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','broadcasting','confirmed','manual_review')),
  nonce BIGINT,
  signed_tx TEXT,
  tx_hash TEXT UNIQUE,
  block BIGINT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  UNIQUE (invoice_id, seq),
  CHECK ((tx_hash IS NULL) = (signed_tx IS NULL)),
  CHECK ((tx_hash IS NULL) = (nonce IS NULL))
);
CREATE INDEX IF NOT EXISTS factoring_chain_events_jobs_idx ON factoring_chain_events(next_attempt_at)
  WHERE status IN ('pending','broadcasting');
CREATE INDEX IF NOT EXISTS factoring_chain_events_nonce_idx ON factoring_chain_events(signer_address, network, nonce)
  WHERE nonce IS NOT NULL;

CREATE TABLE IF NOT EXISTS factoring_audit (
  id BIGSERIAL PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('issuer','debtor','investor','worker','admin')),
  actor_user_id TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS factoring_audit_invoice_idx ON factoring_audit(invoice_id, id);

CREATE TABLE IF NOT EXISTS factoring_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  take_id UUID REFERENCES invoice_takes(id),
  order_id UUID REFERENCES factoring_orders(id),
  chain_event_id UUID REFERENCES factoring_chain_events(id),
  reason TEXT NOT NULL,
  evidence JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolution TEXT CHECK (resolution IN ('retried','resolved')),
  note TEXT,
  CHECK ((resolved_at IS NULL) = (resolution IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS factoring_reviews_open_uidx ON factoring_reviews
  (invoice_id, reason, COALESCE(order_id, chain_event_id, take_id, invoice_id)) WHERE resolved_at IS NULL;

COMMIT;
