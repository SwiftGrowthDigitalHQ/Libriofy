import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  resolveMissingDatabaseContracts,
  resolveMissingDatabaseEntities,
  type DatabaseHealthPayload,
} from "@/lib/observability/databaseHealth.shared";
import { captureClientError } from "@/lib/observability/clientMonitoring";

const fetchDatabaseHealth = async (): Promise<DatabaseHealthPayload> => {
  const response = await fetch("/api/health/db", {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  const rawText = await response.text();
  const parsed = rawText ? (JSON.parse(rawText) as Partial<DatabaseHealthPayload>) : null;

  if (!parsed || typeof parsed.status !== "string") {
    throw new Error("Database health endpoint returned an invalid payload.");
  }

  return parsed as DatabaseHealthPayload;
};

export const useDatabaseHealth = () => {
  const lastLoggedSignature = useRef<string | null>(null);
  const query = useQuery({
    queryKey: ["database-health"],
    queryFn: fetchDatabaseHealth,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    staleTime: 60_000,
  });

  useEffect(() => {
    const health = query.data;
    if (!health || health.status === "ok") {
      return;
    }

    const missingEntities = resolveMissingDatabaseEntities(health);
    const missingContracts = resolveMissingDatabaseContracts(health);
    const signature = `${health.status}:${missingEntities.join(",")}:${missingContracts.join(",")}:${health.detail ?? ""}`;
    if (lastLoggedSignature.current === signature) {
      return;
    }

    lastLoggedSignature.current = signature;

    console.error("[health] database schema warning", {
      detail: health.detail,
      missingContracts,
      missingEntities,
      route: typeof window !== "undefined" ? window.location.pathname : "/",
      source: "database_health",
      status: health.status,
    });

    captureClientError(new Error(health.detail || "Critical database health check is degraded."), {
      detail: health.detail,
      missingContracts,
      missingEntities,
      route: typeof window !== "undefined" ? window.location.pathname : "/",
      source: "database_health",
      status: health.status,
    });
  }, [query.data]);

  return query;
};
