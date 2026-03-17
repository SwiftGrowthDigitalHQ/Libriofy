import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type LockerRow = Database["public"]["Tables"]["lockers"]["Row"];
type LockerInsertCompat = Database["public"]["Tables"]["lockers"]["Insert"] & {
  col?: number;
  col_position?: number;
  row_position?: number;
};
type LockerCapacityInventoryRow = Pick<LockerRow, "id" | "locker_number" | "student_id">;

export type LockerRecord = Pick<
  LockerRow,
  "created_at" | "id" | "locker_number" | "monthly_price" | "payment_due_date" | "row" | "status" | "student_id"
> & { column: number };
export type LockerCapacityInventoryRecord = LockerCapacityInventoryRow;

type LockerRowCompat = Omit<LockerRow, "column" | "row"> & {
  col?: number | null;
  col_position?: number | null;
  column?: number | null;
  row?: number | null;
  row_position?: number | null;
};

const LOCKER_GRID_COLUMNS = 5;

const resolveLockerRow = (locker: Pick<LockerRowCompat, "row" | "row_position">) => {
  if (typeof locker.row === "number") return locker.row;
  if (typeof locker.row_position === "number") return locker.row_position + 1;
  return 1;
};

const resolveLockerColumn = (locker: Pick<LockerRowCompat, "col" | "col_position" | "column">) => {
  if (typeof locker.column === "number") return locker.column;
  if (typeof locker.col === "number") return locker.col;
  if (typeof locker.col_position === "number") return locker.col_position + 1;
  return 1;
};

const normalizeLockerRecord = (locker: LockerRowCompat): LockerRecord => ({
  created_at: locker.created_at,
  id: locker.id,
  locker_number: locker.locker_number,
  monthly_price: locker.monthly_price,
  payment_due_date: locker.payment_due_date,
  row: resolveLockerRow(locker),
  status: locker.status,
  student_id: locker.student_id,
  column: resolveLockerColumn(locker),
});

const sortLockers = (lockers: LockerRecord[]) =>
  [...lockers].sort((a, b) => {
    if (a.row !== b.row) return a.row - b.row;
    if (a.column !== b.column) return a.column - b.column;
    return a.locker_number.localeCompare(b.locker_number, undefined, { numeric: true, sensitivity: "base" });
  });

export const lockerApiRoutes = {
  list: "/api/lockers",
  assign: "/api/lockers/assign",
  release: "/api/lockers/release",
} as const;

const parseLockerIndex = (lockerNumber: string | null | undefined) => {
  const match = String(lockerNumber ?? "").match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : 0;
};

const buildLockerPosition = (index: number, columns = LOCKER_GRID_COLUMNS) => {
  const zeroBasedIndex = Math.max(index - 1, 0);
  const rowPosition = Math.floor(zeroBasedIndex / columns);
  const colPosition = zeroBasedIndex % columns;

  return {
    colPosition,
    column: colPosition + 1,
    row: rowPosition + 1,
    rowPosition,
  };
};

const isSchemaShapeError = (error: { message?: string } | null | undefined) =>
  /could not find the '.*' column|column .* does not exist|schema cache/i.test(String(error?.message ?? ""));

const isDuplicateLockerError = (error: { code?: string; message?: string } | null | undefined) =>
  error?.code === "23505" || /duplicate key|already exists/i.test(String(error?.message ?? ""));

const isMissingRpcError = (error: { code?: string; message?: string } | null | undefined) =>
  error?.code === "PGRST202" || /could not find the function/i.test(String(error?.message ?? ""));

const isPermissionError = (error: { code?: string; message?: string } | null | undefined) =>
  error?.code === "42501" || /row-level security|permission denied|not allowed/i.test(String(error?.message ?? ""));

const toLockerCapacitySyncError = (error: unknown) => {
  const maybeError = error as { message?: string; code?: string } | null | undefined;

  if (isPermissionError(maybeError)) {
    return new Error(
      "Locker rows could not be created with the current Supabase RLS policies. Apply the latest locker migrations and try again.",
    );
  }

  if (isSchemaShapeError(maybeError) || isMissingRpcError(maybeError)) {
    return new Error(
      "This Supabase project is still using an older locker schema. Apply the latest locker migrations and try again.",
    );
  }

  return error instanceof Error ? error : new Error(String(maybeError?.message ?? "Locker capacity sync failed."));
};

const insertLockerWithFallbacks = async ({
  libraryId,
  lockerNumber,
  row,
  column,
  rowPosition,
  colPosition,
}: {
  libraryId: string;
  lockerNumber: string;
  row: number;
  column: number;
  rowPosition: number;
  colPosition: number;
}) => {
  const payloads: LockerInsertCompat[] = [
    { library_id: libraryId, locker_number: lockerNumber, monthly_price: 0, row, column, status: "available" },
    { library_id: libraryId, locker_number: lockerNumber, monthly_price: 0, row, col: column, status: "available" },
    {
      library_id: libraryId,
      locker_number: lockerNumber,
      monthly_price: 0,
      row,
      col_position: colPosition,
      status: "available",
    },
    {
      library_id: libraryId,
      locker_number: lockerNumber,
      monthly_price: 0,
      row_position: rowPosition,
      column,
      status: "available",
    },
    {
      library_id: libraryId,
      locker_number: lockerNumber,
      monthly_price: 0,
      row_position: rowPosition,
      col: column,
      status: "available",
    },
    {
      library_id: libraryId,
      locker_number: lockerNumber,
      monthly_price: 0,
      row_position: rowPosition,
      col_position: colPosition,
      status: "available",
    },
  ];

  let lastError: { message?: string } | null = null;

  for (const payload of payloads) {
    const { error } = await supabase.from("lockers").insert(payload as never);
    if (!error || isDuplicateLockerError(error)) return;
    if (!isSchemaShapeError(error)) throw error;
    lastError = error;
  }

  if (lastError) throw lastError;
};

const updateLibraryLockerCapacityMetadata = async (libraryId: string, totalLockers: number) => {
  const { error } = await supabase
    .from("libraries")
    .update({ total_lockers: totalLockers } as never)
    .eq("id", libraryId);

  if (!error) {
    return true;
  }

  if (isSchemaShapeError(error)) {
    return false;
  }

  throw error;
};

const syncLockerCapacityWithRpc = async (libraryId: string, targetCapacity: number) => {
  const { error } = await supabase.rpc("sync_library_lockers", {
    p_columns: LOCKER_GRID_COLUMNS,
    p_library_id: libraryId,
    p_total_lockers: targetCapacity,
  } as never);

  if (!error) {
    return true;
  }

  if (isMissingRpcError(error)) {
    return false;
  }

  throw error;
};

const fetchLockerCapacityInventory = async (libraryId: string): Promise<LockerCapacityInventoryRecord[]> => {
  const { data, error } = await supabase
    .from("lockers")
    .select("id, locker_number, student_id")
    .eq("library_id", libraryId);

  if (error) {
    throw error;
  }

  return data ?? [];
};

const getBlockingLockers = (existingLockers: LockerCapacityInventoryRecord[], targetCapacity: number) =>
  existingLockers.filter((locker) => locker.student_id && parseLockerIndex(locker.locker_number) > targetCapacity);

const isLockerInventorySynced = (existingLockers: LockerCapacityInventoryRecord[], targetCapacity: number) => {
  const lockersByIndex = new Map<number, LockerCapacityInventoryRecord>();

  for (const locker of existingLockers) {
    const index = parseLockerIndex(locker.locker_number);
    if (index > 0 && !lockersByIndex.has(index)) {
      lockersByIndex.set(index, locker);
    }
  }

  for (let index = 1; index <= targetCapacity; index += 1) {
    if (!lockersByIndex.has(index)) {
      return false;
    }
  }

  return !existingLockers.some((locker) => !locker.student_id && parseLockerIndex(locker.locker_number) > targetCapacity);
};

const reconcileLockerCapacityRows = async ({
  libraryId,
  targetCapacity,
  existingLockers,
}: {
  libraryId: string;
  targetCapacity: number;
  existingLockers: LockerCapacityInventoryRecord[];
}) => {
  const lockersByIndex = new Map<number, LockerCapacityInventoryRecord>();

  for (const locker of existingLockers) {
    const index = parseLockerIndex(locker.locker_number);
    if (index > 0 && !lockersByIndex.has(index)) {
      lockersByIndex.set(index, locker);
    }
  }

  for (let index = 1; index <= targetCapacity; index += 1) {
    if (lockersByIndex.has(index)) continue;
    const position = buildLockerPosition(index);
    await insertLockerWithFallbacks({
      colPosition: position.colPosition,
      column: position.column,
      libraryId,
      lockerNumber: `L${index}`,
      row: position.row,
      rowPosition: position.rowPosition,
    });
  }

  const removableLockers = existingLockers.filter(
    (locker) => !locker.student_id && parseLockerIndex(locker.locker_number) > targetCapacity,
  );
  if (removableLockers.length === 0) return;

  const { error } = await supabase
    .from("lockers")
    .delete()
    .in("id", removableLockers.map((locker) => locker.id));
  if (error) throw error;
};

export const syncLockerCapacity = async ({
  libraryId,
  targetCapacity,
  existingLockers,
}: {
  libraryId: string;
  targetCapacity: number;
  existingLockers: LockerCapacityInventoryRecord[];
}) => {
  const target = Math.max(0, Math.trunc(targetCapacity));
  const latestInventory = await fetchLockerCapacityInventory(libraryId).catch(() => existingLockers);
  const blockingLockers = getBlockingLockers(latestInventory, target);

  if (blockingLockers.length > 0) {
    throw new Error(
      `Cannot reduce locker capacity because ${blockingLockers.length} assigned locker${blockingLockers.length === 1 ? "" : "s"} are in the removal range.`,
    );
  }

  const metadataWasUpdated = await updateLibraryLockerCapacityMetadata(libraryId, target);

  let syncedInventory = await fetchLockerCapacityInventory(libraryId).catch(() => latestInventory);

  if (!metadataWasUpdated && isLockerInventorySynced(syncedInventory, target)) {
    return syncedInventory;
  }

  if (!isLockerInventorySynced(syncedInventory, target)) {
    const rpcSynced = await syncLockerCapacityWithRpc(libraryId, target).catch((error) => {
      throw toLockerCapacitySyncError(error);
    });

    if (rpcSynced) {
      syncedInventory = await fetchLockerCapacityInventory(libraryId);
    }
  }

  if (!isLockerInventorySynced(syncedInventory, target)) {
    try {
      await reconcileLockerCapacityRows({
        existingLockers: syncedInventory,
        libraryId,
        targetCapacity: target,
      });
    } catch (error) {
      throw toLockerCapacitySyncError(error);
    }

    syncedInventory = await fetchLockerCapacityInventory(libraryId);
  }

  if (!isLockerInventorySynced(syncedInventory, target)) {
    throw new Error("Locker capacity was updated, but the locker rows are still out of sync. Please try again.");
  }

  return syncedInventory;
};

export const getLockers = async (libraryId: string): Promise<LockerRecord[]> => {
  const { data, error } = await supabase
    .from("lockers")
    .select("*")
    .eq("library_id", libraryId);

  if (error) {
    throw error;
  }

  return sortLockers(((data ?? []) as LockerRowCompat[]).map(normalizeLockerRecord));
};

export const assignLocker = async ({
  lockerId,
  monthlyPrice,
  studentId,
}: {
  lockerId: string;
  monthlyPrice?: number | null;
  studentId: string;
}) => {
  const { data, error } = await supabase.rpc("assign_locker", {
    p_locker_id: lockerId,
    p_monthly_price: monthlyPrice ?? null,
    p_student_id: studentId,
  } as never);

  if (error) {
    throw error;
  }

  return data;
};

export const releaseLocker = async (lockerId: string) => {
  const { data, error } = await supabase.rpc("release_locker", {
    p_locker_id: lockerId,
  } as never);

  if (error) {
    throw error;
  }

  return data;
};

export const updateLocker = async ({
  lockerId,
  monthlyPrice,
  status,
}: {
  lockerId: string;
  monthlyPrice?: number;
  status?: LockerRow["status"];
}) => {
  const updates: Database["public"]["Tables"]["lockers"]["Update"] = {};

  if (typeof monthlyPrice === "number") {
    updates.monthly_price = monthlyPrice;
  }

  if (status) {
    updates.status = status;
  }

  const { data, error } = await supabase
    .from("lockers")
    .update(updates as never)
    .eq("id", lockerId)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return normalizeLockerRecord(data as LockerRowCompat);
};
