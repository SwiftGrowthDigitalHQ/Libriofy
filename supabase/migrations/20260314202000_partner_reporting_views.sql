-- Compatibility/reporting views to match "partners" + "commissions" naming in the partner program spec.

CREATE OR REPLACE VIEW public.partners AS
SELECT
  a.code AS id,
  a.id AS partner_uuid,
  a.name,
  a.email,
  a.phone,
  a.city,
  a.commission_rate,
  a.total_sales,
  a.total_commission,
  a.created_at
FROM public.affiliates a;

CREATE OR REPLACE VIEW public.commissions AS
SELECT
  ac.id,
  a.code AS partner_id,
  ac.affiliate_id AS partner_uuid,
  ac.library_id,
  COALESCE(sp.amount, 0)::numeric(12, 2) AS sale_amount,
  ac.commission_earned AS commission_amount,
  ac.status,
  ac.created_at
FROM public.affiliate_commissions ac
JOIN public.affiliates a ON a.id = ac.affiliate_id
LEFT JOIN public.subscription_payments sp ON sp.id = ac.subscription_payment_id;

GRANT SELECT ON public.partners TO authenticated;
GRANT SELECT ON public.commissions TO authenticated;

