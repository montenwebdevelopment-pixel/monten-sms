-- Support tickets for the AI support agent. Owned by the authenticated user;
-- status changes happen only through a SECURITY DEFINER function so users
-- cannot silently close or escalate their own tickets.
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  priority text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'open',
  case_ref text NOT NULL UNIQUE DEFAULT ('MNT-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8))),
  summary text,
  ai_conclusion text,
  escalated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_tickets_status_chk CHECK (status IN ('open','awaiting_user','escalated','resolved','closed')),
  CONSTRAINT support_tickets_priority_chk CHECK (priority IN ('low','normal','high','urgent')),
  CONSTRAINT support_tickets_category_chk CHECK (category IN ('deposit','wallet','number_order','otp','account','payment','refund','technical','general'))
);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_tickets" ON public.support_tickets FOR SELECT
  TO authenticated USING (user_id = auth.uid());
CREATE POLICY "insert_own_ticket" ON public.support_tickets FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());

-- Users may not UPDATE tickets directly: status/priority/escalated are managed
-- server-side. Revoke UPDATE so the client cannot close or escalate their own
-- tickets, then expose a narrow RPC for the allowed shape.
REVOKE UPDATE ON public.support_tickets FROM authenticated;

CREATE INDEX IF NOT EXISTS support_tickets_user_created_idx
  ON public.support_tickets (user_id, created_at DESC);

-- Narrow insert grant: only user-supplied content, ownership comes from default.
ALTER TABLE public.support_tickets ALTER COLUMN user_id SET DEFAULT auth.uid();
REVOKE INSERT ON public.support_tickets FROM authenticated;
GRANT INSERT (subject, category, priority, summary) ON public.support_tickets TO authenticated;

-- Server-side ticket creation used by the support edge function. The actor is
-- always derived from auth.uid(); the caller cannot forge user_id.
CREATE OR REPLACE FUNCTION public.create_support_ticket(
  p_subject text,
  p_category text DEFAULT 'general',
  p_priority text DEFAULT 'normal',
  p_summary text DEFAULT NULL
)
RETURNS public.support_tickets
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row public.support_tickets;
BEGIN
  IF p_subject IS NULL OR length(trim(p_subject)) < 3 OR length(p_subject) > 200 THEN
    RAISE EXCEPTION 'Invalid subject';
  END IF;
  IF p_category NOT IN ('deposit','wallet','number_order','otp','account','payment','refund','technical','general') THEN
    RAISE EXCEPTION 'Invalid category';
  END IF;
  IF p_priority NOT IN ('low','normal','high','urgent') THEN
    RAISE EXCEPTION 'Invalid priority';
  END IF;

  INSERT INTO public.support_tickets (user_id, subject, category, priority, summary)
  VALUES (auth.uid(), trim(p_subject), p_category, p_priority, p_summary)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_support_ticket FROM anon;
GRANT EXECUTE ON FUNCTION public.create_support_ticket TO authenticated;

-- Escalate a ticket: marks it escalated + status escalated. Only the owner may
-- trigger escalation (the support agent calls this on the user's behalf after
-- confirming the issue genuinely needs a human).
CREATE OR REPLACE FUNCTION public.escalate_support_ticket(
  p_ticket_id uuid,
  p_conclusion text DEFAULT NULL
)
RETURNS public.support_tickets
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row public.support_tickets;
BEGIN
  UPDATE public.support_tickets
    SET escalated = true,
        status = 'escalated',
        ai_conclusion = p_conclusion,
        updated_at = now()
  WHERE id = p_ticket_id AND user_id = auth.uid()
  RETURNING * INTO v_row;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'Ticket not found or not owned by caller';
  END IF;
  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.escalate_support_ticket FROM anon;
GRANT EXECUTE ON FUNCTION public.escalate_support_ticket TO authenticated;

-- Append a note to an existing ticket's summary (used when the conversation
-- yields new facts). Kept minimal so it cannot be abused to overwrite history.
CREATE OR REPLACE FUNCTION public.append_ticket_note(
  p_ticket_id uuid,
  p_note text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_note IS NULL OR length(trim(p_note)) = 0 OR length(p_note) > 1000 THEN
    RAISE EXCEPTION 'Invalid note';
  END IF;
  UPDATE public.support_tickets
    SET summary = COALESCE(summary || E'\n', '') || trim(p_note),
        updated_at = now()
  WHERE id = p_ticket_id AND user_id = auth.uid();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.append_ticket_note FROM anon;
GRANT EXECUTE ON FUNCTION public.append_ticket_note TO authenticated;
