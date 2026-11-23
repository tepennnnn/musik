import { Constants } from "youtubei.js";
import type { Lang } from "./i18n.js";
import { text, withClient } from "./search.js";

/**
 * A track's audio asked straight from YouTube's API, without yt-dlp. The Android app plays it this way, and the
 * server falls back to it when yt-dlp fails (YouTube's bot check on some connections, an outdated yt-dlp, HTTP 403).
 *
 * YouTube only serves the first megabyte of a stream to most clients unless the request carries a proof-of-origin
 * token. A few clients don't need one; VISIONOS (the Apple Vision Pro app) is the one yt-dlp itself relies on, and
 * its URLs need no deciphering either. When YouTube changes that, the list of clients can be updated remotely
 * (mobile/streaming.json in the repository) without shipping a new version.
 */

export const DEFAULT_CLIENTS = ["VISIONOS", "ANDROID_VR", "IOS"];
const REMOTE_CONFIG = "https://raw.githubusercontent.com/Ernani1234/musike/main/mobile/streaming.json";

export interface DirectAudio {
  url: string;
  mime: string;
  title: string;
  duration: number;
  /** When the URL stops working (ms). */
  expiresAt: number;
  /** Client headers (such as matching User-Agent) used when proxying from the server. */
  headers?: Record<string, string>;
  client?: string;
}

export const validClients = (v: unknown): string[] | null =>
  Array.isArray(v) && v.length > 0 && v.every((c) => typeof c === "string" && /^[A-Z_]{2,30}$/.test(c)) ? (v as string[]) : null;

/**
 * The client list published in the repository, or null when it can't be read. `clients` is the list for the server
 * and Android; a platform can have its own (`ios`).
 */
export async function fetchRemoteClients(key: "clients" | "ios" = "clients"): Promise<string[] | null> {
  try {
    const res = await fetch(REMOTE_CONFIG, { signal: AbortSignal.timeout(6000) });
    return validClients(((await res.json()) as Record<string, unknown>)[key]);
  } catch {
    return null; // offline or no config: keep what we have
  }
}

function clientHeaders(client: string): Record<string, string> {
  const ua = (Constants.CLIENTS as Record<string, { USER_AGENT?: string }>)[client]?.USER_AGENT;
  return ua ? { "User-Agent": ua } : {};
}

/** Collects playable audio candidates across each client in order (AAC first, highest bitrate within kind). */
export async function directAudioAll(id: string, clients: string[], lang?: Lang): Promise<DirectAudio[]> {
  let reason = "";
  const results: DirectAudio[] = [];
  const seenUrls = new Set<string>();

  for (const client of clients) {
    try {
      const info: any = await withClient((yt) => yt.getBasicInfo(id, { client: client as never }), lang);
      const status = info.playability_status;
      if (status?.status && status.status !== "OK") {
        reason = text(status.reason) || reason;
        continue;
      }
      const formats: any[] = [...(info.streaming_data?.adaptive_formats ?? []), ...(info.streaming_data?.formats ?? [])].filter(
        (f) => f.has_audio && !f.has_video && typeof f.url === "string",
      );
      // AAC (m4a) first: it plays everywhere. Highest bitrate within the same kind.
      formats.sort(
        (a, b) => Number(b.mime_type?.startsWith("audio/mp4")) - Number(a.mime_type?.startsWith("audio/mp4")) || (b.bitrate ?? 0) - (a.bitrate ?? 0),
      );
      const headers = clientHeaders(client);
      const title = info.basic_info?.title ?? "";
      const duration = info.basic_info?.duration ?? 0;
      for (const f of formats) {
        if (seenUrls.has(f.url)) continue;
        seenUrls.add(f.url);
        const expire = Number(new URL(f.url).searchParams.get("expire")) * 1000;
        results.push({
          url: f.url,
          mime: f.mime_type?.startsWith("audio/webm") ? "audio/webm" : "audio/mp4",
          title,
          duration,
          expiresAt: expire || Date.now() + 3 * 3600_000,
          headers,
          client,
        });
      }
    } catch (e) {
      reason = (e as Error).message || reason;
    }
  }
  if (!results.length) throw new Error(reason);
  return results;
}

/** Tries each client in turn. Throws with YouTube's reason (or an empty message) when none of them has audio. */
export async function directAudio(id: string, clients: string[], lang?: Lang): Promise<DirectAudio> {
  const candidates = await directAudioAll(id, clients, lang);
  return candidates[0]!;
}
