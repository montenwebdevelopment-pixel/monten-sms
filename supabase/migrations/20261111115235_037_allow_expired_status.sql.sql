/*
  # Allow the `expired` status on email_otp_orders

  The 5-minute expiry flow (email-otp-watcher edge function) marks orders
  whose waiting window lapsed as `expired` before refunding. This widens the
  table's status check constraint to accept it.
*/

ALTER TABLE public.email_otp_orders
  DROP CONSTRAINT email_otp_orders_status_check;

ALTER TABLE public.email_otp_orders
  ADD CONSTRAINT email_otp_orders_status_check
  CHECK (status IN ('waiting','received','timeout','cancelled','failed','charged_free','expired'));
