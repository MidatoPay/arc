-- Agenda de contactos — se corre a mano una vez contra Aiven (psql o su consola web).
-- Ver docs/superpowers/specs/2026-08-05-contacts-agenda-design.md § 1.2

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,           -- Privy DID (p.ej. "did:privy:abc123")
  name        TEXT NOT NULL,
  alias       TEXT NOT NULL,
  address     TEXT NOT NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contacts_user_id_idx ON contacts (user_id);

-- UNIQUE de tabla no acepta expresiones (LOWER(alias)) — hace falta un
-- índice único aparte para el alias case-insensitive por usuario.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_user_alias_uidx ON contacts (user_id, LOWER(alias));
