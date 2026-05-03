-- Monetization upgrades: editable subscription plans, coupons, referrals, affiliates.

-- 1) Subscription plans (editable by Super Admin)
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(12, 2) NOT NULL,
  seats_limit INTEGER,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT subscription_plans_code_format CHECK (code ~ '^[a-z0-9_\\-]{2,64}$'),
  CONSTRAINT subscription_plans_price_positive CHECK (price >= 0)
);

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view active subscription plans" ON public.subscription_plans;
CREATE POLICY "Authenticated can view active subscription plans"
ON public.subscription_plans
FOR SELECT
USING (is_active = true);

DROP POLICY IF EXISTS "Super admins can manage subscription plans" ON public.subscription_plans;
CREATE POLICY "Super admins can manage subscription plans"
ON public.subscription_plans
FOR ALL
USING (public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP TRIGGER IF EXISTS update_subscription_plans_updated_at ON public.subscription_plans;
CREATE TRIGGER update_subscription_plans_updated_at
BEFORE UPDATE ON public.subscription_plans
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_subscription_plans_is_active ON public.subscription_plans(is_active);
CREATE INDEX IF NOT EXISTS idx_subscription_plans_sort_order ON public.subscription_plans(sort_order);

-- Seed default plans (used by the billing UI + trial bootstrap).
INSERT INTO public.subscription_plans (code, name, description, price, seats_limit, features, is_active, sort_order)
VALUES
  ('starter', 'Starter', 'For libraries getting started with paid operations.', 2999, 50, '["Up to 50 seats","Seat management","Notifications"]'::jsonb, true, 10),
  ('growth', 'Growth', 'For growing libraries that need higher seat capacity.', 6999, 150, '["Up to 150 seats","Seat management","Advanced analytics","Notifications","Export"]'::jsonb, true, 20),
  ('pro', 'Pro', 'For large operations that need full flexibility.', 9999, NULL, '["Unlimited seats","All features","Custom domain","Priority support"]'::jsonb, true, 30)
ON CONFLICT (code) DO NOTHING;

-- 2) Coupon / discount system
CREATE TABLE IF NOT EXISTS public.coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'flat')),
  discount_value NUMERIC(12, 2) NOT NULL,
  expires_at TIMESTAMPTZ,
  max_uses INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coupons_code_length CHECK (length(code) BETWEEN 3 AND 32),
  CONSTRAINT coupons_discount_value_positive CHECK (discount_value > 0),
  CONSTRAINT coupons_max_uses_positive CHECK (max_uses IS NULL OR max_uses >= 1),
  CONSTRAINT coupons_percentage_range CHECK (discount_type <> 'percentage' OR discount_value <= 100)
);

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins can manage coupons" ON public.coupons;
CREATE POLICY "Super admins can manage coupons"
ON public.coupons
FOR ALL
USING (public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP TRIGGER IF EXISTS update_coupons_updated_at ON public.coupons;
CREATE TRIGGER update_coupons_updated_at
BEFORE UPDATE ON public.coupons
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_coupons_code ON public.coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_active ON public.coupons(is_active);

CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id UUID NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  subscription_payment_id UUID REFERENCES public.subscription_payments(id) ON DELETE SET NULL,
  razorpay_order_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'captured', 'void')),
  discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  captured_at TIMESTAMPTZ
);

ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins can manage coupon redemptions" ON public.coupon_redemptions;
CREATE POLICY "Super admins can manage coupon redemptions"
ON public.coupon_redemptions
FOR ALL
USING (public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Owners can view own coupon redemptions" ON public.coupon_redemptions;
CREATE POLICY "Owners can view own coupon redemptions"
ON public.coupon_redemptions
FOR SELECT
USING (library_id IN (SELECT id FROM public.libraries WHERE owner_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon_id ON public.coupon_redemptions(coupon_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_library_id ON public.coupon_redemptions(library_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_status ON public.coupon_redemptions(status);

-- 3) Referral system
CREATE TABLE IF NOT EXISTS public.user_referrals (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  referral_code TEXT NOT NULL UNIQUE,
  referred_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT referral_code_length CHECK (length(referral_code) BETWEEN 6 AND 16)
);

ALTER TABLE public.user_referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own referral record" ON public.user_referrals;
CREATE POLICY "Users can view own referral record"
ON public.user_referrals
FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Super admins can manage all user referrals" ON public.user_referrals;
CREATE POLICY "Super admins can manage all user referrals"
ON public.user_referrals
FOR ALL
USING (public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX IF NOT EXISTS idx_user_referrals_referral_code ON public.user_referrals(referral_code);
CREATE INDEX IF NOT EXISTS idx_user_referrals_referred_by ON public.user_referrals(referred_by);

CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  candidate TEXT;
BEGIN
  LOOP
    candidate := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.user_referrals WHERE referral_code = candidate);
  END LOOP;
  RETURN candidate;
END;
$$;

CREATE TABLE IF NOT EXISTS public.referral_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  subscription_payment_id UUID REFERENCES public.subscription_payments(id) ON DELETE SET NULL,
  amount NUMERIC(12, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'canceled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  CONSTRAINT referral_rewards_unique_payment UNIQUE (subscription_payment_id)
);

ALTER TABLE public.referral_rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins can manage referral rewards" ON public.referral_rewards;
CREATE POLICY "Super admins can manage referral rewards"
ON public.referral_rewards
FOR ALL
USING (public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Users can view own referral rewards" ON public.referral_rewards;
CREATE POLICY "Users can view own referral rewards"
ON public.referral_rewards
FOR SELECT
USING (referrer_user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer ON public.referral_rewards(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_status ON public.referral_rewards(status);

-- 4) Affiliate system
CREATE TABLE IF NOT EXISTS public.affiliates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  commission_rate NUMERIC(5, 2) NOT NULL DEFAULT 10.00,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT affiliates_commission_rate_range CHECK (commission_rate >= 0 AND commission_rate <= 100)
);

ALTER TABLE public.affiliates ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.generate_affiliate_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  candidate TEXT;
BEGIN
  LOOP
    candidate := 'AFF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.affiliates WHERE code = candidate);
  END LOOP;
  RETURN candidate;
END;
$$;

ALTER TABLE public.affiliates
  ALTER COLUMN code SET DEFAULT public.generate_affiliate_code();

DROP POLICY IF EXISTS "Super admins can manage affiliates" ON public.affiliates;
CREATE POLICY "Super admins can manage affiliates"
ON public.affiliates
FOR ALL
USING (public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP TRIGGER IF EXISTS update_affiliates_updated_at ON public.affiliates;
CREATE TRIGGER update_affiliates_updated_at
BEFORE UPDATE ON public.affiliates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_affiliates_code ON public.affiliates(code);

CREATE TABLE IF NOT EXISTS public.affiliate_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_payment_id UUID REFERENCES public.subscription_payments(id) ON DELETE SET NULL,
  commission_rate NUMERIC(5, 2) NOT NULL,
  commission_earned NUMERIC(12, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'canceled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  CONSTRAINT affiliate_commissions_unique_payment UNIQUE (subscription_payment_id)
);

ALTER TABLE public.affiliate_commissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins can manage affiliate commissions" ON public.affiliate_commissions;
CREATE POLICY "Super admins can manage affiliate commissions"
ON public.affiliate_commissions
FOR ALL
USING (public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_affiliate_id ON public.affiliate_commissions(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_status ON public.affiliate_commissions(status);

-- Attribution per library (used for referral + affiliate payouts on first purchase).
CREATE TABLE IF NOT EXISTS public.library_acquisition (
  library_id UUID PRIMARY KEY REFERENCES public.libraries(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referral_code TEXT,
  referred_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  affiliate_id UUID REFERENCES public.affiliates(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.library_acquisition ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can view own library acquisition" ON public.library_acquisition;
CREATE POLICY "Owners can view own library acquisition"
ON public.library_acquisition
FOR SELECT
USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "Super admins can manage library acquisition" ON public.library_acquisition;
CREATE POLICY "Super admins can manage library acquisition"
ON public.library_acquisition
FOR ALL
USING (public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX IF NOT EXISTS idx_library_acquisition_referred_by ON public.library_acquisition(referred_by);
CREATE INDEX IF NOT EXISTS idx_library_acquisition_affiliate_id ON public.library_acquisition(affiliate_id);

-- Admin dashboards (views)
CREATE OR REPLACE VIEW public.admin_coupon_dashboard AS
SELECT
  c.id,
  c.code,
  c.discount_type,
  c.discount_value,
  c.expires_at,
  c.max_uses,
  c.is_active,
  COUNT(cr.id) FILTER (WHERE cr.status IN ('reserved', 'captured'))::int AS uses_reserved,
  COUNT(cr.id) FILTER (WHERE cr.status = 'captured')::int AS uses_captured,
  c.created_at,
  c.updated_at
FROM public.coupons c
LEFT JOIN public.coupon_redemptions cr ON cr.coupon_id = c.id
GROUP BY c.id;

CREATE OR REPLACE VIEW public.admin_affiliate_dashboard AS
SELECT
  a.id AS affiliate_id,
  a.code,
  a.name,
  a.email,
  a.commission_rate,
  a.is_active,
  COUNT(ac.id)::int AS total_referrals,
  COALESCE(SUM(ac.commission_earned) FILTER (WHERE ac.status IN ('pending', 'paid')), 0)::numeric(12, 2) AS total_earnings,
  COALESCE(SUM(ac.commission_earned) FILTER (WHERE ac.status = 'pending'), 0)::numeric(12, 2) AS pending_payouts,
  a.created_at,
  a.updated_at
FROM public.affiliates a
LEFT JOIN public.affiliate_commissions ac ON ac.affiliate_id = a.id
GROUP BY a.id;

GRANT SELECT ON public.admin_coupon_dashboard TO authenticated;
GRANT SELECT ON public.admin_affiliate_dashboard TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscription_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coupons TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coupon_redemptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_referrals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.referral_rewards TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.affiliates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.affiliate_commissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.library_acquisition TO authenticated;

-- Update the auth signup trigger to also manage referrals + acquisition attribution and use subscription_plans for defaults.
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
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  v_phone := COALESCE(NEW.phone, NEW.raw_user_meta_data->>'phone_number');
  v_referral_input := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'referral_code', '')), '');
  v_affiliate_input := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'affiliate_code', '')), '');

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

    -- Still create a referral code for super admins.
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
