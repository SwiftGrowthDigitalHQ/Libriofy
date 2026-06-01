CREATE OR REPLACE FUNCTION public.trigger_pending_subscription_payment_reconciliation()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id BIGINT;
BEGIN
  SELECT net.http_post(
    url := public.resolve_supabase_edge_function_url('reconcile-pending-payments'),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'limit', 100,
      'source', 'pending_subscription_payment_reconciliation_scheduler'
    )
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
$$;

DO $job$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM cron.job
      WHERE jobname = 'pending-subscription-payment-reconciliation'
    )
  THEN
    PERFORM cron.schedule(
      'pending-subscription-payment-reconciliation',
      '*/5 * * * *',
      $$SELECT public.trigger_pending_subscription_payment_reconciliation();$$
    );
  END IF;
END
$job$;
