-- Improve payout destination for bank payouts (use bank_details JSON when UPI is not used)

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
  v_upi_id TEXT;
  v_bank_details JSONB;
  v_destination TEXT;
  v_payout_id UUID;
  v_account_number TEXT;
  v_ifsc TEXT;
  v_bank_name TEXT;
BEGIN
  SELECT
    a.id,
    COALESCE(NULLIF(trim(a.payout_method), ''), 'upi'),
    NULLIF(trim(a.upi_id), ''),
    COALESCE(a.bank_details, '{}'::jsonb)
  INTO v_partner_id, v_method, v_upi_id, v_bank_details
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

  v_destination := v_upi_id;
  IF v_method = 'bank' THEN
    v_account_number := NULLIF(trim(COALESCE(v_bank_details->>'account_number', '')), '');
    v_ifsc := NULLIF(trim(COALESCE(v_bank_details->>'ifsc', '')), '');
    v_bank_name := NULLIF(trim(COALESCE(v_bank_details->>'bank_name', '')), '');
    v_destination := concat_ws(
      ' • ',
      v_bank_name,
      CASE WHEN v_account_number IS NOT NULL THEN 'A/C ' || v_account_number ELSE NULL END,
      CASE WHEN v_ifsc IS NOT NULL THEN 'IFSC ' || v_ifsc ELSE NULL END
    );
  END IF;

  INSERT INTO public.payouts (partner_id, amount, status, payout_method, payout_destination, requested_at)
  VALUES (v_partner_id, v_amount, 'pending', v_method, NULLIF(v_destination, ''), now())
  RETURNING id INTO v_payout_id;

  RETURN v_payout_id;
END;
$$;

