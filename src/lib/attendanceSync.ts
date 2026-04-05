import { supabase } from "@/integrations/supabase/client";

import { readStoredLibraryAccessKey } from "@/lib/deviceKiosk";

export type AttendanceQueueStatus = "pending" | "failed";

export type AttendanceQueueEntry = {
  entry_id: string;
  student_id: string;
  library_id: string;
  library_access_key: string;
  timestamp: string;
  status: AttendanceQueueStatus;
  qr_code: string;
  device_id: string;
  retries: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type AttendanceScanSuccessPayload = {
  status: "success";
  success: true;
  action: "check-in" | "check-out";
  name: string;
  studentName: string;
  seat: string;
  time: string;
  message?: string;
  duplicate?: boolean;
};

export type AttendanceScanErrorPayload = {
  status: "error";
  success?: false;
  message: string;
  code?: string;
};

export type AttendanceScanQueuedPayload = {
  status: "queued";
  success?: false;
  message: string;
  time: string;
  entry_id: string;
};

export type AttendanceScanPayload =
  | AttendanceScanSuccessPayload
  | AttendanceScanErrorPayload
  | AttendanceScanQueuedPayload;

export type AttendanceSyncStats = {
  attemptedCount: number;
  syncedCount: number;
  failedCount: number;
  remainingCount: number;
};

type AttendanceSubmissionOptions = {
  scanApiUrl: string;
  deviceToken?: string;
  timeoutMs?: number;
};

const DB_NAME = "libriofy-attendance-queue";
const DB_VERSION = 1;
const STORE_NAME = "attendance_queue";
const LAST_SYNC_STORAGE_KEY = "libriofy:attendance-last-sync";
const ATTENDANCE_SYNC_LOCK_NAME = "libriofy-attendance-sync";
const DEFAULT_TIMEOUT_MS = 8000;

let queueDbPromise: Promise<IDBDatabase> | null = null;
let lastEntryTimestamp = "";
let lastEntrySequence = 0;

const isBrowser = () => typeof window !== "undefined" && typeof indexedDB !== "undefined";

const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const nowIso = () => new Date().toISOString();

const normalizeEntryIdSegment = (value: string) => trimText(value).replace(/[^A-Za-z0-9_-]+/g, "-");

const buildAttendanceEntryId = (deviceId: string, timestamp: string) => {
  const normalizedDeviceId = normalizeEntryIdSegment(deviceId) || "device";
  const normalizedTimestamp = normalizeEntryIdSegment(timestamp) || normalizeEntryIdSegment(nowIso());

  if (normalizedTimestamp === lastEntryTimestamp) {
    lastEntrySequence += 1;
  } else {
    lastEntryTimestamp = normalizedTimestamp;
    lastEntrySequence = 0;
  }

  return `${normalizedDeviceId}-${normalizedTimestamp}${lastEntrySequence > 0 ? `-${lastEntrySequence}` : ""}`;
};

type AttendanceSyncLockManager = {
  request: <T>(name: string, options: { mode: "exclusive" }, callback: () => Promise<T>) => Promise<T>;
};

const withAttendanceSyncLock = async <T,>(task: () => Promise<T>): Promise<T> => {
  if (typeof navigator === "undefined") {
    return task();
  }

  const locks = (navigator as Navigator & { locks?: AttendanceSyncLockManager }).locks;
  if (!locks?.request) {
    return task();
  }

  return locks.request(ATTENDANCE_SYNC_LOCK_NAME, { mode: "exclusive" }, task);
};

const formatTimeLabel = (timestamp: string) => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return new Date().toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
};

const normalizeAction = (value: unknown): AttendanceScanSuccessPayload["action"] => {
  const normalized = trimText(value).toLowerCase().replace(/_/g, "-");
  return normalized === "check-out" ? "check-out" : "check-in";
};

const requestToPromise = <T,>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to access the attendance queue."));
  });

const transactionToPromise = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Unable to update the attendance queue."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Unable to update the attendance queue."));
  });

const openQueueDb = () => {
  if (!isBrowser()) {
    return Promise.reject(new Error("IndexedDB is unavailable."));
  }

  if (!queueDbPromise) {
    queueDbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (db.objectStoreNames.contains(STORE_NAME)) {
          return;
        }

        const store = db.createObjectStore(STORE_NAME, { keyPath: "entry_id" });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("timestamp", "timestamp", { unique: false });
        store.createIndex("updated_at", "updated_at", { unique: false });
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
        };
        resolve(db);
      };

      request.onerror = () => {
        queueDbPromise = null;
        reject(request.error ?? new Error("Unable to open the attendance queue."));
      };
    });
  }

  return queueDbPromise;
};

const readLocalRecord = (key: string) => {
  if (!isBrowser()) {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeLocalRecord = (key: string, value: string | null) => {
  if (!isBrowser()) {
    return;
  }

  try {
    if (value === null) {
      window.localStorage.removeItem(key);
      return;
    }

    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage quota or privacy-mode failures.
  }
};

const buildQueuedPayload = (entry: AttendanceQueueEntry, message: string): AttendanceScanQueuedPayload => ({
  status: "queued",
  message,
  time: formatTimeLabel(entry.timestamp),
  entry_id: entry.entry_id,
});

const normalizeSuccessPayload = (
  payload: unknown,
  entry: AttendanceQueueEntry,
): AttendanceScanSuccessPayload => {
  const record =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};

  const name =
    trimText(record.name) || trimText(record.student_name) || trimText(record.title) || "Entry";
  const seat =
    trimText(record.seat) ||
    trimText(record.seat_number) ||
    trimText(record.location) ||
    "Unassigned";
  const time =
    trimText(record.time) ||
    trimText(record.slot_label) ||
    formatTimeLabel(entry.timestamp);
  const action = normalizeAction(record.action);
  const message = trimText(record.message) || (action === "check-out" ? "Checked out successfully." : "Checked in successfully.");
  const duplicate = record.duplicate === true || record.action === "duplicate";

  return {
    status: "success",
    success: true,
    action,
    name,
    studentName: trimText(record.studentName) || trimText(record.student_name) || name,
    seat,
    time,
    ...(message ? { message } : {}),
    ...(duplicate ? { duplicate: true } : {}),
  };
};

const normalizeErrorPayload = (payload: unknown, fallbackMessage: string): AttendanceScanErrorPayload => {
  const record =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};

  const message = trimText(record.message) || trimText(record.error) || fallbackMessage;
  return {
    status: "error",
    success: false,
    message,
    ...(trimText(record.code) ? { code: trimText(record.code) } : {}),
  };
};

const isTransportFailureMessage = (message: string) => {
  const normalized = trimText(message).toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("internet") ||
    normalized.includes("network") ||
    normalized.includes("timed out") ||
    normalized.includes("timeout") ||
    normalized.includes("fetch") ||
    normalized.includes("unable to reach") ||
    normalized.includes("connection")
  );
};

const buildRequestBody = (entry: AttendanceQueueEntry) => {
  const normalizedStudentId = trimText(entry.student_id);
  const normalizedQrCode = trimText(entry.qr_code);

  return {
    qr_code: entry.qr_code,
    ...(normalizedStudentId && normalizedStudentId !== normalizedQrCode
      ? { student_id: normalizedStudentId }
      : {}),
    device_id: entry.device_id,
    library_id: entry.library_id,
    library_access_key: entry.library_access_key || readStoredLibraryAccessKey() || "",
    entry_id: entry.entry_id,
    timestamp: entry.timestamp,
    status: entry.status,
  };
};

const buildRequestHeaders = (deviceToken?: string) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (deviceToken) {
    headers["x-device-token"] = deviceToken;
  }

  return headers;
};

const invokeSupabaseFallback = async (
  entry: AttendanceQueueEntry,
  deviceToken?: string,
): Promise<AttendanceScanPayload> => {
  const headers: Record<string, string> = {};
  if (deviceToken) {
    headers["x-device-token"] = deviceToken;
  }

  const { data, error } = await supabase.functions.invoke("scan-attendance", {
    body: buildRequestBody(entry),
    headers,
  });

  if (error) {
    throw new Error(error.message || "Unable to reach the scan handler.");
  }

  return normalizeServerPayload(data, entry);
};

const normalizeServerPayload = (payload: unknown, entry: AttendanceQueueEntry): AttendanceScanPayload => {
  const record =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};

  const duplicate = record.duplicate === true || record.action === "duplicate";
  const status = trimText(record.status);

  if (duplicate || status === "success") {
    return {
      ...normalizeSuccessPayload(record, entry),
      ...(duplicate ? { duplicate: true } : {}),
    };
  }

  if (status === "error") {
    return normalizeErrorPayload(record, "Unable to verify this ID right now.");
  }

  return normalizeErrorPayload(record, "Unable to verify this ID right now.");
};

const sendAttendanceRequest = async (
  entry: AttendanceQueueEntry,
  options: AttendanceSubmissionOptions,
): Promise<AttendanceScanPayload> => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(options.scanApiUrl, {
      method: "POST",
      headers: buildRequestHeaders(options.deviceToken),
      body: JSON.stringify(buildRequestBody(entry)),
      signal: controller.signal,
    });

    if (response.status === 404) {
      return invokeSupabaseFallback(entry, options.deviceToken);
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (response.status >= 500) {
      // In local/dev, middleware/API may fail while the deployed edge function still works.
      try {
        return await invokeSupabaseFallback(entry, options.deviceToken);
      } catch {
        return normalizeErrorPayload(payload, "Live verification is temporarily unavailable.");
      }
    }

    if (response.status >= 400) {
      return normalizeErrorPayload(payload, "Unable to verify this ID right now.");
    }

    return normalizeServerPayload(payload, entry);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("The scanner is taking too long to respond.");
    }

    if (error instanceof TypeError) {
      return invokeSupabaseFallback(entry, options.deviceToken);
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const updateQueueEntry = async (entry: AttendanceQueueEntry) => {
  const db = await openQueueDb();
  const transaction = db.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).put(entry);
  await transactionToPromise(transaction);
  return entry;
};

export const createAttendanceQueueEntry = ({
  deviceId,
  studentId,
  libraryId,
  libraryAccessKey,
  qrCode,
  timestamp,
}: {
  deviceId: string;
  studentId: string;
  libraryId: string;
  libraryAccessKey: string;
  qrCode: string;
  timestamp?: string;
}): AttendanceQueueEntry => {
  const normalizedDeviceId = trimText(deviceId) || "device";
  const normalizedStudentId = trimText(studentId) || trimText(qrCode);
  const normalizedLibraryId = trimText(libraryId);
  const normalizedLibraryAccessKey = trimText(libraryAccessKey);
  const normalizedQrCode = trimText(qrCode);
  const entryTimestamp = trimText(timestamp) || nowIso();

  return {
    entry_id: buildAttendanceEntryId(normalizedDeviceId, entryTimestamp),
    student_id: normalizedStudentId || normalizedQrCode,
    library_id: normalizedLibraryId,
    library_access_key: normalizedLibraryAccessKey,
    timestamp: entryTimestamp,
    status: "pending",
    qr_code: normalizedQrCode,
    device_id: normalizedDeviceId,
    retries: 0,
    last_error: null,
    created_at: entryTimestamp,
    updated_at: entryTimestamp,
  };
};

export const enqueueAttendanceQueueEntry = async (entry: AttendanceQueueEntry) => {
  if (!isBrowser()) {
    return entry;
  }

  const db = await openQueueDb();
  const transaction = db.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).put(entry);
  await transactionToPromise(transaction);
  return entry;
};

export const listAttendanceQueueEntries = async () => {
  if (!isBrowser()) {
    return [];
  }

  const db = await openQueueDb();
  const transaction = db.transaction(STORE_NAME, "readonly");
  const entries = await requestToPromise<AttendanceQueueEntry[]>(transaction.objectStore(STORE_NAME).getAll());
  return entries
    .filter((entry) => Boolean(entry?.entry_id))
    .sort(
      (left, right) =>
        left.timestamp.localeCompare(right.timestamp) ||
        left.created_at.localeCompare(right.created_at) ||
        left.entry_id.localeCompare(right.entry_id),
    );
};

export const countAttendanceQueueEntries = async () => {
  if (!isBrowser()) {
    return 0;
  }

  const db = await openQueueDb();
  const transaction = db.transaction(STORE_NAME, "readonly");
  return requestToPromise<number>(transaction.objectStore(STORE_NAME).count());
};

export const removeAttendanceQueueEntry = async (entryId: string) => {
  if (!isBrowser()) {
    return;
  }

  const normalizedEntryId = trimText(entryId);
  if (!normalizedEntryId) {
    return;
  }

  const db = await openQueueDb();
  const transaction = db.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).delete(normalizedEntryId);
  await transactionToPromise(transaction);
};

export const clearAttendanceQueue = async () => {
  if (!isBrowser()) {
    return;
  }

  const db = await openQueueDb();
  const transaction = db.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).clear();
  await transactionToPromise(transaction);
};

export const updateAttendanceQueueEntry = async (
  entryId: string,
  patch: Partial<Pick<AttendanceQueueEntry, "status" | "retries" | "last_error" | "updated_at">>,
) => {
  const normalizedEntryId = trimText(entryId);
  if (!normalizedEntryId) {
    return null;
  }

  const existingEntries = await listAttendanceQueueEntries();
  const currentEntry = existingEntries.find((entry) => entry.entry_id === normalizedEntryId);
  if (!currentEntry) {
    return null;
  }

  const updatedEntry: AttendanceQueueEntry = {
    ...currentEntry,
    ...patch,
    updated_at: patch.updated_at ?? nowIso(),
  };

  await updateQueueEntry(updatedEntry);
  return updatedEntry;
};

export const readLastAttendanceSyncAt = () => {
  const value = readLocalRecord(LAST_SYNC_STORAGE_KEY);
  const normalized = trimText(value);
  return normalized || null;
};

export const writeLastAttendanceSyncAt = (timestamp: string | null) => {
  const normalized = trimText(timestamp);
  writeLocalRecord(LAST_SYNC_STORAGE_KEY, normalized || null);
};

export const submitAttendanceScan = async ({
  entry,
  scanApiUrl,
  deviceToken,
  timeoutMs,
}: {
  entry: AttendanceQueueEntry;
  scanApiUrl: string;
  deviceToken?: string;
  timeoutMs?: number;
}): Promise<AttendanceScanPayload> => {
  if (!isBrowser() || !window.navigator.onLine) {
    await enqueueAttendanceQueueEntry(entry);
    return buildQueuedPayload(
      entry,
      "Saved offline. The scan will sync automatically when the connection returns.",
    );
  }

  try {
    return await sendAttendanceRequest(entry, { scanApiUrl, deviceToken, timeoutMs });
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "Connection issue detected. The scan was saved locally.";

    // Keep queue strictly for transport failures; surface server errors immediately.
    if (!isTransportFailureMessage(message)) {
      return {
        status: "error",
        message,
      };
    }

    await enqueueAttendanceQueueEntry({
      ...entry,
      status: "pending",
      last_error: null,
      updated_at: nowIso(),
    });

    return buildQueuedPayload(
      entry,
      message.includes("internet")
        ? "Saved offline. The scan will sync automatically when the connection returns."
        : "Connection issue detected. The scan was saved locally and will sync automatically.",
    );
  }
};

export const syncQueuedAttendance = async ({
  scanApiUrl,
  deviceToken,
  timeoutMs,
}: {
  scanApiUrl: string;
  deviceToken?: string;
  timeoutMs?: number;
}): Promise<AttendanceSyncStats> =>
  withAttendanceSyncLock(async () => {
    if (!isBrowser() || !window.navigator.onLine) {
      return {
        attemptedCount: 0,
        syncedCount: 0,
        failedCount: 0,
        remainingCount: await countAttendanceQueueEntries(),
      };
    }

    const queuedEntries = await listAttendanceQueueEntries();
    if (!queuedEntries.length) {
      return {
        attemptedCount: 0,
        syncedCount: 0,
        failedCount: 0,
        remainingCount: 0,
      };
    }

    let syncedCount = 0;
    let failedCount = 0;

    for (const entry of queuedEntries) {
      try {
        const payload = await sendAttendanceRequest(entry, { scanApiUrl, deviceToken, timeoutMs });

        if (payload.status === "success") {
          await removeAttendanceQueueEntry(entry.entry_id);
          syncedCount += 1;
          continue;
        }

        if (payload.status === "error") {
          await updateAttendanceQueueEntry(entry.entry_id, {
            status: "failed",
            retries: entry.retries + 1,
            last_error: payload.message,
            updated_at: nowIso(),
          });
          failedCount += 1;
        }
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim()
            ? error.message
            : "Unable to sync this scan right now.";

        await updateAttendanceQueueEntry(entry.entry_id, {
          status: "failed",
          retries: entry.retries + 1,
          last_error: message,
          updated_at: nowIso(),
        });
        failedCount += 1;
      }
    }

    writeLastAttendanceSyncAt(nowIso());

    return {
      attemptedCount: queuedEntries.length,
      syncedCount,
      failedCount,
      remainingCount: await countAttendanceQueueEntries(),
    };
  });
