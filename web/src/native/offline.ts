import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import type { OfflineEntry } from "../lib/apiTypes";
import type { Track } from "../lib/types";
import { resolveAudio } from "./streams";

const DIR = "offline";
const INDEX_PATH = `${DIR}/index.json`;

interface StoredEntry extends OfflineEntry {
  file: string;
}

let indexCache: Record<string, StoredEntry> | null = null;

async function readIndex(): Promise<Record<string, StoredEntry>> {
  if (indexCache) return indexCache;
  try {
    const { data } = await Filesystem.readFile({
      path: INDEX_PATH,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    const parsed = JSON.parse(typeof data === "string" ? data : "") as Record<string, StoredEntry>;
    indexCache = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    indexCache = {};
  }
  return indexCache;
}

async function writeIndex(next: Record<string, StoredEntry>): Promise<void> {
  indexCache = next;
  await Filesystem.mkdir({ path: DIR, directory: Directory.Data, recursive: true }).catch(() => {});
  await Filesystem.writeFile({
    path: INDEX_PATH,
    data: JSON.stringify(next),
    directory: Directory.Data,
    encoding: Encoding.UTF8,
  });
}

function toPublic(entries: Record<string, StoredEntry>): Record<string, OfflineEntry> {
  const out: Record<string, OfflineEntry> = {};
  for (const [k, v] of Object.entries(entries)) {
    out[k] = { id: v.id, track: v.track, size: v.size, mime: v.mime, savedAt: v.savedAt };
  }
  return out;
}

export const offline = {
  supported: Capacitor.isNativePlatform(),

  async load(): Promise<Record<string, OfflineEntry>> {
    return toPublic(await readIndex());
  },

  async save(track: Track, onProgress: (p: number) => void, signal?: AbortSignal): Promise<OfflineEntry> {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const resolved = await resolveAudio(track.id);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const ext = resolved.mime.includes("webm") ? "webm" : "m4a";
    const file = `${DIR}/${track.id}.${ext}`;
    await Filesystem.mkdir({ path: DIR, directory: Directory.Data, recursive: true }).catch(() => {});

    const handle = await Filesystem.addListener("progress", (ev) => {
      if (ev.url === resolved.url && ev.contentLength > 0) {
        onProgress(Math.min(0.98, ev.bytes / ev.contentLength));
      }
    });

    try {
      await Filesystem.downloadFile({
        url: resolved.url,
        path: file,
        directory: Directory.Data,
        progress: true,
      });
      const info = await Filesystem.stat({ path: file, directory: Directory.Data });
      const entry: StoredEntry = {
        id: track.id,
        track,
        file,
        size: info.size,
        mime: resolved.mime,
        savedAt: Date.now(),
      };
      const idx = { ...(await readIndex()), [track.id]: entry };
      await writeIndex(idx);
      onProgress(1);
      return { id: entry.id, track: entry.track, size: entry.size, mime: entry.mime, savedAt: entry.savedAt };
    } catch (err) {
      await Filesystem.deleteFile({ path: file, directory: Directory.Data }).catch(() => {});
      throw err;
    } finally {
      await handle.remove().catch(() => {});
    }
  },

  async remove(id: string): Promise<void> {
    const idx = { ...(await readIndex()) };
    const target = idx[id];
    if (target) {
      await Filesystem.deleteFile({ path: target.file, directory: Directory.Data }).catch(() => {});
      delete idx[id];
      await writeIndex(idx);
    }
  },

  async clear(): Promise<void> {
    const idx = await readIndex();
    await Promise.all(
      Object.values(idx).map((e) => Filesystem.deleteFile({ path: e.file, directory: Directory.Data }).catch(() => {})),
    );
    await writeIndex({});
  },

  async playableUrl(id: string): Promise<string | null> {
    const idx = await readIndex();
    const entry = idx[id];
    if (!entry) return null;
    try {
      const { uri } = await Filesystem.getUri({ path: entry.file, directory: Directory.Data });
      return Capacitor.getPlatform() === "ios" ? uri : Capacitor.convertFileSrc(uri);
    } catch {
      return null;
    }
  },
};
