BEGIN;
ALTER TABLE charges ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
-- Older charges retain the last known observation of an accredited payment.
UPDATE charges SET paid_at=COALESCE(delivered_at,reconciled_at)
WHERE paid_at IS NULL AND provider_status='processed' AND provider_detail='accredited';
COMMIT;
