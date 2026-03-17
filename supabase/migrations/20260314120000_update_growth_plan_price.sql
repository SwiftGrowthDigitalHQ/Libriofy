-- Align Growth plan pricing with current catalog.

UPDATE public.subscription_plans
SET price = 4999
WHERE code = 'growth';

