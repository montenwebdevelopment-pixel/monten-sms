CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet boolean NOT NULL DEFAULT true,
  sms boolean NOT NULL DEFAULT true,
  email_purchase boolean NOT NULL DEFAULT true,
  account_security boolean NOT NULL DEFAULT true,
  promotions boolean NOT NULL DEFAULT false,
  system_updates boolean NOT NULL DEFAULT true,
  low_balance_threshold numeric(12,2) NOT NULL DEFAULT 1000
    CHECK (low_balance_threshold BETWEEN 0 AND 10000000),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_own_notification_preferences" ON public.notification_preferences;
CREATE POLICY "select_own_notification_preferences" ON public.notification_preferences
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_notification_preferences" ON public.notification_preferences;
CREATE POLICY "insert_own_notification_preferences" ON public.notification_preferences
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_notification_preferences" ON public.notification_preferences;
CREATE POLICY "update_own_notification_preferences" ON public.notification_preferences
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;

CREATE TABLE IF NOT EXISTS public.push_device_tokens (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform = 'android'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_device_tokens_user_id
  ON public.push_device_tokens(user_id);
ALTER TABLE public.push_device_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_device_tokens FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.push_notification_deliveries (
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  attempts smallint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, token_hash)
);
ALTER TABLE public.push_notification_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_notification_deliveries FROM anon, authenticated;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS push_category text,
  ADD COLUMN IF NOT EXISTS push_route text,
  ADD COLUMN IF NOT EXISTS event_key text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_event_key
  ON public.notifications(user_id, event_key)
  WHERE event_key IS NOT NULL;

DROP POLICY IF EXISTS "insert_own_notifications" ON public.notifications;
REVOKE INSERT ON public.notifications FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.classify_push_notification()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.push_category IS NULL THEN
    NEW.push_category := CASE
      WHEN NEW.type IN ('deposit', 'refund', 'low_balance', 'payment') THEN 'wallet'
      WHEN NEW.type IN ('purchase', 'sms', 'sms_otp', 'sms_order') THEN 'sms'
      WHEN NEW.type = 'email_otp' THEN 'email_purchase'
      WHEN NEW.type = 'account_security' THEN 'account_security'
      WHEN NEW.type IN ('promotion', 'promotions') THEN 'promotions'
      WHEN NEW.type IN ('system', 'system_update') THEN 'system_updates'
      ELSE NULL
    END;
  END IF;

  IF NEW.push_route IS NULL THEN
    NEW.push_route := CASE NEW.push_category
      WHEN 'wallet' THEN '/dashboard/fund-wallet'
      WHEN 'sms' THEN '/dashboard/purchased-numbers'
      WHEN 'email_purchase' THEN '/dashboard/email-otp'
      WHEN 'account_security' THEN '/dashboard/account-settings'
      ELSE '/dashboard/notifications'
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_classify_push_notification ON public.notifications;
CREATE TRIGGER trigger_classify_push_notification
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.classify_push_notification();

CREATE OR REPLACE FUNCTION public.dispatch_push_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE
  webhook_secret text;
BEGIN
  IF NEW.push_category IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO webhook_secret
  FROM vault.decrypted_secrets
  WHERE name = 'push_notification_webhook_secret'
  LIMIT 1;

  IF COALESCE(webhook_secret, '') = '' THEN
    RAISE WARNING 'Push notification webhook secret is not configured';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://egalqcwprmlyukzwnqyn.supabase.co/functions/v1/push-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', webhook_secret
    ),
    body := jsonb_build_object('notificationId', NEW.id)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Could not queue push notification %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_dispatch_push_notification ON public.notifications;
CREATE TRIGGER trigger_dispatch_push_notification
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.dispatch_push_notification();

CREATE OR REPLACE FUNCTION public.notify_sms_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  notification_title text;
  notification_message text;
  notification_event text;
BEGIN
  IF NEW.status = 'received' AND OLD.status IS DISTINCT FROM NEW.status THEN
    notification_title := 'SMS code received';
    notification_message := 'A verification code is ready. Open MONTEN SMS to view it.';
    notification_event := 'sms-code:' || NEW.id::text;
  ELSIF NEW.status IN ('canceled', 'failed') AND OLD.status IS DISTINCT FROM NEW.status THEN
    notification_title := CASE WHEN NEW.status = 'canceled' THEN 'SMS order canceled' ELSE 'SMS order failed' END;
    notification_message := CASE
      WHEN NEW.status = 'canceled' THEN 'Your SMS order was canceled. Check your wallet for any applicable refund.'
      ELSE 'Your SMS order could not be completed. Check your wallet for any applicable refund.'
    END;
    notification_event := 'sms-terminal:' || NEW.id::text;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message, push_category, push_route, event_key)
  VALUES (
    NEW.user_id, 'sms_order', notification_title, notification_message,
    'sms', '/dashboard/purchased-numbers', notification_event
  )
  ON CONFLICT (user_id, event_key) WHERE event_key IS NOT NULL DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_sms_order_status ON public.purchased_numbers;
CREATE TRIGGER trigger_notify_sms_order_status
  AFTER UPDATE OF status ON public.purchased_numbers
  FOR EACH ROW EXECUTE FUNCTION public.notify_sms_order_status();

CREATE OR REPLACE FUNCTION public.notify_email_order_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'waiting'
    AND NEW.status IN ('timeout', 'cancelled', 'failed', 'expired')
    AND NEW.charge_naira = 0
  THEN
    INSERT INTO public.notifications (user_id, type, title, message, push_category, push_route, event_key)
    VALUES (
      NEW.user_id, 'email_otp', 'Email order canceled',
      'Your email order ended without a charge.', 'email_purchase',
      '/dashboard/email-otp', 'email-terminal:' || NEW.id::text
    )
    ON CONFLICT (user_id, event_key) WHERE event_key IS NOT NULL DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_email_order_cancellation ON public.email_otp_orders;
CREATE TRIGGER trigger_notify_email_order_cancellation
  AFTER UPDATE OF status ON public.email_otp_orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_email_order_cancellation();

CREATE OR REPLACE FUNCTION public.notify_low_wallet_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  threshold numeric(12,2);
BEGIN
  SELECT low_balance_threshold INTO threshold
  FROM public.notification_preferences
  WHERE user_id = NEW.id;
  threshold := COALESCE(threshold, 1000);

  IF threshold > 0
    AND OLD.wallet_balance >= threshold
    AND NEW.wallet_balance < threshold
  THEN
    INSERT INTO public.notifications (user_id, type, title, message, push_category, push_route, event_key)
    VALUES (
      NEW.id, 'low_balance', 'Low wallet balance',
      'Your wallet balance is below your selected alert threshold.',
      'wallet', '/dashboard/fund-wallet',
      'wallet-low:' || NEW.id::text || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS')
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_low_wallet_balance ON public.profiles;
CREATE TRIGGER trigger_notify_low_wallet_balance
  AFTER UPDATE OF wallet_balance ON public.profiles
  FOR EACH ROW
  WHEN (OLD.wallet_balance IS DISTINCT FROM NEW.wallet_balance)
  EXECUTE FUNCTION public.notify_low_wallet_balance();

CREATE OR REPLACE FUNCTION public.notify_wallet_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  notification_title text;
  notification_message text;
BEGIN
  IF NEW.status <> 'completed'
    OR (TG_OP = 'UPDATE' AND OLD.status = 'completed')
    OR NEW.type NOT IN ('deposit', 'purchase', 'refund')
  THEN
    RETURN NEW;
  END IF;

  notification_title := CASE NEW.type
    WHEN 'deposit' THEN 'Wallet deposit completed'
    WHEN 'purchase' THEN 'Wallet payment completed'
    ELSE 'Wallet refund received'
  END;
  notification_message := CASE NEW.type
    WHEN 'deposit' THEN 'A deposit has been added to your wallet.'
    WHEN 'purchase' THEN 'A payment has been made from your wallet.'
    ELSE 'A refund has been credited to your wallet.'
  END;

  INSERT INTO public.notifications (user_id, type, title, message, push_category, push_route, event_key)
  VALUES (
    NEW.user_id, NEW.type, notification_title, notification_message,
    'wallet', '/dashboard/transactions',
    'wallet-transaction:' || NEW.id::text
  )
  ON CONFLICT (user_id, event_key) WHERE event_key IS NOT NULL DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_wallet_transaction ON public.transactions;
CREATE TRIGGER trigger_notify_wallet_transaction
  AFTER INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.notify_wallet_transaction();

DO $$
DECLARE
  existing_job bigint;
BEGIN
  SELECT jobid INTO existing_job
  FROM cron.job
  WHERE jobname = 'retry_push_notification_delivery';
  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;

  PERFORM cron.schedule(
    'retry_push_notification_delivery',
    '* * * * *',
    $job$
      SELECT net.http_post(
        url := 'https://egalqcwprmlyukzwnqyn.supabase.co/functions/v1/push-dispatch',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-push-secret', COALESCE(
            (SELECT decrypted_secret FROM vault.decrypted_secrets
             WHERE name = 'push_notification_webhook_secret' LIMIT 1),
            ''
          )
        ),
        body := '{"retry":true}'::jsonb
      )
    $job$
  );
END
$$;
