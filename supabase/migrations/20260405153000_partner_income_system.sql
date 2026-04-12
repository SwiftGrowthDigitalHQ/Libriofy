-- Partner Income System: analytics, automation, and engagement tables

-- Extend leads table for partner CRM automation
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS last_contacted_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_followup_at timestamptz,
  ADD COLUMN IF NOT EXISTS demo_scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS expected_value numeric(12, 2),
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_whatsapp_sent boolean NOT NULL DEFAULT false;

-- Partner lead notes
CREATE TABLE IF NOT EXISTS public.partner_lead_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Partner lead activity log
CREATE TABLE IF NOT EXISTS public.partner_lead_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Partner notifications (separate from library notifications)
CREATE TABLE IF NOT EXISTS public.partner_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  type text NOT NULL,
  title text NOT NULL,
  message text,
  read boolean NOT NULL DEFAULT false,
  scheduled_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Referral click tracking
CREATE TABLE IF NOT EXISTS public.partner_referral_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code text NOT NULL,
  partner_id uuid REFERENCES public.affiliates(id) ON DELETE SET NULL,
  user_agent text,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_partner_lead_notes_lead ON public.partner_lead_notes(lead_id);
CREATE INDEX IF NOT EXISTS idx_partner_lead_activity_lead ON public.partner_lead_activity(lead_id);
CREATE INDEX IF NOT EXISTS idx_partner_notifications_partner ON public.partner_notifications(partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_notifications_scheduled ON public.partner_notifications(partner_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_partner_referral_clicks_code ON public.partner_referral_clicks(referral_code);
CREATE INDEX IF NOT EXISTS idx_partner_referral_clicks_partner ON public.partner_referral_clicks(partner_id);

-- RLS
ALTER TABLE public.partner_lead_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_lead_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_referral_clicks ENABLE ROW LEVEL SECURITY;

-- Partner access policies
CREATE POLICY "Partners can manage own lead notes"
  ON public.partner_lead_notes FOR ALL
  USING (partner_id IN (SELECT id FROM public.affiliates WHERE user_id = auth.uid()));

CREATE POLICY "Partners can manage own lead activity"
  ON public.partner_lead_activity FOR ALL
  USING (partner_id IN (SELECT id FROM public.affiliates WHERE user_id = auth.uid()));

CREATE POLICY "Partners can manage own notifications"
  ON public.partner_notifications FOR ALL
  USING (partner_id IN (SELECT id FROM public.affiliates WHERE user_id = auth.uid()));

CREATE POLICY "Partners can view own referral clicks"
  ON public.partner_referral_clicks FOR SELECT
  USING (partner_id IN (SELECT id FROM public.affiliates WHERE user_id = auth.uid()));

CREATE POLICY "Public can log referral clicks"
  ON public.partner_referral_clicks FOR INSERT
  WITH CHECK (true);

-- Helper: update follow-up schedule on lead insert
CREATE OR REPLACE FUNCTION public.leads_set_default_followup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.next_followup_at IS NULL THEN
    NEW.next_followup_at := now() + interval '24 hours';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_leads_followup_default ON public.leads;
CREATE TRIGGER set_leads_followup_default
  BEFORE INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.leads_set_default_followup();

-- Helper: resolve partner_id for referral clicks
CREATE OR REPLACE FUNCTION public.resolve_referral_click_partner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.partner_id IS NULL THEN
    SELECT id INTO NEW.partner_id
    FROM public.affiliates
    WHERE upper(code) = upper(NEW.referral_code)
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS resolve_referral_click_partner ON public.partner_referral_clicks;
CREATE TRIGGER resolve_referral_click_partner
  BEFORE INSERT ON public.partner_referral_clicks
  FOR EACH ROW EXECUTE FUNCTION public.resolve_referral_click_partner();

-- Helper: create follow-up reminder notification after lead insert
CREATE OR REPLACE FUNCTION public.enqueue_partner_followup_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT user_id INTO v_user_id FROM public.affiliates WHERE id = NEW.partner_id;

  INSERT INTO public.partner_notifications (partner_id, user_id, type, title, message, scheduled_at, metadata)
  VALUES (
    NEW.partner_id,
    v_user_id,
    'lead_followup',
    'Follow up with a new lead',
    'Reminder to follow up with ' || NEW.owner_name || ' from ' || NEW.library_name || '.',
    NEW.next_followup_at,
    jsonb_build_object('lead_id', NEW.id, 'phone', NEW.phone)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enqueue_partner_followup_notification ON public.leads;
CREATE TRIGGER enqueue_partner_followup_notification
  AFTER INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_partner_followup_notification();

-- Notify partner on lead status updates
CREATE OR REPLACE FUNCTION public.partner_notify_lead_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT user_id INTO v_user_id FROM public.affiliates WHERE id = NEW.partner_id;

    INSERT INTO public.partner_notifications (partner_id, user_id, type, title, message, metadata)
    VALUES (
      NEW.partner_id,
      v_user_id,
      'lead_status',
      'Lead moved to ' || NEW.status,
      NEW.owner_name || ' (' || NEW.library_name || ') moved to ' || NEW.status || '.',
      jsonb_build_object('lead_id', NEW.id, 'status', NEW.status)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_partner_lead_status_change ON public.leads;
CREATE TRIGGER notify_partner_lead_status_change
  AFTER UPDATE OF status ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.partner_notify_lead_status_change();
