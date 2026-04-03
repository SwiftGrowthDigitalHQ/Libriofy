import {
  readBrowserStorageItem,
  removeBrowserStorageItem,
  writeBrowserStorageItem,
} from "@/lib/browserStorage";

export type OfflineQueueFeature = "attendance";

export interface OfflineQueueEntry<TPayload = unknown> {
  id: string;
  feature: OfflineQueueFeature;
  action: string;
  payload: TPayload;
  createdAt: string;
  retries: number;
}

const STORAGE_KEY = "libriofy:offline-queue";

const isBrowser = () => typeof window !== "undefined";

const readQueue = (): OfflineQueueEntry[] => {
  if (!isBrowser()) return [];

  try {
    const rawQueue = readBrowserStorageItem("local", STORAGE_KEY);
    if (!rawQueue) return [];

    const parsedQueue = JSON.parse(rawQueue);
    return Array.isArray(parsedQueue) ? parsedQueue : [];
  } catch {
    return [];
  }
};

const writeQueue = (entries: OfflineQueueEntry[]) => {
  if (!isBrowser()) return;
  writeBrowserStorageItem("local", STORAGE_KEY, JSON.stringify(entries));
};

export const createOfflineQueueEntry = <TPayload,>(
  feature: OfflineQueueFeature,
  action: string,
  payload: TPayload,
): OfflineQueueEntry<TPayload> => ({
  id: `${feature}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  feature,
  action,
  payload,
  createdAt: new Date().toISOString(),
  retries: 0,
});

export const offlineMutationQueue = {
  all: readQueue,
  enqueue: <TPayload,>(entry: OfflineQueueEntry<TPayload>) => {
    const queue = readQueue();
    writeQueue([...queue, entry]);
    return entry;
  },
  remove: (entryId: string) => {
    writeQueue(readQueue().filter((entry) => entry.id !== entryId));
  },
  replace: (entries: OfflineQueueEntry[]) => {
    writeQueue(entries);
  },
  clear: () => {
    if (!isBrowser()) return;
    removeBrowserStorageItem("local", STORAGE_KEY);
  },
};
