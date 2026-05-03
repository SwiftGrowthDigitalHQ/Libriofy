-- Partner / Affiliate Sales System
-- Adds partner role, onboarding profile fields, leads + payouts, and partner portal access policies.

-- 1) Add partner role to app_role enum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    WHERE e.enumtypid = 'public.app_role'::regtype
      AND e.enumlabel = 'partner'
  ) THEN
    ALTER TYPE public.app_role ADD VALUE 'partner';
  END IF;
END
$$;

-- 2) Partner fields on affiliates (used as partners)
ALTER TABLE public.affiliates
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS experience TEXT,
  ADD COLUMN IF NOT EXISTS payout_method TEXT,
  ADD COLUMN IF NOT EXISTS upi_id TEXT,
  ADD COLUMN IF NOT EXISTS bank_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS total_sales INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_commission NUMERIC(12, 2) NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliates_user_id_unique
  ON public.affiliates(user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_affiliates_total_sales
  ON public.affiliates(total_sales DESC);

CREATE INDEX IF NOT EXISTS idx_affiliates_total_commission
  ON public.affiliates(total_commission DESC);

-- 3) Sequential Partner IDs (PARTNER001, PARTNER002, ...)
CREATE SEQUENCE IF NOT EXISTS public.partner_code_seq START WITH 1;

CREATE OR REPLACE FUNCTION public.generate_partner_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  candidate TEXT;
  next_number BIGINT;
BEGIN
  LOOP
    next_number := nextval('public.partner_code_seq');
    candidate := 'PARTNER' || lpad(next_number::text, 3, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.affiliates WHERE code = candidate);
  END LOOP;
  RETURN candidate;
END;
$$;

-- Backwards compatibility: existing code calls generate_affiliate_code()
CREATE OR REPLACE FUNCTION public.generate_affiliate_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.generate_partner_code();
END;
$$;

DO $$
DECLARE
  v_max INTEGER;
BEGIN
  SELECT COALESCE(MAX((regexp_match(code, '^PARTNER(\\d+)$'))[1]::int), 0)
  INTO v_max
  FROM public.affiliates
  WHERE code ~ '^PARTNER\\d+$';

  IF v_max > 0 THEN
    PERFORM setval('public.partner_code_seq', v_max, true);
  END IF;
END
$$;

ALTER TABLE public.affiliates
  ALTER COLUMN code SET DEFAULT public.generate_partner_code();

-- 4) Leads
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname = 'lead_status'
  ) THEN
    CREATE TYPE public.lead_status AS ENUM ('new', 'contacted', 'demo_done', 'converted', 'rejected');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  library_name TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  city TEXT,
  seats INTEGER,
  status public.lead_status NOT NULL DEFAULT 'new',
  notes TEXT,
  library_id UUID REFERENCES public.libraries(id) ON DELETE SET NULL,
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins can manage leads" ON public.leads;
CREATE POLICY "Super admins can manage leads"
ON public.leads
FOR ALL
USING (public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Partners can view own leads" ON public.leads;
CREATE POLICY "Partners can view own leads"
ON public.leads
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.affiliates a
    WHERE a.id = leads.partner_id
      AND a.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Partners can create leads" ON public.leads;
CREATE POLICY "Partners can create leads"
ON public.leads
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.affiliates a
    WHERE a.id = leads.partner_id
      AND a.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Partners can update own leads" ON public.leads;
CREATE POLICY "Partners can update own leads"
ON public.leads
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.affiliates a
    WHERE a.id = leads.partner_id
      AND a.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.affiliates a
    WHERE a.id = leads.partner_id
      AND a.user_id = auth.uid()
  )
  -- Partners can move leads along the pipeline but cannot self-mark conversions.
  AND status <> 'converted'
);

CREATE INDEX IF NOT EXISTS idx_leads_partner_id ON public.leads(partner_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON public.leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON public.leads(created_at DESC);

DROP TRIGGER IF EXISTS update_leads_updated_at ON public.leads;
CREATE TRIGGER update_leads_updated_at
BEFORE UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5) Payouts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname = 'payout_status'
  ) THEN
    CREATE TYPE public.payout_status AS ENUM ('pending', 'approved', 'paid', 'rejected');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  status public.payout_status NOT NULL DEFAULT 'pending',
  payout_method TEXT,
  payout_destination TEXT,
  note TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins can manage payouts" ON public.payouts;
CREATE POLICY "Super admins can manage payouts"
ON public.payouts
FOR ALL
USING (public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Partners can view own payouts" ON public.payouts;
CREATE POLICY "Partners can view own payouts"
ON public.payouts
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.affiliates a
    WHERE a.id = payouts.partner_id
      AND a.user_id = auth.uid()
  )
);

CREATE INDEX IF NOT EXISTS idx_payouts_partner_id ON public.payouts(partner_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON public.payouts(status);
CREATE INDEX IF NOT EXISTS idx_payouts_requested_at ON public.payouts(requested_at DESC);

DROP TRIGGER IF EXISTS update_payouts_updated_at ON public.payouts;
CREATE TRIGGER update_payouts_updated_at
BEFORE UPDATE ON public.payouts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6) Partner portal access policies
DROP POLICY IF EXISTS "Partners can view own affiliate profile" ON public.affiliates;
CREATE POLICY "Partners can view own affiliate profile"
ON public.affiliates
FOR SELECT
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Partners can view own commissions" ON public.affiliate_commissions;
CREATE POLICY "Partners can view own commissions"
ON public.affiliate_commissions
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.affiliates a
    WHERE a.id = affiliate_commissions.affiliate_id
      AND a.user_id = auth.uid()
  )
);

-- 7) Keep partner totals in sync
CREATE OR REPLACE FUNCTION public.recalculate_affiliate_totals(p_affiliate_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_sales INTEGER := 0;
  v_total_commission NUMERIC(12, 2) := 0;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE ac.status IN ('pending', 'paid'))::int,
    COALESCE(SUM(ac.commission_earned) FILTER (WHERE ac.status IN ('pending', 'paid')), 0)::numeric(12, 2)
  INTO v_total_sales, v_total_commission
  FROM public.affiliate_commissions ac
  WHERE ac.affiliate_id = p_affiliate_id;

  UPDATE public.affiliates a
  SET
    total_sales = COALESCE(v_total_sales, 0),
    total_commission = COALESCE(v_total_commission, 0),
    updated_at = now()
  WHERE a.id = p_affiliate_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_affiliate_commission_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.recalculate_affiliate_totals(NEW.affiliate_id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    PERFORM public.recalculate_affiliate_totals(NEW.affiliate_id);
    IF NEW.affiliate_id IS DISTINCT FROM OLD.affiliate_id THEN
      PERFORM public.recalculate_affiliate_totals(OLD.affiliate_id);
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalculate_affiliate_totals(OLD.affiliate_id);
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS update_affiliate_totals_on_commission ON public.affiliate_commissions;
CREATE TRIGGER update_affiliate_totals_on_commission
AFTER INSERT OR UPDATE OR DELETE ON public.affiliate_commissions
FOR EACH ROW EXECUTE FUNCTION public.handle_affiliate_commission_totals();

-- 8) Payout request + admin payout helpers (RPC)
CREATE OR REPLACE FUNCTION public.request_partner_payout(
  p_amount NUMERIC DEFAULT NULL,
  p_payout_method TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner_id UUID;
  v_pending NUMERIC(12, 2);
  v_threshold CONSTANT NUMERIC(12, 2) := 1000;
  v_amount NUMERIC(12, 2);
  v_method TEXT;
  v_destination TEXT;
  v_payout_id UUID;
BEGIN
  SELECT
    a.id,
    COALESCE(NULLIF(trim(a.payout_method), ''), 'upi'),
    NULLIF(trim(a.upi_id), '')
  INTO v_partner_id, v_method, v_destination
  FROM public.affiliates a
  WHERE a.user_id = auth.uid()
    AND a.is_active = true
  LIMIT 1;

  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'Partner profile not found.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payouts p
    WHERE p.partner_id = v_partner_id
      AND p.status IN ('pending', 'approved')
  ) THEN
    RAISE EXCEPTION 'A payout request is already in progress.';
  END IF;

  SELECT COALESCE(SUM(ac.commission_earned) FILTER (WHERE ac.status = 'pending'), 0)::numeric(12, 2)
  INTO v_pending
  FROM public.affiliate_commissions ac
  WHERE ac.affiliate_id = v_partner_id;

  IF v_pending < v_threshold THEN
    RAISE EXCEPTION 'Minimum payout threshold is %.', v_threshold;
  END IF;

  v_amount := COALESCE(p_amount, v_pending);
  IF v_amount < v_threshold THEN
    RAISE EXCEPTION 'Minimum payout threshold is %.', v_threshold;
  END IF;
  IF v_amount <> v_pending THEN
    RAISE EXCEPTION 'Partial payouts are not supported. Request the full pending amount (%).', v_pending;
  END IF;

  IF p_payout_method IS NOT NULL AND trim(p_payout_method) <> '' THEN
    v_method := lower(trim(p_payout_method));
  END IF;

  INSERT INTO public.payouts (partner_id, amount, status, payout_method, payout_destination, requested_at)
  VALUES (v_partner_id, v_amount, 'pending', v_method, v_destination, now())
  RETURNING id INTO v_payout_id;

  RETURN v_payout_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_approve_partner_payout(p_payout_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.payouts
  SET
    status = 'approved',
    approved_at = now(),
    updated_at = now()
  WHERE id = p_payout_id
    AND status = 'pending';
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_mark_partner_payout_paid(p_payout_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner_id UUID;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT p.partner_id
  INTO v_partner_id
  FROM public.payouts p
  WHERE p.id = p_payout_id
  FOR UPDATE;

  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'Payout not found.';
  END IF;

  UPDATE public.payouts
  SET
    status = 'paid',
    paid_at = now(),
    updated_at = now()
  WHERE id = p_payout_id
    AND status IN ('pending', 'approved');

  UPDATE public.affiliate_commissions
  SET
    status = 'paid',
    paid_at = now()
  WHERE affiliate_id = v_partner_id
    AND status = 'pending';
END;
$$;

-- 9) Update admin dashboard view to include partner contact fields + stored totals.
DROP VIEW IF EXISTS public.admin_affiliate_dashboard;

CREATE OR REPLACE VIEW public.admin_affiliate_dashboard AS
SELECT
  a.id AS affiliate_id,
  a.code,
  a.name,
  a.email,
  a.phone,
  a.city,
  a.commission_rate,
  a.is_active,
  COALESCE(a.total_sales, COUNT(ac.id) FILTER (WHERE ac.status IN ('pending', 'paid'))::int)::int AS total_referrals,
  COALESCE(a.total_commission, COALESCE(SUM(ac.commission_earned) FILTER (WHERE ac.status IN ('pending', 'paid')), 0))::numeric(12, 2) AS total_earnings,
  COALESCE(SUM(ac.commission_earned) FILTER (WHERE ac.status = 'pending'), 0)::numeric(12, 2) AS pending_payouts,
  a.created_at,
  a.updated_at
FROM public.affiliates a
LEFT JOIN public.affiliate_commissions ac ON ac.affiliate_id = a.id
GROUP BY a.id;

-- Grants (RLS still applies)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payouts TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_partner_payout(NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_approve_partner_payout(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_partner_payout_paid(UUID) TO authenticated;

-- 10) Partner-aware signup (handle_new_user)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_library_id UUID;
  v_slug TEXT;
  v_full_name TEXT;
  v_phone TEXT;
  v_trial_start TIMESTAMPTZ := now();
  v_trial_end TIMESTAMPTZ := now() + interval '7 days';
  v_super_admin_email CONSTANT TEXT := 'hello@libriofy.com';
  v_referral_input TEXT;
  v_affiliate_input TEXT;
  v_referred_by UUID;
  v_affiliate_id UUID;
  v_starter_seats INTEGER;
  v_starter_features JSONB;
  v_account_type TEXT;
  v_partner_city TEXT;
  v_partner_experience TEXT;
  v_partner_payout_method TEXT;
  v_partner_upi_id TEXT;
  v_partner_bank_details JSONB;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  v_phone := COALESCE(NEW.phone, NEW.raw_user_meta_data->>'phone_number');
  v_referral_input := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'referral_code', '')), '');
  v_affiliate_input := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'affiliate_code', '')), '');
  v_account_type := lower(NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'account_type', '')), ''));

  INSERT INTO public.profiles (user_id, email, full_name, phone_number, is_phone_verified)
  VALUES (
    NEW.id,
    NEW.email,
    v_full_name,
    v_phone,
    CASE WHEN NEW.phone IS NOT NULL THEN true ELSE false END
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name;

  -- Super admin bootstrap
  IF lower(COALESCE(NEW.email, '')) = v_super_admin_email THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = NEW.id AND role = 'super_admin'
    ) THEN
      INSERT INTO public.user_roles (user_id, role, library_id)
      VALUES (NEW.id, 'super_admin', NULL);
    END IF;

    INSERT INTO public.user_referrals (user_id, referral_code, referred_by)
    VALUES (NEW.id, public.generate_referral_code(), NULL)
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
  END IF;

  -- Partner / Affiliate signup path (no library bootstrap)
  IF v_account_type IN ('partner', 'affiliate') THEN
    v_partner_city := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'city', '')), '');
    v_partner_experience := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'experience', '')), '');
    v_partner_payout_method := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'payout_method', '')), '');
    v_partner_upi_id := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'upi_id', '')), '');
    v_partner_bank_details := COALESCE(NEW.raw_user_meta_data->'bank_details', '{}'::jsonb);

    INSERT INTO public.user_roles (user_id, role, library_id)
    VALUES (NEW.id, 'partner', NULL)
    ON CONFLICT (user_id, role, library_id) DO NOTHING;

    INSERT INTO public.affiliates (
      user_id,
      name,
      email,
      phone,
      city,
      experience,
      payout_method,
      upi_id,
      bank_details,
      commission_rate,
      is_active
    )
    VALUES (
      NEW.id,
      COALESCE(NULLIF(v_full_name, ''), 'Partner'),
      COALESCE(NEW.email, ''),
      v_phone,
      v_partner_city,
      v_partner_experience,
      v_partner_payout_method,
      v_partner_upi_id,
      v_partner_bank_details,
      10.00,
      true
    )
    ON CONFLICT (email) DO UPDATE
    SET
      user_id = EXCLUDED.user_id,
      phone = COALESCE(EXCLUDED.phone, public.affiliates.phone),
      city = COALESCE(EXCLUDED.city, public.affiliates.city),
      experience = COALESCE(EXCLUDED.experience, public.affiliates.experience),
      payout_method = COALESCE(EXCLUDED.payout_method, public.affiliates.payout_method),
      upi_id = COALESCE(EXCLUDED.upi_id, public.affiliates.upi_id),
      bank_details = CASE
        WHEN jsonb_typeof(EXCLUDED.bank_details) = 'object' THEN EXCLUDED.bank_details
        ELSE public.affiliates.bank_details
      END,
      is_active = true,
      updated_at = now();

    INSERT INTO public.user_referrals (user_id, referral_code, referred_by)
    VALUES (NEW.id, public.generate_referral_code(), NULL)
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
  END IF;

  -- Resolve referral input into referred_by user id (if any)
  IF v_referral_input IS NOT NULL THEN
    SELECT ur.user_id
    INTO v_referred_by
    FROM public.user_referrals ur
    WHERE upper(ur.referral_code) = upper(v_referral_input)
    LIMIT 1;
  END IF;

  -- Resolve affiliate input into affiliate id (accept code, uuid, or email).
  IF v_affiliate_input IS NOT NULL THEN
    BEGIN
      SELECT a.id INTO v_affiliate_id
      FROM public.affiliates a
      WHERE a.is_active = true
        AND (
          upper(a.code) = upper(v_affiliate_input)
          OR lower(a.email) = lower(v_affiliate_input)
          OR a.id = v_affiliate_input::uuid
        )
      LIMIT 1;
    EXCEPTION WHEN others THEN
      v_affiliate_id := NULL;
    END;
  END IF;

  v_slug := lower(regexp_replace(split_part(COALESCE(NEW.email, NEW.phone, NEW.id::text), '@', 1), '[^a-z0-9]', '-', 'g'));
  IF EXISTS (SELECT 1 FROM public.libraries WHERE slug = v_slug) THEN
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 6);
  END IF;

  INSERT INTO public.libraries (owner_id, name, slug, total_seats)
  VALUES (NEW.id, COALESCE(NULLIF(v_full_name, ''), 'My') || '''s Library', v_slug, 30)
  RETURNING id INTO v_library_id;

  INSERT INTO public.user_roles (user_id, role, library_id)
  VALUES (NEW.id, 'library_owner', v_library_id);

  -- Create referral record for this user.
  INSERT INTO public.user_referrals (user_id, referral_code, referred_by)
  VALUES (NEW.id, public.generate_referral_code(), v_referred_by)
  ON CONFLICT (user_id) DO NOTHING;

  -- Store acquisition attribution (used later for payouts).
  INSERT INTO public.library_acquisition (library_id, owner_id, referral_code, referred_by, affiliate_id)
  VALUES (v_library_id, NEW.id, v_referral_input, v_referred_by, v_affiliate_id)
  ON CONFLICT (library_id) DO UPDATE
  SET
    referral_code = EXCLUDED.referral_code,
    referred_by = EXCLUDED.referred_by,
    affiliate_id = EXCLUDED.affiliate_id;

  -- Default trial subscription uses the starter plan config when available.
  SELECT sp.seats_limit, sp.features
  INTO v_starter_seats, v_starter_features
  FROM public.subscription_plans sp
  WHERE sp.code = 'starter'
  LIMIT 1;

  INSERT INTO public.library_subscriptions (
    library_id,
    plan_name,
    price,
    seats_limit,
    features,
    status,
    started_at,
    expires_at,
    trial_start_date,
    trial_end_date,
    payment_status
  )
  VALUES (
    v_library_id,
    'starter',
    0,
    COALESCE(v_starter_seats, 50),
    COALESCE(v_starter_features, '["seat_management","analytics","notifications"]'::jsonb),
    'trial',
    v_trial_start,
    v_trial_end,
    v_trial_start,
    v_trial_end,
    'trial'
  );

  RETURN NEW;
END;
$function$;
