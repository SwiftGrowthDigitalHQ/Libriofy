export type EventLogStatus = "START" | "SUCCESS" | "FAILED";

export type AlertSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export type ObservabilityMetadata = Record<string, unknown>;

export type EventLogInput = {
  type: string;
  status: EventLogStatus;
  user?: string | null;
  entityId?: string | null;
  metadata?: ObservabilityMetadata;
  message?: string | null;
};

export type AdminAlertInput = {
  type: string;
  severity: AlertSeverity;
  user?: string | null;
  message: string;
  metadata?: ObservabilityMetadata;
};

export type RecentObservabilitySignal = {
  created_at: string;
  entity_id: string | null;
  event_type: string;
  message: string | null;
  severity: AlertSeverity;
  status: EventLogStatus;
  user_identifier: string | null;
};
