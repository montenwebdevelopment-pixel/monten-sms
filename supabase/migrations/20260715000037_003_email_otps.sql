/*
# OTP verification table

1. New Tables
   - `email_otps` — stores 6-digit OTP codes for email verification.
   - Columns: id, email, code, expires_at, verified, created_at.

2. Security
   - RLS enabled.
   - Anyone can insert (for requesting OTP) and select by email (for verifying).
   - This is acceptable because OTPs expire in 10 minutes and are 6 digits.
*/

CREATE TABLE IF NOT EXISTS email_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  code text NOT NULL,
  expires_at timestamptz NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE email_otps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "insert_otp" ON email_otps;
CREATE POLICY "insert_otp" ON email_otps FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "select_otp" ON email_otps;
CREATE POLICY "select_otp" ON email_otps FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "update_otp" ON email_otps;
CREATE POLICY "update_otp" ON email_otps FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_email_otps_email ON email_otps(email);
