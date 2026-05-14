-- Production Performance Indexes
-- Purpose: Optimize queries for 100+ library scale
-- Applied: May 2026

-- attendance_logs: Most frequent query (library dashboard, today's attendance)
CREATE INDEX IF NOT EXISTS idx_attendance_logs_library_date
  ON public.attendance_logs (library_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_logs_student_date
  ON public.attendance_logs (student_id, date DESC);

-- students: QR scan lookup (by id or qr_code within library)
CREATE INDEX IF NOT EXISTS idx_students_library_qrcode
  ON public.students (library_id, qr_code);

CREATE INDEX IF NOT EXISTS idx_students_library_id
  ON public.students (library_id, id);

-- entry_devices: Heartbeat and scan validation
CREATE INDEX IF NOT EXISTS idx_entry_devices_device_id
  ON public.entry_devices (device_id);

-- library_access_keys: Scan and heartbeat validation
CREATE INDEX IF NOT EXISTS idx_library_access_keys_access_key
  ON public.library_access_keys (access_key);

-- platform_settings: Maintenance check (most frequent server query)
-- Already has PRIMARY KEY on (key), no additional index needed

-- login_logs: Admin security dashboard
CREATE INDEX IF NOT EXISTS idx_login_logs_user_time
  ON public.login_logs (user_id, login_time DESC);

-- subscription_payments: Revenue queries
CREATE INDEX IF NOT EXISTS idx_subscription_payments_library_created
  ON public.subscription_payments (library_id, created_at DESC);

-- platform_job_queue: Automation dashboard
CREATE INDEX IF NOT EXISTS idx_platform_job_queue_status_scheduled
  ON public.platform_job_queue (status, scheduled_for DESC)
  WHERE status IN ('pending', 'running', 'failed');
