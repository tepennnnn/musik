import type { OfflineEntry } from "./apiTypes";
import type { Track } from "./types";

const DB_NAME = "musike-offline";
const DB_VERSION = 1;
const META_STORE = "meta";
const BLOB_STORE = "blobs";
const ARTWORK_CACHE = "artwork";

const objectUrls = new Map<string, string>();
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(BLOB_STORE)) db.createObjectStore(BLOB_STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error("Failed to open offline database"));
    };
  });
  return dbPromise;
}

function reqPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

async function warmArtwork(track: Track) {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(ARTWORK_CACHE);
    const urls = [track.thumb, track.art].filter((u): u is string => !!u && /^https?:\/\//.test(u));
    await Promise.all(
      urls.map(async (u) => {
        if (await cache.match(u)) return;
        const res = await fetch(u, { mode: "no-cors" }).catch(() => null);
        if (res) await cache.put(u, res);
      }),
    );
  } catch {
    /* artwork caching is best-effort */
  }
}

export const offline = {
  supported: typeof indexedDB !== "undefined",

  async load(): Promise<Record<string, OfflineEntry>> {
    if (typeof indexedDB === "undefined") return {};
    const db = await openDb();
    const tx = db.transaction(META_STORE, "readonly");
    const items = await reqPromise<OfflineEntry[]>(tx.objectStore(META_STORE).getAll());
    const entries: Record<string, OfflineEntry> = {};
    for (const item of items) {
      if (item?.id) entries[item.id] = item;
    }
    return entries;
  },

  async save(track: Track, onProgress: (p: number) => void, signal?: AbortSignal): Promise<OfflineEntry> {
    const res = await fetch(`/api/offline/${track.id}/audio`, { signal });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const mime = res.headers.get("content-type") || "audio/mp4";
    const totalHeader = Number(res.headers.get("content-length") || 0);
    const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : 0;

    const reader = res.body.getReader();
    const chunks: BlobPart[] = [];
    let received = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        if (total > 0) onProgress(Math.min(0.98, received / total));
        else onProgress(Math.min(0.95, 1 - Math.exp(-received / 2_500_000)));
      }
    }

    const blob = new Blob(chunks, { type: mime });
    if (blob.size === 0) throw new Error("Downloaded empty audio stream");

    const entry: OfflineEntry = {
      id: track.id,
      track,
      size: blob.size,
      mime,
      savedAt: Date.now(),
    };

    const db = await openDb();
    const tx = db.transaction([META_STORE, BLOB_STORE], "readwrite");
    tx.objectStore(META_STORE).put(entry);
    tx.objectStore(BLOB_STORE).put({ id: track.id, blob });
    await txDone(tx);

    const oldUrl = objectUrls.get(track.id);
    if (oldUrl) {
      URL.revokeObjectURL(oldUrl);
      objectUrls.delete(track.id);
    }

    void warmArtwork(track);
    onProgress(1);
    return entry;
  },

  async remove(id: string): Promise<void> {
    const existing = objectUrls.get(id);
    if (existing) {
      URL.revokeObjectURL(existing);
      objectUrls.delete(id);
    }
    if (typeof indexedDB === "undefined") return;
    const db = await openDb();
    const tx = db.transaction([META_STORE, BLOB_STORE], "readwrite");
    tx.objectStore(META_STORE).delete(id);
    tx.objectStore(BLOB_STORE).delete(id);
    await txDone(tx);
  },

  async clear(): Promise<void> {
    for (const url of objectUrls.values()) URL.revokeObjectURL(url);
    objectUrls.clear();
    if (typeof indexedDB === "undefined") return;
    const db = await openDb();
    const tx = db.transaction([META_STORE, BLOB_STORE], "readwrite");
    tx.objectStore(META_STORE).clear();
    tx.objectStore(BLOB_STORE).clear();
    await txDone(tx);
  },

  async playableUrl(id: string): Promise<string | null> {
    const cached = objectUrls.get(id);
    if (cached) return cached;
    if (typeof indexedDB === "undefined") return null;
    try {
      const db = await openDb();
      const tx = db.transaction(BLOB_STORE, "readonly");
      const record = await reqPromise<{ id: string; blob: Blob } | undefined>(tx.objectStore(BLOB_STORE).get(id));
      if (!record?.blob) return null;
      const url = URL.createObjectURL(record.blob);
      objectUrls.set(id, url);
      return url;
    } catch {
      return null;
    }
  },
};
