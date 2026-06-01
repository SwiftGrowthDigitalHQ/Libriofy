-- Fix the live payment capture RPC drift that cast plan code `starter` into the UUID column on subscription_plans.
-- The production function selected only plan columns into a `%ROWTYPE` variable, so Postgres tried to map
-- the first selected value (`code`) onto `subscription_plans.id` (`uuid`).
DO $$
BEGIN
  EXECUTE (
    SELECT replace(
      pg_get_functiondef('public.process_subscription_payment_capture(text,text,text,text,text,text,text)'::regprocedure),
      '  v_plan public.subscription_plans%ROWTYPE;',
      '  v_plan RECORD;'
    )
  );
END
$$ LANGUAGE plpgsql;
