-- Harden the monthly analytics RPC so dashboard reads do not depend on caller row-security state.

CREATE OR REPLACE FUNCTION public.get_monthly_attendance_analytics(
  p_library_id UUID,
  p_month DATE DEFAULT date_trunc('month', CURRENT_DATE)::DATE
)
RETURNS TABLE (
  student_id UUID,
  full_name TEXT,
  present_days INTEGER,
  absent_days INTEGER,
  attendance_percent DOUBLE PRECISION,
  last_check_in TIMESTAMPTZ,
  last_check_out TIMESTAMPTZ,
  membership_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
SET row_security = off
AS $$
DECLARE
  v_month_start DATE := date_trunc('month', COALESCE(p_month, CURRENT_DATE))::DATE;
  v_month_end DATE := (date_trunc('month', COALESCE(p_month, CURRENT_DATE)) + INTERVAL '1 month - 1 day')::DATE;
  v_scope_end DATE := CASE
    WHEN date_trunc('month', CURRENT_DATE)::DATE = date_trunc('month', COALESCE(p_month, CURRENT_DATE))::DATE
      THEN CURRENT_DATE
    ELSE v_month_end
  END;
  v_days_in_scope INTEGER := GREATEST(1, (CASE
    WHEN date_trunc('month', CURRENT_DATE)::DATE = date_trunc('month', COALESCE(p_month, CURRENT_DATE))::DATE
      THEN CURRENT_DATE
    ELSE v_month_end
  END - date_trunc('month', COALESCE(p_month, CURRENT_DATE))::DATE) + 1);
BEGIN
  RETURN QUERY
  WITH monthly_attendance AS (
    SELECT
      al.student_id,
      COUNT(DISTINCT al.date)::INTEGER AS present_days,
      MAX(al.check_in) AS last_check_in,
      MAX(al.check_out) AS last_check_out
    FROM public.attendance_logs al
    WHERE al.library_id = p_library_id
      AND al.date BETWEEN v_month_start AND v_scope_end
    GROUP BY al.student_id
  )
  SELECT
    s.id AS student_id,
    COALESCE(NULLIF(TRIM(s.full_name), ''), 'Unknown Student') AS full_name,
    COALESCE(ma.present_days, 0) AS present_days,
    GREATEST(v_days_in_scope - COALESCE(ma.present_days, 0), 0) AS absent_days,
    ROUND(
      (
        (COALESCE(ma.present_days, 0)::DOUBLE PRECISION / v_days_in_scope::DOUBLE PRECISION) * 100.0
      )::NUMERIC,
      2
    )::DOUBLE PRECISION AS attendance_percent,
    ma.last_check_in,
    ma.last_check_out,
    COALESCE(NULLIF(TRIM(s.status), ''), 'unknown') AS membership_status
  FROM public.students s
  LEFT JOIN monthly_attendance ma ON ma.student_id = s.id
  WHERE s.library_id = p_library_id
  ORDER BY full_name ASC, student_id ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_monthly_attendance_analytics(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_monthly_attendance_analytics(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_monthly_attendance_analytics(UUID, DATE) TO service_role;
