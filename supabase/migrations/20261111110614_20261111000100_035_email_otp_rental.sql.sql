/*
  # Email OTP Rental service (MailOtp)

  1. New Tables
     - `email_otp_config`: single-row reseller settings — `usd_to_naira` rate,
       `margin_naira` added on top of the provider's USD price, and per-service
       price overrides in `service_overrides` (jsonb).
     - `email_otp_orders`: one row per MailOtp task a customer owns: MailOtp task
       id, service, site, rented email address, provider cost (USD), customer
       charge (NGN), lifecycle status, and a unique `idempotency_key` so a
       retried purchase can never create two orders or charge twice.
     - `email_otp_codes`: one row per delivered code, keyed to its order, with
       sender, subject, provider received-at, and whether this delivery was a
       free repeat.

  2. Modified Tables
     - none. Wallet charges and refunds reuse the existing
       debit_wallet_for_user / refund_wallet_for_user RPCs.

  3. Security
     - RLS enabled on all three tables.
     - Orders and codes: owner-scoped SELECT for authenticated only; every write
       happens server-side with the service role.
     - Config: readable by signed-in customers for live pricing; writable only
       by service_role.
     - The three new SECURITY DEFINER helpers execute for service_role only.

  4. Notes
     - `mailotp_task_id` is unique so /again reuses are tracked per task.
     - `status` mirrors MailOtp's lifecycle: waiting, received, timeout,
       cancelled, failed. `charged_free` marks a free /again task that received
       no code, kept distinct so a free code does not extend the paid window.
*/

-- ============ email_otp_config ============
CREATE TABLE IF NOT EXISTS public.email_otp_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  usd_to_naira numeric NOT NULL DEFAULT 1600 CHECK (usd_to_naira > 0),
  margin_naira numeric NOT NULL DEFAULT 500 CHECK (margin_naira >= 0),
  service_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.email_otp_config (id)
SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM public.email_otp_config WHERE id = 1);

ALTER TABLE public.email_otp_config ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.email_otp_config TO authenticated;

DROP POLICY IF EXISTS "select_email_otp_config" ON public.email_otp_config;
CREATE POLICY "select_email_otp_config" ON public.email_otp_config
  FOR SELECT TO authenticated USING (true);

-- ============ email_otp_orders ============
CREATE TABLE IF NOT EXISTS public.email_otp_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL UNIQUE,
  mailotp_task_id text UNIQUE,
  mailotp_source_task_id text,
  service text NOT NULL,
  site text,
  email_address text,
  provider_price_usd numeric(12,6),
  charge_naira numeric NOT NULL DEFAULT 0 CHECK (charge_naira >= 0),
  charge_reference text,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','received','timeout','cancelled','failed','charged_free')),
  mailotp_created_at timestamptz,
  expires_at timestamptz,
  last_code_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_otp_orders_user
  ON public.email_otp_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_otp_orders_email
  ON public.email_otp_orders (email_address);

ALTER TABLE public.email_otp_orders ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.email_otp_orders TO authenticated, service_role;

DROP POLICY IF EXISTS "select_own_email_otp_orders" ON public.email_otp_orders;
CREATE POLICY "select_own_email_otp_orders" ON public.email_otp_orders
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ============ email_otp_codes ============
CREATE TABLE IF NOT EXISTS public.email_otp_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.email_otp_orders(id) ON DELETE CASCADE,
  code text NOT NULL,
  sender text,
  subject text,
  provider_received_at timestamptz,
  was_free_repeat boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, code, provider_received_at)
);

CREATE INDEX IF NOT EXISTS idx_email_otp_codes_order
  ON public.email_otp_codes (order_id, created_at DESC);

ALTER TABLE public.email_otp_codes ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.email_otp_codes TO authenticated, service_role;

DROP POLICY IF EXISTS "select_own_email_otp_codes" ON public.email_otp_codes;
CREATE POLICY "select_own_email_otp_codes" ON public.email_otp_codes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.email_otp_orders o
      WHERE o.id = email_otp_codes.order_id AND o.user_id = auth.uid()
    )
  );

-- ============ claim_email_otp_order ============
-- Atomically claims an idempotency key for a customer. Returns the existing
-- order when the key was already claimed (the caller then resolves its state),
-- or inserts a new pending row and reports created = true.
CREATE OR REPLACE FUNCTION public.claim_email_otp_order(
  p_user_id uuid,
  p_idempotency_key text,
  p_service text,
  p_source_task_id text DEFAULT NULL
)
RETURNS TABLE (created boolean, order_id uuid, email_address text, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_row public.email_otp_orders%ROWTYPE;
  new_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT';
  END IF;

  SELECT * INTO existing_row
  FROM public.email_otp_orders
  WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF existing_row.user_id <> p_user_id THEN
      RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    RETURN QUERY SELECT false, existing_row.id, existing_row.email_address, existing_row.status;
    RETURN;
  END IF;

  INSERT INTO public.email_otp_orders
    (user_id, idempotency_key, service, mailotp_source_task_id, status)
  VALUES
    (p_user_id, p_idempotency_key, p_service, p_source_task_id, 'waiting')
  RETURNING id INTO new_id;

  RETURN QUERY SELECT true, new_id, NULL::text, 'waiting'::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_email_otp_order(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_email_otp_order(uuid, text, text, text) TO service_role;

-- ============ finalize_email_otp_order ============
-- Server-side fill of provider fields after MailOtp accepted the task. Refuses
-- to overwrite an order that already has a task id (duplicate protection).
CREATE OR REPLACE FUNCTION public.finalize_email_otp_order(
  p_order_id uuid,
  p_user_id uuid,
  p_mailotp_task_id text,
  p_email_address text,
  p_provider_price_usd numeric,
  p_charge_naira numeric,
  p_charge_reference text,
  p_mailotp_created_at timestamptz,
  p_expires_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_task_id text;
BEGIN
  UPDATE public.email_otp_orders
  SET mailotp_task_id = p_mailotp_task_id,
      email_address = p_email_address,
      provider_price_usd = p_provider_price_usd,
      charge_naira = p_charge_naira,
      charge_reference = p_charge_reference,
      mailotp_created_at = p_mailotp_created_at,
      expires_at = p_expires_at,
      updated_at = now()
  WHERE id = p_order_id
    AND user_id = p_user_id
    AND mailotp_task_id IS NULL;

  IF NOT FOUND THEN
    SELECT mailotp_task_id INTO existing_task_id
    FROM public.email_otp_orders
    WHERE id = p_order_id AND user_id = p_user_id;
    IF existing_task_id IS NULL OR existing_task_id <> p_mailotp_task_id THEN
      RAISE EXCEPTION 'ORDER_NOT_CLAIMABLE';
    END IF;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finalize_email_otp_order(uuid, uuid, text, text, numeric, numeric, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_email_otp_order(uuid, uuid, text, text, numeric, numeric, text, timestamptz, timestamptz) TO service_role;

-- ============ settle_email_otp_order ============
-- Marks an order terminal after a poll. `p_refund_reference` is non-null only
-- when the provider refunded the hold (timeout / cancelled / failed): the edge
-- function performs the wallet refund with the SAME reference so the existing
-- refund RPC's dedup keeps this idempotent across repeated polls.
CREATE OR REPLACE FUNCTION public.settle_email_otp_order(
  p_order_id uuid,
  p_user_id uuid,
  p_status text,
  p_refund_reference text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('received','timeout','cancelled','failed','charged_free') THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;
  UPDATE public.email_otp_orders
  SET status = p_status,
      updated_at = now()
  WHERE id = p_order_id
    AND user_id = p_user_id
    AND status = 'waiting';
  IF NOT FOUND THEN
    -- Already settled (or already has a code): safe to no-op for idempotency.
    RETURN;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_email_otp_order(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_email_otp_order(uuid, uuid, text, text) TO service_role;

-- ============ record_email_otp_code ============
-- Records one delivered code on an order. Unique (order_id, code,
-- provider_received_at) makes repeated polls store the delivery once.
CREATE OR REPLACE FUNCTION public.record_email_otp_code(
  p_order_id uuid,
  p_user_id uuid,
  p_code text,
  p_sender text,
  p_subject text,
  p_provider_received_at timestamptz,
  p_was_free_repeat boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_id uuid;
BEGIN
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RAISE EXCEPTION 'INVALID_CODE';
  END IF;

  -- Ownership + still-open check in one statement.
  UPDATE public.email_otp_orders
  SET status = 'received',
      last_code_at = COALESCE(p_provider_received_at, now()),
      updated_at = now()
  WHERE id = p_order_id
    AND user_id = p_user_id
    RETURNING id INTO inserted_id;

  IF inserted_id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  INSERT INTO public.email_otp_codes
    (order_id, code, sender, subject, provider_received_at, was_free_repeat)
  VALUES
    (p_order_id, p_code, p_sender, p_subject, p_provider_received_at, p_was_free_repeat)
  ON CONFLICT (order_id, code, provider_received_at) DO NOTHING;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_email_otp_code(uuid, uuid, text, text, text, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_email_otp_code(uuid, uuid, text, text, text, timestamptz, boolean) TO service_role;
