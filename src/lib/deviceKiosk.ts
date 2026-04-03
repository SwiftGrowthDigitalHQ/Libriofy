import {
  buildStudentQrRouteValue,
  parseStudentQrPayload as parseSignedStudentQrPayload,
  type StudentQrParsedPayload,
  type StudentQrParseOptions,
} from "@/lib/studentQr";
import {
  readBrowserStorageItem,
  removeBrowserStorageItem,
  writeBrowserStorageItem,
} from "@/lib/browserStorage";

export const DEVICE_LIBRARY_STORAGE_KEY = "library_id";
export const DEVICE_LIBRARY_ACCESS_KEY_STORAGE_KEY = "library_access_key";
export const DEVICE_SETUP_NOTICE_STORAGE_KEY = "libriofy:device-setup-notice";

export type StudentQrPayloadSource = StudentQrParsedPayload["source"];
export type StudentQrPayload = StudentQrParsedPayload;
export type StoredLibraryBinding = {
  libraryId: string;
  libraryAccessKey: string;
};

const trimText = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const getBaseOrigin = (origin?: string) => {
  const normalized = trimText(origin);
  if (normalized) {
    return normalized;
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }

  return "";
};

export const readStoredLibraryId = () => {
  const value = readBrowserStorageItem("local", DEVICE_LIBRARY_STORAGE_KEY);
  const normalized = trimText(value);
  return normalized || null;
};

export const readStoredLibraryAccessKey = () => {
  const value = readBrowserStorageItem("local", DEVICE_LIBRARY_ACCESS_KEY_STORAGE_KEY);
  const normalized = trimText(value);
  return normalized || null;
};

export const writeStoredLibraryId = (libraryId: string) => {
  const normalized = trimText(libraryId);
  if (!normalized) {
    return;
  }

  writeBrowserStorageItem("local", DEVICE_LIBRARY_STORAGE_KEY, normalized);
};

export const writeStoredLibraryAccessKey = (libraryAccessKey: string) => {
  const normalized = trimText(libraryAccessKey);
  if (!normalized) {
    return;
  }

  writeBrowserStorageItem("local", DEVICE_LIBRARY_ACCESS_KEY_STORAGE_KEY, normalized);
};

export const writeStoredLibraryBinding = ({ libraryId, libraryAccessKey }: StoredLibraryBinding) => {
  writeStoredLibraryId(libraryId);
  writeStoredLibraryAccessKey(libraryAccessKey);
};

export const readStoredLibraryBinding = (): StoredLibraryBinding | null => {
  const libraryId = readStoredLibraryId();
  const libraryAccessKey = readStoredLibraryAccessKey();

  if (!libraryId || !libraryAccessKey) {
    return null;
  }

  return {
    libraryId,
    libraryAccessKey,
  };
};

export const hasStoredLibraryBinding = () => Boolean(readStoredLibraryBinding());

export const clearStoredLibraryId = () => {
  removeBrowserStorageItem("local", DEVICE_LIBRARY_STORAGE_KEY);
  removeBrowserStorageItem("local", DEVICE_LIBRARY_ACCESS_KEY_STORAGE_KEY);
};

export const clearStoredLibraryBinding = () => {
  clearStoredLibraryId();
};

export const writeDeviceSetupNotice = (message: string) => {
  const normalized = trimText(message);
  if (!normalized) {
    removeBrowserStorageItem("session", DEVICE_SETUP_NOTICE_STORAGE_KEY);
    return;
  }

  writeBrowserStorageItem("session", DEVICE_SETUP_NOTICE_STORAGE_KEY, normalized);
};

export const consumeDeviceSetupNotice = () => {
  const value = readBrowserStorageItem("session", DEVICE_SETUP_NOTICE_STORAGE_KEY);
  removeBrowserStorageItem("session", DEVICE_SETUP_NOTICE_STORAGE_KEY);
  const normalized = trimText(value);
  return normalized || null;
};

export const buildStudentQrValue = ({
  qrCode,
  studentId,
  libraryId,
  signedToken,
  origin,
  compactSignedToken,
}: {
  qrCode?: string | null;
  studentId?: string | null;
  libraryId?: string | null;
  signedToken?: string | null;
  origin?: string;
  compactSignedToken?: boolean;
}) =>
  buildStudentQrRouteValue({
    origin: getBaseOrigin(origin),
    signedToken,
    studentId,
    libraryId,
    qrCode,
    compactSignedToken,
  });

export const parseStudentQrPayload = async (
  rawValue: string,
  options: StudentQrParseOptions = {},
): Promise<StudentQrPayload | null> => parseSignedStudentQrPayload(rawValue, options);
