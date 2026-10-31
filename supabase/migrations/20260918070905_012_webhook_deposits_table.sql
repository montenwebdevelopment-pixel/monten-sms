/*
# Create webhook_deposits table for Flutterwave webhook deduplication

1. Problem
   Bank-transfer / virtual-account payments arrive via Flutterwave webhooks
   but may not have a matching row in `pending_deposits` (which is only
   populated by the verify edge function for card/checkout flows).
   The webhook needs a dedicated table to:
     - Store the Flutterwave transaction ID so the same payment can never
       be credited twice (unique constraint on flw_transaction_id).
     - Map each webhook event to the correct MONTEN-SMS user.
     - Track the credit status independently of the checkout flow.

2. New Tables
   - `webhook_deposits`
     - `id` (uuid, PK)
     - `flw_transaction_id` (text, NOT NULL, UNIQUE) — Flutterwave's numeric
       transaction ID from the webhook payload `data.id`. Prevents duplicate
       credits if Flutterwave retries the same webhook.
     - `tx_ref` (text) — the merchant-supplied transaction reference
     - `flw_ref` (text) — Flutterwave's internal reference
     - `user_id` (uuid, FK → auth.users) — the MONTEN-SMS user credited
     - `amount` (numeric, NOT NULL) — amount credited
     - `currency` (text) — currency code from Flutterwave
     - `payment_type` (text) — e.g. "bank_transfer", "card", "ussd"
     - `status` (text, NOT NULL, default 'pending') — pending / credited / failed
     - `credited_tx_id` (uuid, nullable) — the transactions.id returned by
       credit_wallet, so we can trace the wallet credit back to the webhook
     - `created_at` (timestamptz, default now())
     - `updated_at` (timestamptz, default now())

3. Security
   - Enable RLS on `webhook_deposits`.
   - No policies for anon or authenticated — this table is written to ONLY by
     edge functions using the service-role key (which bypasses RLS). Users
     should never read or write this table directly from the frontend.
   - This is intentional: the table is server-side only.
*/

CREATE TABLE IF NOT EXISTS public.webhook_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flw_transaction_id text NOT NULL UNIQUE,
  tx_ref text,
  flw_ref text,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  currency text,
  payment_type text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending'::text, 'credited'::text, 'failed'::text])),
  credited_tx_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.webhook_deposits ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_webhook_deposits_user_id
  ON public.webhook_deposits (user_id);

CREATE INDEX IF NOT EXISTS idx_webhook_deposits_status
  ON public.webhook_deposits (status);
