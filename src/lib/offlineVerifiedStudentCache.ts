export type OfflineVerifiedStudentRecord = {
  libraryId: string;
  studentId: string;
  name: string | null;
  seat: string | null;
  lastVerifiedAt: string;
};

const STORAGE_KEY = "libriofy:offline-verified-students:v1";
const MAX_RECORDS = 500;

const isBrowser = () => typeof window !== "undefined";

const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const buildKey = (libraryId: string, studentId: string) => `${libraryId}::${studentId}`;

const readCache = () => {
  if (!isBrowser()) {
    return {} as Record<string, OfflineVerifiedStudentRecord>;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {} as Record<string, OfflineVerifiedStudentRecord>;
    }

    const parsed = JSON.parse(raw) as Record<string, OfflineVerifiedStudentRecord>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {} as Record<string, OfflineVerifiedStudentRecord>;
  }
};

const writeCache = (cache: Record<string, OfflineVerifiedStudentRecord>) => {
  if (!isBrowser()) {
    return;
  }

  try {
    const records = Object.entries(cache)
      .sort((left, right) => right[1].lastVerifiedAt.localeCompare(left[1].lastVerifiedAt))
      .slice(0, MAX_RECORDS);

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(records)));
  } catch {
    // Ignore local storage failures.
  }
};

export const readOfflineVerifiedStudent = ({
  libraryId,
  studentId,
}: {
  libraryId: string;
  studentId: string;
}) => {
  const normalizedLibraryId = trimText(libraryId);
  const normalizedStudentId = trimText(studentId);
  if (!normalizedLibraryId || !normalizedStudentId) {
    return null;
  }

  const cache = readCache();
  return cache[buildKey(normalizedLibraryId, normalizedStudentId)] ?? null;
};

export const rememberOfflineVerifiedStudent = ({
  libraryId,
  studentId,
  name,
  seat,
  verifiedAt,
}: {
  libraryId: string;
  studentId: string;
  name?: string | null;
  seat?: string | null;
  verifiedAt?: string;
}) => {
  const normalizedLibraryId = trimText(libraryId);
  const normalizedStudentId = trimText(studentId);
  if (!normalizedLibraryId || !normalizedStudentId) {
    return;
  }

  const cache = readCache();
  cache[buildKey(normalizedLibraryId, normalizedStudentId)] = {
    libraryId: normalizedLibraryId,
    studentId: normalizedStudentId,
    name: trimText(name) || null,
    seat: trimText(seat) || null,
    lastVerifiedAt: trimText(verifiedAt) || new Date().toISOString(),
  };
  writeCache(cache);
};
