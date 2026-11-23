import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";
import { ensureComponent } from "./bootstrap.js";
import { config } from "./config.js";
import { DEFAULT_CLIENTS, directAudioAll, fetchRemoteClients } from "./directAudio.js";
import { tools } from "./tools.js";
import { msg, type Msg } from "./i18n.js";
import { HttpError } from "./types.js";

export interface StreamFormat {
  formatId: string;
  url: string;
  headers: Record<string, string>;
  mime: string;
}

export interface Resolved {
  id: string;
  title: string;
  duration: number;
  audio: StreamFormat;
  audioCandidates: StreamFormat[];
  video?: StreamFormat;
  videoCandidates: StreamFormat[];
  expiresAt: number;
  resolvedAtMs?: number;
}

interface RawFormat {
  format_id: string;
  url?: string;
  ext: string;
  acodec?: string;
  vcodec?: string;
  height?: number;
  abr?: number;
  protocol?: string;
  http_headers?: Record<string, string>;
}

const RESOLVE_TIMEOUT_MS = 45_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const AUDIO_EXTS = new Set(["m4a", "mp4", "webm", "opus", "ogg"]);

let maintenance: Promise<unknown> | null = null;

/** While yt-dlp is being updated or installed, new runs wait instead of racing the executable swap. */
export function holdDuring<T>(job: Promise<T>): Promise<T> {
  const p = job.finally(() => {
    if (maintenance === p) maintenance = null;
  });
  maintenance = p;
  return p;
}

function runtimeArgs(): string[] {
  const { deno } = tools();
  const hasJsRuntime = config.ytdlpExtraArgs.some((a) => a === "--js-runtimes" || a.startsWith("--js-runtimes="));
  return deno && !hasJsRuntime ? ["--js-runtimes", `deno:${deno}`] : [];
}

async function run(args: string[], timeoutMs: number): Promise<string> {
  if (maintenance) await maintenance.catch(() => {});
  const { ytdlp, env } = tools();
  if (!ytdlp) {
    throw new HttpError(503, msg("ytdlpMissing"), "tool_missing");
  }
  return new Promise((resolve, reject) => {
    const fullArgs = [...runtimeArgs(), ...config.ytdlpExtraArgs, ...args];
    const child = spawn(ytdlp, fullArgs, { windowsHide: true, env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new HttpError(504, msg("ytdlpTimeout")));
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new HttpError(503, msg("ytdlpCantRun", { error: err.message }), "tool_missing"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(stdout);
      reject(toHttpError(stderr));
    });
  });
}

// Failures that usually mean YouTube changed and yt-dlp needs an update.
const OUTDATED = /nsig|signature|n challenge|JavaScript runtime|Unable to extract|Failed to extract|player response|Requested format is not available|HTTP Error 403/i;

function toHttpError(stderr: string): HttpError {
  const line = stderr.split("\n").find((l) => l.includes("ERROR")) ?? stderr.trim().split("\n").pop() ?? "";
  if (/confirm you.re not a bot|Sign in to confirm/i.test(line)) {
    return new HttpError(503, msg("botCheck"), "bot_check");
  }
  if (/Video unavailable|video is unavailable|Private video|removed/i.test(line)) {
    return new HttpError(404, msg("videoUnavailable"));
  }
  if (/age-restricted|inappropriate|confirm your age/i.test(line)) {
    return new HttpError(403, msg("ageRestricted"));
  }
  // yt-dlp's own words stay as they are (English); only the advice around them is translated.
  const detail = line.replace(/^ERROR:\s*/, "").slice(0, 240);
  if (!detail) return new HttpError(502, msg("ytdlpFailed"), "maybe_outdated");
  if (OUTDATED.test(stderr)) return new HttpError(502, msg("ytdlpOutdated", { detail }), "maybe_outdated");
  return new HttpError(502, detail, "maybe_outdated");
}

/** Forget resolved stream URLs, e.g. after updating yt-dlp so the next play uses the new version. */
export function clearResolved() {
  resolvedAt.clear();
  failedAt.clear();
}

const isAudioOnly = (f: RawFormat) => !!f.url && f.vcodec === "none" && !!f.acodec && f.acodec !== "none";
const isMuxed = (f: RawFormat) => !!f.url && !!f.vcodec && f.vcodec !== "none" && !!f.acodec && f.acodec !== "none";
const isHttps = (f: RawFormat) => !f.protocol || f.protocol === "https";

function toStream(f: RawFormat, kind: "audio" | "video"): StreamFormat {
  const mime =
    kind === "audio"
      ? f.ext === "webm" || f.ext === "opus"
        ? "audio/webm"
        : "audio/mp4"
      : "video/mp4";
  return { formatId: f.format_id, url: f.url!, headers: f.http_headers ?? {}, mime };
}

function dedupeStreams(list: StreamFormat[]): StreamFormat[] {
  const seen = new Set<string>();
  const out: StreamFormat[] = [];
  for (const item of list) {
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out;
}

function pickAudioCandidates(formats: RawFormat[]): StreamFormat[] {
  const audio = formats.filter((f) => isAudioOnly(f) && isHttps(f));
  const f140 = audio.filter((f) => f.format_id === "140");
  const m4a = audio.filter((f) => f.ext === "m4a" && f.format_id !== "140").sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0));
  const webm = audio.filter((f) => f.ext === "webm" || f.ext === "opus").sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0));
  const otherAudio = audio.filter((f) => f.ext !== "m4a" && f.ext !== "webm" && f.ext !== "opus").sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0));
  // Combined mp4 (18) as a final direct-URL audio fallback when audio-only URLs return 403.
  const muxed = formats.filter((f) => isMuxed(f) && isHttps(f) && f.ext === "mp4").sort((a, b) => (b.format_id === "18" ? 1 : 0) - (a.format_id === "18" ? 1 : 0) || (b.height ?? 0) - (a.height ?? 0));
  return dedupeStreams([
    ...[...f140, ...m4a, ...webm, ...otherAudio].map((f) => toStream(f, "audio")),
    ...muxed.map((f) => toStream(f, "video")),
  ]);
}

function pickVideoCandidates(formats: RawFormat[]): StreamFormat[] {
  const muxed = formats.filter((f) => isMuxed(f) && isHttps(f) && f.ext === "mp4");
  const f18 = muxed.filter((f) => f.format_id === "18");
  const rest = muxed.filter((f) => f.format_id !== "18").sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  return dedupeStreams([...f18, ...rest].map((f) => toStream(f, "video")));
}

function expiryOf(url: string): number {
  try {
    const expire = Number(new URL(url).searchParams.get("expire"));
    // Refresh 10 minutes before googlevideo URLs expire.
    if (Number.isFinite(expire) && expire > 0) return expire * 1000 - 10 * 60_000;
  } catch {
    /* ignore malformed URL */
  }
  return Date.now() + 4 * 3600_000;
}

const cache = new Map<string, Promise<Resolved>>();
const resolvedAt = new Map<string, Resolved>();
const failedAt = new Map<string, { at: number; error: HttpError }>();

// When yt-dlp fails, the clients to ask YouTube directly (see directAudio.ts), refreshed from the repository.
// Read lazily: directAudio.ts and this module import each other through search.ts.
let directClients: string[] | null = null;
let directClientsAt = 0;

async function clientsForDirect(): Promise<string[]> {
  if (Date.now() - directClientsAt > 6 * 3600_000) {
    directClientsAt = Date.now();
    directClients = (await fetchRemoteClients()) ?? directClients;
  }
  return [...new Set([...(directClients ?? []), ...DEFAULT_CLIENTS])];
}

function parseYtdlpInfo(id: string, stdout: string): Resolved {
  const info = JSON.parse(stdout) as { title: string; duration?: number; formats: RawFormat[] };
  const audioCandidates = pickAudioCandidates(info.formats ?? []);
  if (!audioCandidates.length) throw new HttpError(404, msg("noAudio"));
  const videoCandidates = pickVideoCandidates(info.formats ?? []);
  return {
    id,
    title: info.title,
    duration: info.duration ?? 0,
    audio: audioCandidates[0]!,
    audioCandidates,
    video: videoCandidates[0],
    videoCandidates,
    expiresAt: expiryOf(audioCandidates[0]!.url),
    resolvedAtMs: Date.now(),
  };
}

/**
 * Plan B for audio: YouTube's bot check stops yt-dlp on some connections (VPNs, shared networks), and a YouTube
 * change can break it until it's updated. Asking YouTube for the audio directly often still works.
 */
export async function resolveDirectCandidates(id: string): Promise<{ resolved: Resolved; candidates: StreamFormat[] }> {
  const list = await directAudioAll(id, await clientsForDirect());
  const candidates: StreamFormat[] = list.map((d) => ({
    formatId: d.client ? `direct:${d.client}` : "direct",
    url: d.url,
    headers: d.headers ?? {},
    mime: d.mime,
  }));
  const first = list[0]!;
  return {
    resolved: {
      id,
      title: first.title,
      duration: first.duration,
      audio: candidates[0]!,
      audioCandidates: candidates,
      videoCandidates: [],
      expiresAt: first.expiresAt - 10 * 60_000,
      resolvedAtMs: Date.now(),
    },
    candidates,
  };
}

async function resolveDirect(id: string, ytdlpError: unknown): Promise<Resolved> {
  // Removed, private or age-restricted videos won't play any other way either.
  if (
    ytdlpError instanceof HttpError &&
    (ytdlpError.status === 403 || (ytdlpError.status === 404 && (ytdlpError.text as Msg)?.key === "videoUnavailable"))
  ) {
    throw ytdlpError;
  }
  try {
    const { resolved } = await resolveDirectCandidates(id);
    return resolved;
  } catch {
    throw ytdlpError; // yt-dlp's error says more, and may offer the update
  }
}

export function resolveStreams(id: string): Promise<Resolved> {
  const done = resolvedAt.get(id);
  if (done && done.expiresAt > Date.now()) return Promise.resolve(done);
  const inflight = cache.get(id);
  if (inflight) return inflight;

  const job = run(["-J", "--no-playlist", "--no-warnings", `https://www.youtube.com/watch?v=${id}`], RESOLVE_TIMEOUT_MS)
    .then((stdout) => parseYtdlpInfo(id, stdout))
    .catch((err) => resolveDirect(id, err))
    .then((resolved) => {
      resolvedAt.set(id, resolved);
      return resolved;
    })
    .finally(() => cache.delete(id));

  cache.set(id, job);
  return job;
}

/** Re-resolves streams via an alternate yt-dlp network/client strategy when the default stream returns HTTP 403. */
export async function resolveYtdlpVariant(id: string, variant: "ipv4" | "alt_clients"): Promise<Resolved | null> {
  const url = `https://www.youtube.com/watch?v=${id}`;
  const args =
    variant === "ipv4"
      ? ["-4", "-J", "--no-playlist", "--no-warnings", url]
      : ["-J", "--no-playlist", "--no-warnings", "--extractor-args", "youtube:player_client=android_vr,web_safari,visionos,mweb,tv_simply", url];
  try {
    const stdout = await run(args, RESOLVE_TIMEOUT_MS);
    return parseYtdlpInfo(id, stdout);
  } catch {
    return null;
  }
}

/** Promotes a verified working format in cache so subsequent Range seeks succeed immediately. */
export function rememberStream(id: string, kind: "audio" | "video", working: StreamFormat, base?: Resolved) {
  failedAt.delete(`${id}:${kind}`);
  const existing = resolvedAt.get(id) ?? base;
  if (!existing) return;
  if (kind === "audio") {
    const merged = dedupeStreams([working, ...existing.audioCandidates]);
    resolvedAt.set(id, { ...existing, audio: working, audioCandidates: merged, expiresAt: expiryOf(working.url) });
  } else {
    const merged = dedupeStreams([working, ...existing.videoCandidates]);
    resolvedAt.set(id, { ...existing, video: working, videoCandidates: merged, expiresAt: expiryOf(working.url) });
  }
}

export function recentStreamFailure(id: string, kind: "audio" | "video"): HttpError | null {
  const hit = failedAt.get(`${id}:${kind}`);
  if (!hit) return null;
  if (Date.now() - hit.at > 4_000) {
    failedAt.delete(`${id}:${kind}`);
    return null;
  }
  return hit.error;
}

export function noteStreamFailure(id: string, kind: "audio" | "video", error: HttpError) {
  failedAt.set(`${id}:${kind}`, { at: Date.now(), error });
}

export function invalidate(id: string) {
  resolvedAt.delete(id);
}

const downloads = new Map<string, Promise<string>>();
const audioDownloads = new Map<string, Promise<{ file: string; mime: string }>>();

const isCacheFile = (name: string) => name.endsWith(".720.mp4") || /^[^.]+\.audio\.[a-z0-9]+$/i.test(name);

/** Keeps the media cache under `config.cacheMaxBytes`, evicting least recently played files first. */
export async function pruneCache(): Promise<void> {
  if (!existsSync(config.cacheDir)) return;
  const names = (await readdir(config.cacheDir)).filter(isCacheFile);
  const files = await Promise.all(
    names.map(async (n) => {
      const p = path.join(config.cacheDir, n);
      const s = await stat(p);
      return { p, size: s.size, used: s.mtimeMs };
    }),
  );
  let total = files.reduce((sum, f) => sum + f.size, 0);
  for (const f of files.sort((a, b) => a.used - b.used)) {
    if (total <= config.cacheMaxBytes) break;
    await rm(f.p, { force: true });
    total -= f.size;
  }
}

function mimeForExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === "webm" || e === "opus" || e === "ogg") return "audio/webm";
  return "audio/mp4";
}

export async function cachedAudio(id: string): Promise<{ file: string; mime: string } | null> {
  if (!existsSync(config.cacheDir)) return null;
  for (const ext of AUDIO_EXTS) {
    const file = path.join(config.cacheDir, `${id}.audio.${ext}`);
    if (existsSync(file)) {
      const now = new Date();
      utimes(file, now, now).catch(() => {});
      return { file, mime: mimeForExt(ext) };
    }
  }
  return null;
}

/**
 * Fallback audio download via yt-dlp when direct HTTP proxy fetches return 403 (e.g. HLS-only formats,
 * IPv6/IPv4 mismatch, or CDN checks that require yt-dlp's HTTP stack). Served via serveFile with Range support.
 */
export async function downloadAudio(id: string): Promise<{ file: string; mime: string }> {
  const cached = await cachedAudio(id);
  if (cached) return cached;
  const inflight = audioDownloads.get(id);
  if (inflight) return inflight;

  const partPrefix = `${id}.audio.part.`;
  const cleanParts = async () => {
    if (!existsSync(config.cacheDir)) return;
    const leftover = (await readdir(config.cacheDir)).filter((n) => n.startsWith(partPrefix));
    await Promise.all(leftover.map((n) => rm(path.join(config.cacheDir, n), { force: true })));
  };

  const baseArgs = [
    "--no-playlist",
    "--no-warnings",
    "--no-part",
    "-N", "4",
    "--retries", "1",
    "--fragment-retries", "1",
    "--extractor-retries", "1",
    "--socket-timeout", "15",
    "-f", "ba[ext=m4a]/ba[protocol^=m3u8]/ba/18/b",
    "-o", path.join(config.cacheDir, `${id}.audio.part.%(ext)s`),
    `https://www.youtube.com/watch?v=${id}`,
  ];

  const job = mkdir(config.cacheDir, { recursive: true })
    .then(cleanParts)
    .then(() =>
      run(baseArgs, DOWNLOAD_TIMEOUT_MS).catch(async (firstErr) => {
        await cleanParts();
        // Dual-stack IPv6/IPv4 on Windows can fail IPv6 fragments while -4 succeeds cleanly.
        if (firstErr instanceof HttpError && (firstErr.status === 403 || firstErr.status === 404)) throw firstErr;
        return run(["-4", ...baseArgs], DOWNLOAD_TIMEOUT_MS);
      }),
    )
    .then(async () => {
      const names = await readdir(config.cacheDir);
      const written = names.find((n) => n.startsWith(partPrefix) && AUDIO_EXTS.has(path.extname(n).slice(1).toLowerCase()))
        ?? names.find((n) => n.startsWith(partPrefix));
      if (!written) throw new HttpError(502, msg("ytdlpFailed"), "maybe_outdated");
      const src = path.join(config.cacheDir, written);
      const ext = path.extname(written).slice(1).toLowerCase() || "m4a";
      const file = path.join(config.cacheDir, `${id}.audio.${ext}`);
      await rename(src, file);
      pruneCache().catch(() => {});
      return { file, mime: mimeForExt(ext) };
    })
    .catch(async (err) => {
      await cleanParts();
      throw err;
    })
    .finally(() => audioDownloads.delete(id));

  audioDownloads.set(id, job);
  return job;
}

/** Downloads and merges a 720p H.264 + AAC MP4 into the cache, for HD video playback with seeking. */
export function downloadHd(id: string): Promise<string> {
  const file = path.join(config.cacheDir, `${id}.720.mp4`);
  if (existsSync(file)) {
    // Mark as recently used for cache eviction.
    const now = new Date();
    utimes(file, now, now).catch(() => {});
    return Promise.resolve(file);
  }
  const inflight = downloads.get(id);
  if (inflight) return inflight;

  const tmp = path.join(config.cacheDir, `${id}.720.part.mp4`);
  // Merging video + audio needs FFmpeg; the desktop app fetches it on first use if it isn't there yet.
  const job = (tools().ffmpeg || !config.binDir ? Promise.resolve() : ensureComponent("ffmpeg"))
    .then(() => mkdir(config.cacheDir, { recursive: true }))
    .then(() =>
      run(
        [
          "--no-playlist",
          "--no-warnings",
          "--no-part",
          "-N", "4",
          "-f", "bv*[height<=720][vcodec^=avc1]+ba[ext=m4a]/b[ext=mp4][height<=720]/bv*[height<=720]+ba",
          "--merge-output-format", "mp4",
          "-o", tmp,
          `https://www.youtube.com/watch?v=${id}`,
        ],
        DOWNLOAD_TIMEOUT_MS,
      ),
    )
    .then(async () => {
      await rename(tmp, file);
      pruneCache().catch(() => {});
      return file;
    })
    .catch(async (err) => {
      await rm(tmp, { force: true });
      throw err;
    })
    .finally(() => downloads.delete(id));

  downloads.set(id, job);
  return job;
}

export async function ytdlpSearch(query: string, limit = 20) {
  const stdout = await run(["-J", "--flat-playlist", "--no-warnings", `ytsearch${limit}:${query}`], RESOLVE_TIMEOUT_MS);
  const data = JSON.parse(stdout) as {
    entries: { id: string; title: string; duration?: number; channel?: string; uploader?: string }[];
  };
  return data.entries ?? [];
}
