const DB_NAME = "annotation-file-handles";
const DB_VERSION = 1;
const STORE_NAME = "sceneHandles";
const LOCAL_STORAGE_KEY_PREFIX = "amiri.annotations";
const LOCAL_STORAGE_VERSION = "v1";

function supportsFileAccessApi() {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}

function isObject(value) {
  return typeof value === "object" && value !== null;
}

function canUseLocalStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export class AnnotationPersistence {
  getLocalKey(sceneId) {
    return `${LOCAL_STORAGE_KEY_PREFIX}.${sceneId}.${LOCAL_STORAGE_VERSION}`;
  }

  readLocal(sceneId) {
    if (!canUseLocalStorage()) {
      return null;
    }
    try {
      const raw = window.localStorage.getItem(this.getLocalKey(sceneId));
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (!isObject(parsed) || !isObject(parsed.annotations)) {
        return null;
      }
      return parsed.annotations;
    } catch {
      return null;
    }
  }

  writeLocal(sceneId, annotations) {
    if (!canUseLocalStorage()) {
      return false;
    }
    try {
      const payload = JSON.stringify({
        version: LOCAL_STORAGE_VERSION,
        updatedAt: Date.now(),
        annotations,
      });
      window.localStorage.setItem(this.getLocalKey(sceneId), payload);
      return true;
    } catch {
      return false;
    }
  }

  async load(sceneId) {
    const local = this.readLocal(sceneId);
    if (local) {
      return { annotations: local, source: "local" };
    }

    const legacy = await this.loadLegacyFromHandle(sceneId);
    if (legacy) {
      this.writeLocal(sceneId, legacy);
      return { annotations: legacy, source: "legacy-file" };
    }

    return null;
  }

  async save(sceneId, annotations) {
    const ok = this.writeLocal(sceneId, annotations);
    if (ok) {
      return { ok: true, reason: "Saved locally." };
    }
    return { ok: false, reason: "Unable to save in browser storage." };
  }

  async clearLocal(sceneId) {
    if (!canUseLocalStorage()) {
      return;
    }
    try {
      window.localStorage.removeItem(this.getLocalKey(sceneId));
    } catch {
      // no-op
    }
  }

  async loadLegacyFromHandle(sceneId) {
    if (!supportsFileAccessApi()) {
      return null;
    }

    const handle = await this.getHandle(sceneId);
    if (!handle) {
      return null;
    }

    const permission = handle.queryPermission
      ? await handle.queryPermission({ mode: "read" })
      : "granted";
    if (permission !== "granted") {
      return null;
    }

    try {
      const file = await handle.getFile();
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!isObject(parsed) || !isObject(parsed.annotations)) {
        return null;
      }
      return parsed.annotations;
    } catch {
      return null;
    }
  }

  async exportToFile(sceneId, annotations) {
    if (!supportsFileAccessApi()) {
      return { ok: false, reason: "File System Access API is not available in this browser." };
    }

    let handle = await this.getHandle(sceneId);
    if (!handle) {
      try {
        if (!window.showSaveFilePicker) {
          return { ok: false, reason: "File save picker is unavailable." };
        }
        handle = await window.showSaveFilePicker({
          suggestedName: `${sceneId}.annotations.json`,
          types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
        });
      } catch {
        return { ok: false, reason: "Save cancelled." };
      }

      if (!handle) {
        return { ok: false, reason: "No file handle was selected." };
      }

      await this.putHandle(sceneId, handle);
    }

    const permission = handle.requestPermission
      ? await handle.requestPermission({ mode: "readwrite" })
      : "granted";
    if (permission !== "granted") {
      return { ok: false, reason: "File permission denied." };
    }

    try {
      const writable = await handle.createWritable();
      const payload = JSON.stringify({ annotations }, null, 2);
      await writable.write(payload);
      await writable.close();
      return { ok: true };
    } catch {
      return { ok: false, reason: "Unable to write file." };
    }
  }

  async getHandle(sceneId) {
    const db = await this.openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(sceneId);
      request.onsuccess = () => {
        const value = request.result;
        resolve(value?.handle ?? null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async putHandle(sceneId, handle) {
    const db = await this.openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.put({ sceneId, handle });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async openDb() {
    return await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "sceneId" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}
