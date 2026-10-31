ALTER TABLE purchased_numbers
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

UPDATE purchased_numbers
SET expires_at = created_at + interval '5 minutes'
WHERE expires_at IS NULL;
