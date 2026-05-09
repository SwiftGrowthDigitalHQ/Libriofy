export type EventLogStatus = "START" | "SUCCESS" | "FAILED";

export type AlertSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export type EventClassification =
  | "AUTH_ERROR"
  | "BILLING_ERROR"
  | "EMAIL_ERROR"
  | "IMPERSONATION_EVENT"
  | "OBSERVABILITY_ERROR"
  | "PERFORMANCE_EVENT"
  | "QUEUE_ERROR"
  | "RATE_LIMIT"
  | "SECURITY_EVENT";

export type ObservabilityMetadata = Record<string, unknown>;

export type EventLogInput = {
  type: string;
  status: EventLogStatus;
  classification?: EventClassification | null;
  fingerprint?: string | null;
  groupKey?: string | null;
  metricKey?: string | null;
  occurredAt?: string | null;
  severity?: AlertSeverity | null;
  user?: string | null;
  entityId?: string | null;
  metadata?: ObservabilityMetadata;
  message?: string | null;
};

export type AdminAlertInput = {
  type: string;
  severity: AlertSeverity;
  classification?: EventClassification | null;
  metricKey?: string | null;
  user?: string | null;
  message: string;
  metadata?: ObservabilityMetadata;
};

export type RecentObservabilitySignal = {
  classification: EventClassification | null;
  created_at: string;
  entity_id: string | null;
  event_type: string;
  message: string | null;
  metric_key: string | null;
  severity: AlertSeverity;
  status: EventLogStatus;
  user_identifier: string | null;
};

export type ObservabilityMetricSnapshot = {
  classification: EventClassification | null;
  created_at: string;
  event_type: string;
  failure_count: number;
  first_event_at: string | null;
  id: string;
  last_event_at: string | null;
  metric_key: string;
  success_count: number;
  success_rate: number;
  total_count: number;
  updated_at: string;
  window_seconds: number;
};
