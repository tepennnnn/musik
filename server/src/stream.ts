import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import type { FastifyReply, FastifyRequest } from "fastify";
import { msg } from "./i18n.js";
import { HttpError } from "./types.js";
import {
  cachedAudio,
  downloadAudio,
  downloadHd,
  invalidate,
  noteStreamFailure,
  recentStreamFailure,
  rememberStream,
  resolveDirectCandidates,
  resolveStreams,
  resolveYtdlpVariant,
  type Resolved,
  type StreamFormat,
} from "./ytdlp.js";

const PASS_HEADERS = ["content-length", "content-range", "accept-ranges", "last-modified"] as const;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

interface UpstreamResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Readable | null;
}

function urlIpFamily(rawUrl: string): 4 | 6 | undefined {
  try {
    const ip = new URL(rawUrl).searchParams.get("ip");
    if (!ip) return undefined;
    if (ip.includes(":")) return 6;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return 4;
  } catch {
    /* ignore malformed URL */
  }
  return undefined;
}

function sanitizeHeaders(extra: Record<string, string>, range: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(extra)) {
    const low = k.toLowerCase();
    if (low === "host" || low === "connection" || low === "content-length" || low === "range") continue;
    out[k] = v;
  }
  if (range) out.Range = range;
  return out;
}

function singleRequest(url: string, headers: Record<string, string>, signal: AbortSignal, family?: 4 | 6): Promise<UpstreamResponse> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new Error("Aborted"));
    const parsed = new URL(url);
    const mod = parsed.protocol === "http:" ? http : https;
    const req = mod.request(
      parsed,
      {
        method: "GET",
        headers,
        signal,
        ...(family ? { family } : {}),
      },
      (res) => {
        const status = res.statusCode ?? 502;
        if (REDIRECT_STATUS.has(status) && res.headers.location) {
          res.resume();
          resolve({ status, headers: res.headers, body: null });
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          resolve({ status, headers: res.headers, body: null });
          return;
        }
        resolve({ status, headers: res.headers, body: res });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function openUpstream(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  family?: 4 | 6,
): Promise<UpstreamResponse> {
  let currentUrl = url;
  let currentFamily = family;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: UpstreamResponse;
    try {
      res = await singleRequest(currentUrl, headers, signal, currentFamily);
    } catch (err) {
      // If pinned family failed at socket/DNS level (e.g. IPv6 disabled locally), retry with default routing.
      if (currentFamily && !signal.aborted) {
        currentFamily = undefined;
        res = await singleRequest(currentUrl, headers, signal, undefined);
      } else {
        throw err;
      }
    }
    if (REDIRECT_STATUS.has(res.status) && typeof res.headers.location === "string") {
      currentUrl = new URL(res.headers.location, currentUrl).toString();
      const nextFamily = urlIpFamily(currentUrl);
      if (nextFamily) currentFamily = nextFamily;
      continue;
    }
    return res;
  }
  return { status: 502, headers: {}, body: null };
}

async function tryFormat(
  fmt: StreamFormat,
  range: string | undefined,
  signal: AbortSignal,
): Promise<{ res: UpstreamResponse; status: number }> {
  const family = urlIpFamily(fmt.url);
  const fullHeaders = sanitizeHeaders(fmt.headers, range);
  let res = await openUpstream(fmt.url, fullHeaders, signal, family);
  if (res.body) return { res, status: res.status };

  // Strip synthetic browser headers (e.g. Chrome UA + Sec-Fetch-Mode) if YouTube rejects the header/TLS pair.
  if ((res.status === 403 || res.status === 410) && Object.keys(fmt.headers).length > 0 && !signal.aborted) {
    const stripped: Record<string, string> = range ? { Range: range } : {};
    const retry = await openUpstream(fmt.url, stripped, signal, family);
    if (retry.body) return { res: retry, status: retry.status };
    res = retry;
  }
  return { res, status: res.status };
}

/**
 * Proxies a googlevideo stream, forwarding Range so the browser can seek natively.
 * googlevideo URLs are bound to the IP that resolved them, so the bytes must flow through this server.
 */
export async function proxyStream(req: FastifyRequest, reply: FastifyReply, id: string, kind: "audio" | "video") {
  const recentErr = recentStreamFailure(id, kind);
  if (recentErr) throw recentErr;

  if (kind === "audio") {
    const cached = await cachedAudio(id);
    if (cached) return serveFile(req, reply, cached.file, cached.mime);
  }

  const controller = new AbortController();
  reply.raw.on("close", () => {
    if (!reply.raw.writableFinished) controller.abort();
  });

  const range = typeof req.headers.range === "string" ? req.headers.range : undefined;
  const triedUrls = new Set<string>();
  let lastStatus = 502;

  const tryCandidates = async (candidates: StreamFormat[], base?: Resolved): Promise<{ fmt: StreamFormat; res: UpstreamResponse } | null> => {
    for (const fmt of candidates) {
      if (controller.signal.aborted) return null;
      if (!fmt.url || triedUrls.has(fmt.url)) continue;
      triedUrls.add(fmt.url);
      try {
        const attempt = await tryFormat(fmt, range, controller.signal);
        lastStatus = attempt.status;
        if (attempt.res.body) {
          rememberStream(id, kind, fmt, base);
          return { fmt, res: attempt.res };
        }
      } catch {
        if (controller.signal.aborted) return null;
      }
    }
    return null;
  };

  try {
    // 1. Initial resolved stream candidates (uses cache when valid).
    const initial = await resolveStreams(id);
    const initialList = kind === "audio" ? initial.audioCandidates : initial.videoCandidates;
    if (!initialList.length && kind === "video") {
      return serveFile(req, reply, await downloadHd(id), "video/mp4");
    }
    let hit = await tryCandidates(initialList, initial);
    const needFallback = () =>
      !hit && !controller.signal.aborted && (!initialList.length || lastStatus === 403 || lastStatus === 410 || lastStatus === 404);

    // 2. Rejected/expired URL: only re-resolve default yt-dlp if our cached result wasn't fetched just now.
    if (needFallback() && (!initial.resolvedAtMs || Date.now() - initial.resolvedAtMs >= 15_000)) {
      invalidate(id);
      const fresh = await resolveStreams(id);
      hit = await tryCandidates(kind === "audio" ? fresh.audioCandidates : fresh.videoCandidates, fresh);
    }

    // 3. Direct InnerTube client fallback for audio (VISIONOS, ANDROID_VR, IOS with matching User-Agent).
    if (needFallback() && kind === "audio") {
      const direct = await resolveDirectCandidates(id).catch(() => null);
      if (direct) hit = await tryCandidates(direct.candidates, direct.resolved);
    }

    // 4. Alternate yt-dlp network/client fallbacks (forced IPv4 + alternate player_client order).
    if (needFallback()) {
      for (const variant of ["ipv4", "alt_clients"] as const) {
        if (controller.signal.aborted) break;
        const alt = await resolveYtdlpVariant(id, variant);
        if (!alt) continue;
        hit = await tryCandidates(kind === "audio" ? alt.audioCandidates : alt.videoCandidates, alt);
        if (hit) break;
      }
    }

    // 5. Final fallback: download via yt-dlp's own HTTP/HLS/curl_cffi stack and serve with Range support.
    if (needFallback()) {
      if (kind === "audio") {
        const local = await downloadAudio(id);
        return serveFile(req, reply, local.file, local.mime);
      }
      return serveFile(req, reply, await downloadHd(id), "video/mp4");
    }

    if (controller.signal.aborted) return;

    if (!hit?.res.body) {
      throw new HttpError(502, msg("streamRefused", { status: lastStatus }), "maybe_outdated");
    }

    const body = hit.res.body;
    const { fmt, res } = hit;
    reply.code(res.status);
    reply.header("content-type", fmt.mime);
    reply.header("cache-control", "no-store");
    for (const h of PASS_HEADERS) {
      const v = res.headers[h];
      if (v) reply.header(h, Array.isArray(v) ? v[0] : v);
    }
    if (!res.headers["accept-ranges"]) reply.header("accept-ranges", "bytes");

    body.on("error", () => body.destroy());
    return reply.send(body);
  } catch (err) {
    if (err instanceof HttpError) noteStreamFailure(id, kind, err);
    throw err;
  }
}

/** Serves a local file with byte-range support (used for cached HD video). */
export async function serveFile(req: FastifyRequest, reply: FastifyReply, file: string, mime: string) {
  const { size } = await stat(file);
  const range = typeof req.headers.range === "string" ? /bytes=(\d*)-(\d*)/.exec(req.headers.range) : null;

  reply.header("content-type", mime);
  reply.header("accept-ranges", "bytes");
  reply.header("cache-control", "no-store");

  if (!range) {
    reply.header("content-length", size);
    return reply.send(createReadStream(file));
  }

  let start = range[1] ? Number(range[1]) : NaN;
  let end = range[2] ? Number(range[2]) : size - 1;
  if (Number.isNaN(start)) {
    // suffix range: bytes=-N
    start = Math.max(0, size - end);
    end = size - 1;
  }
  end = Math.min(end, size - 1);
  if (start > end || start >= size) {
    reply.code(416).header("content-range", `bytes */${size}`);
    return reply.send();
  }

  reply.code(206);
  reply.header("content-range", `bytes ${start}-${end}/${size}`);
  reply.header("content-length", end - start + 1);
  return reply.send(createReadStream(file, { start, end }));
}
