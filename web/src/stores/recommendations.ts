import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { api } from "../lib/api";
import type { StyleRecommendations, Track } from "../lib/types";

const CACHE_KEY = "musike:recs-cache";
const memory = new Map<string, StyleRecommendations>();

function readCached(): StyleRecommendations | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StyleRecommendations;
    if (Array.isArray(parsed?.tracks) && Array.isArray(parsed?.genres) && Array.isArray(parsed?.moods)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function writeCached(data: StyleRecommendations) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    /* private mode or quota */
  }
}

export function uniqueSeeds(tracks: (Track | null | undefined)[]): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const t of tracks) {
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
    if (out.length >= 4) break;
  }
  return out;
}

export function useStyleRecommendations(
  seeds: Track[],
  opts: { allowEmpty?: boolean; persist?: boolean } = {},
) {
  const lang = useI18n((s) => s.lang);
  const seedKey = `${lang}|${seeds.map((s) => s.id).join(",")}`;
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<{
    status: "idle" | "loading" | "ok" | "error";
    data: StyleRecommendations | null;
  }>(() => {
    const mem = memory.get(seedKey);
    if (mem) return { status: "ok", data: mem };
    if (opts.persist) {
      const cached = readCached();
      if (cached) return { status: "ok", data: cached };
    }
    return { status: "idle", data: null };
  });

  useEffect(() => {
    if (!seeds.length && !opts.allowEmpty) {
      setState({ status: "idle", data: null });
      return;
    }

    const cachedMem = nonce === 0 ? memory.get(seedKey) : undefined;
    if (cachedMem) {
      setState({ status: "ok", data: cachedMem });
      return;
    }

    if (!navigator.onLine) {
      const fallback = opts.persist ? readCached() : null;
      setState({ status: fallback ? "ok" : "error", data: fallback });
      return;
    }

    const ctrl = new AbortController();
    setState((prev) => ({ status: prev.data ? "ok" : "loading", data: prev.data }));

    api
      .recommendations(seeds, ctrl.signal)
      .then((data) => {
        if (ctrl.signal.aborted) return;
        memory.set(seedKey, data);
        if (opts.persist) writeCached(data);
        setState({ status: "ok", data });
      })
      .catch((err: Error) => {
        if (err.name === "AbortError" || ctrl.signal.aborted) return;
        setState((prev) => ({ status: prev.data ? "ok" : "error", data: prev.data }));
      });

    return () => ctrl.abort();
  }, [seedKey, nonce, opts.allowEmpty, opts.persist]);

  return {
    ...state,
    refresh: () => {
      memory.delete(seedKey);
      setNonce((n) => n + 1);
    },
  };
}
