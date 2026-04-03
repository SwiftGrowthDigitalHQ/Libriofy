type StorageKind = "local" | "session";

const createMemoryStorage = (): Storage => {
  const entries = new Map<string, string>();

  return {
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    getItem(key: string) {
      return entries.has(key) ? entries.get(key) ?? null : null;
    },
    key(index: number) {
      return Array.from(entries.keys())[index] ?? null;
    },
    removeItem(key: string) {
      entries.delete(key);
    },
    setItem(key: string, value: string) {
      entries.set(key, value);
    },
  } as Storage;
};

const getBrowserStorage = (kind: StorageKind): Storage | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
};

export const createSafeBrowserStorage = (kind: StorageKind): Storage => {
  const memoryStorage = createMemoryStorage();

  return {
    get length() {
      const storage = getBrowserStorage(kind);
      if (!storage) {
        return memoryStorage.length;
      }

      try {
        return storage.length;
      } catch {
        return memoryStorage.length;
      }
    },
    clear() {
      const storage = getBrowserStorage(kind);

      try {
        storage?.clear();
      } catch {
        // Ignore storage failures and fall back to the in-memory copy.
      }

      memoryStorage.clear();
    },
    getItem(key: string) {
      const storage = getBrowserStorage(kind);

      try {
        return storage?.getItem(key) ?? memoryStorage.getItem(key);
      } catch {
        return memoryStorage.getItem(key);
      }
    },
    key(index: number) {
      const storage = getBrowserStorage(kind);

      try {
        return storage?.key(index) ?? memoryStorage.key(index);
      } catch {
        return memoryStorage.key(index);
      }
    },
    removeItem(key: string) {
      const storage = getBrowserStorage(kind);

      try {
        storage?.removeItem(key);
      } catch {
        // Ignore storage failures and fall back to the in-memory copy.
      }

      memoryStorage.removeItem(key);
    },
    setItem(key: string, value: string) {
      const storage = getBrowserStorage(kind);

      try {
        storage?.setItem(key, value);
        return;
      } catch {
        // Ignore storage failures and fall back to the in-memory copy.
      }

      memoryStorage.setItem(key, value);
    },
  } as Storage;
};

export const readBrowserStorageItem = (kind: StorageKind, key: string) => {
  const storage = getBrowserStorage(kind);
  if (!storage) {
    return null;
  }

  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

export const writeBrowserStorageItem = (kind: StorageKind, key: string, value: string | null) => {
  const storage = getBrowserStorage(kind);
  if (!storage) {
    return;
  }

  try {
    if (value === null) {
      storage.removeItem(key);
      return;
    }

    storage.setItem(key, value);
  } catch {
    // Ignore storage failures.
  }
};

export const removeBrowserStorageItem = (kind: StorageKind, key: string) => {
  const storage = getBrowserStorage(kind);
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
};
