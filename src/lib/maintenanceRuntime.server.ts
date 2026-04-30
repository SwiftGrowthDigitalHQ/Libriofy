export type SafeMaintenanceStatus = {
  maintenance: boolean;
  maintenanceMode: boolean;
  source: "api" | "database" | "environment" | "fallback";
  updatedAt: string | null;
};

const FALLBACK_MAINTENANCE: SafeMaintenanceStatus = {
  maintenance: false,
  maintenanceMode: false,
  source: "fallback",
  updatedAt: null,
};

const normalizeSource = (value: unknown): SafeMaintenanceStatus["source"] => {
  if (value === "api" || value === "database" || value === "environment" || value === "fallback") {
    return value;
  }

  return "fallback";
};

const normalizeBoolean = (value: unknown) => Boolean(value);

const normalizeStringOrNull = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

const normalizeMaintenanceStatus = (value: unknown): SafeMaintenanceStatus => {
  if (!value || typeof value !== "object") {
    return { ...FALLBACK_MAINTENANCE };
  }

  const record = value as Record<string, unknown>;
  const maintenance = normalizeBoolean(record.maintenance ?? record.maintenanceMode ?? record.maintenance_mode);

  return {
    maintenance,
    maintenanceMode: maintenance,
    source: normalizeSource(record.source),
    updatedAt: normalizeStringOrNull(record.updatedAt ?? record.updated_at),
  };
};

export const getFallbackMaintenance = (): SafeMaintenanceStatus => ({ ...FALLBACK_MAINTENANCE });

export const readSafeMaintenanceStatus = async (): Promise<SafeMaintenanceStatus> => {
  try {
    const maintenanceModule = await import("./maintenance.server.js");

    if (typeof maintenanceModule.getMaintenance === "function") {
      return normalizeMaintenanceStatus(await maintenanceModule.getMaintenance());
    }

    if (typeof maintenanceModule.resolveMaintenanceStatus === "function") {
      return normalizeMaintenanceStatus(await maintenanceModule.resolveMaintenanceStatus(process.env));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log("Maintenance fallback used:", message);
  }

  return getFallbackMaintenance();
};
