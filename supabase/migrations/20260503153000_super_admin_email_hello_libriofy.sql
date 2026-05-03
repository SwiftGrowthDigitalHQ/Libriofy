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

  IF v_referral_input IS NOT NULL THEN
    SELECT ur.user_id
    INTO v_referred_by
    FROM public.user_referrals ur
    WHERE upper(ur.referral_code) = upper(v_referral_input)
    LIMIT 1;
  END IF;

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

  INSERT INTO public.user_referrals (user_id, referral_code, referred_by)
  VALUES (NEW.id, public.generate_referral_code(), v_referred_by)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.library_acquisition (library_id, owner_id, referral_code, referred_by, affiliate_id)
  VALUES (v_library_id, NEW.id, v_referral_input, v_referred_by, v_affiliate_id)
  ON CONFLICT (library_id) DO UPDATE
  SET
    referral_code = EXCLUDED.referral_code,
    referred_by = EXCLUDED.referred_by,
    affiliate_id = EXCLUDED.affiliate_id;

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

UPDATE public.profiles
SET email = 'hello@libriofy.com'
WHERE user_id = '936f7f14-16f3-4eb1-bbed-f3e0ba8fbd01';

UPDATE public.login_logs
SET email = 'hello@libriofy.com'
WHERE user_id = '936f7f14-16f3-4eb1-bbed-f3e0ba8fbd01'
  AND COALESCE(email, '') <> 'hello@libriofy.com';

UPDATE public.auth_trusted_devices
SET revoked_at = now(),
    revocation_reason = 'super_admin_email_changed'
WHERE user_id = '936f7f14-16f3-4eb1-bbed-f3e0ba8fbd01'
  AND revoked_at IS NULL;
