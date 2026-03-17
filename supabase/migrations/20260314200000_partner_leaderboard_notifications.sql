-- Partner leaderboard + automation notifications

-- 1) Partner leaderboard (safe fields only; bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_partner_leaderboard(p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
  rank INTEGER,
  partner_code TEXT,
  partner_name TEXT,
  city TEXT,
  total_sales INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ranked AS (
    SELECT
      a.code AS partner_code,
      a.name AS partner_name,
      a.city,
      COALESCE(a.total_sales, 0)::int AS total_sales,
      ROW_NUMBER() OVER (
        ORDER BY COALESCE(a.total_sales, 0) DESC, a.created_at ASC
      )::int AS rank
    FROM public.affiliates a
    WHERE a.is_active = true
  )
  SELECT rank, partner_code, partner_name, city, total_sales
  FROM ranked
  ORDER BY rank
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 50));
$$;

GRANT EXECUTE ON FUNCTION public.get_partner_leaderboard(INTEGER) TO authenticated;

-- 2) Lead conversion timestamp automation
CREATE OR REPLACE FUNCTION public.leads_apply_converted_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'converted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'converted') THEN
    NEW.converted_at := COALESCE(NEW.converted_at, now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apply_leads_converted_defaults ON public.leads;
CREATE TRIGGER apply_leads_converted_defaults
BEFORE INSERT OR UPDATE OF status ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.leads_apply_converted_defaults();

-- 3) Notify partner + admin on referral signup attribution (library_acquisition.affiliate_id)
CREATE OR REPLACE FUNCTION public.handle_library_acquisition_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_library_name TEXT;
  v_affiliate_name TEXT;
  v_affiliate_code TEXT;
  v_affiliate_user_id UUID;
BEGIN
  IF NEW.affiliate_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.affiliate_id IS NOT DISTINCT FROM OLD.affiliate_id THEN
    RETURN NEW;
  END IF;

  SELECT l.name
  INTO v_library_name
  FROM public.libraries l
  WHERE l.id = NEW.library_id;

  SELECT a.name, a.code, a.user_id
  INTO v_affiliate_name, v_affiliate_code, v_affiliate_user_id
  FROM public.affiliates a
  WHERE a.id = NEW.affiliate_id;

  -- Partner notification (when partner is linked to an auth user)
  IF v_affiliate_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (
      user_id,
      library_id,
      category,
      type,
      title,
      message,
      metadata
    )
    VALUES (
      v_affiliate_user_id,
      NEW.library_id,
      'affiliate',
      'partner_referral_signup',
      'New signup via your link',
      'Library "' || COALESCE(v_library_name, 'Library') || '" signed up via your referral link.',
      jsonb_build_object(
        'affiliate_id', NEW.affiliate_id,
        'affiliate_name', v_affiliate_name,
        'affiliate_code', v_affiliate_code,
        'library_id', NEW.library_id,
        'library_name', v_library_name,
        'owner_id', NEW.owner_id
      )
    );
  END IF;

  -- Admin notification (existing behavior)
  PERFORM public.notify_super_admins(
    NEW.library_id,
    'affiliate_referral_signup',
    'Affiliate referral signup',
    'Library "' || COALESCE(v_library_name, 'Library') || '" signed up via affiliate ' ||
      COALESCE(v_affiliate_name, v_affiliate_code, 'partner') || '.',
    'affiliate',
    NULL,
    jsonb_build_object(
      'affiliate_id', NEW.affiliate_id,
      'affiliate_name', v_affiliate_name,
      'affiliate_code', v_affiliate_code,
      'library_id', NEW.library_id,
      'library_name', v_library_name,
      'owner_id', NEW.owner_id
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_on_library_acquisition ON public.library_acquisition;
CREATE TRIGGER notify_on_library_acquisition
AFTER INSERT OR UPDATE OF affiliate_id ON public.library_acquisition
FOR EACH ROW
EXECUTE FUNCTION public.handle_library_acquisition_notification();

-- 4) Notify partner + admin when a commission is created (first successful payment)
CREATE OR REPLACE FUNCTION public.handle_partner_commission_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner_user_id UUID;
  v_partner_name TEXT;
  v_partner_code TEXT;
  v_library_name TEXT;
BEGIN
  SELECT a.user_id, a.name, a.code
  INTO v_partner_user_id, v_partner_name, v_partner_code
  FROM public.affiliates a
  WHERE a.id = NEW.affiliate_id;

  SELECT l.name
  INTO v_library_name
  FROM public.libraries l
  WHERE l.id = NEW.library_id;

  -- Partner notification
  IF v_partner_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (
      user_id,
      library_id,
      category,
      type,
      title,
      message,
      metadata
    )
    VALUES (
      v_partner_user_id,
      NEW.library_id,
      'affiliate',
      'partner_commission_earned',
      'Commission earned',
      'You earned ' || NEW.commission_earned || ' commission from "' || COALESCE(v_library_name, 'Library') || '".',
      jsonb_build_object(
        'affiliate_id', NEW.affiliate_id,
        'affiliate_code', v_partner_code,
        'commission_id', NEW.id,
        'commission_amount', NEW.commission_earned,
        'commission_rate', NEW.commission_rate,
        'library_id', NEW.library_id,
        'library_name', v_library_name
      )
    );
  END IF;

  -- Admin notification
  PERFORM public.notify_super_admins(
    NEW.library_id,
    'partner_commission_earned',
    'Partner commission earned',
    COALESCE(v_partner_name, v_partner_code, 'Partner') || ' earned ' || NEW.commission_earned ||
      ' commission from "' || COALESCE(v_library_name, 'Library') || '".',
    'affiliate',
    NULL,
    jsonb_build_object(
      'affiliate_id', NEW.affiliate_id,
      'affiliate_code', v_partner_code,
      'commission_id', NEW.id,
      'commission_amount', NEW.commission_earned,
      'commission_rate', NEW.commission_rate,
      'library_id', NEW.library_id,
      'library_name', v_library_name
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_on_partner_commission ON public.affiliate_commissions;
CREATE TRIGGER notify_on_partner_commission
AFTER INSERT ON public.affiliate_commissions
FOR EACH ROW
EXECUTE FUNCTION public.handle_partner_commission_notification();

