CREATE OR REPLACE FUNCTION public.get_schema_entity_status(p_entities TEXT[])
RETURNS TABLE (
  entity_name TEXT,
  exists_in_schema BOOLEAN,
  relation_name TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH requested_entities AS (
    SELECT trim(entity_name) AS entity_name
    FROM unnest(COALESCE(p_entities, ARRAY[]::TEXT[])) AS entity_name
    WHERE trim(entity_name) <> ''
  )
  SELECT
    requested_entities.entity_name,
    to_regclass(format('public.%I', requested_entities.entity_name)) IS NOT NULL AS exists_in_schema,
    to_regclass(format('public.%I', requested_entities.entity_name))::TEXT AS relation_name
  FROM requested_entities;
$$;

REVOKE ALL ON FUNCTION public.get_schema_entity_status(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_schema_entity_status(TEXT[]) TO service_role;
