-- Align subscription payment lifecycle with the production billing flow.
-- Canonical lifecycle:
--   pending -> paid | failed | expired

ALTER TABLE public.subscription_payments
  DROP CONSTRAINT IF EXISTS subscription_payments_status_check;

UPDATE public.subscription_payments
SET status = 'pending'
WHERE status NOT IN ('pending', 'paid', 'failed', 'expired');

ALTER TABLE public.subscription_payments
  ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE public.subscription_payments
  ADD CONSTRAINT subscription_payments_status_check
  CHECK (status IN ('pending', 'paid', 'failed', 'expired'));

NOTIFY pgrst, 'reload schema';
