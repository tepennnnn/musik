import { create } from "zustand";
import { getT } from "../i18n";
import { capabilities } from "../lib/api";
import type { OfflineEntry } from "../lib/apiTypes";
import { offline as device } from "../lib/offline";
import type { Track } from "../lib/types";
import { toast } from "./ui";

interface OfflineState {
  ready: boolean;
  entries: Record<string, OfflineEntry>;
  active: { id: string; title: string; progress: number } | null;
  waiting: Track[];
  init: () => Promise<void>;
  save: (tracks: Track[]) => Promise<void>;
  cancel: () => void;
  remove: (id: string) => Promise<void>;
  removeMany: (ids: string[]) => Promise<void>;
  clear: () => Promise<void>;
  isSaved: (id: string) => boolean;
  bytes: () => number;
}

export const offlineUi = () => capabilities.offline && device.supported;

let working = false;
let currentCtrl: AbortController | null = null;

async function pump() {
  if (working) return;
  working = true;
  let saved = 0;
  let failed = 0;
  let lastName = "";
  try {
    for (;;) {
      const next = useOffline.getState().waiting[0];
      if (!next) break;
      const id = next.id;
      const ctrl = new AbortController();
      currentCtrl = ctrl;
      useOffline.setState((s) => ({
        waiting: s.waiting.slice(1),
        active: { id, title: next.title, progress: 0 },
      }));
      try {
        const entry = await device.save(
          next,
          (progress) =>
            useOffline.setState((s) => (s.active?.id === id ? { active: { ...s.active, progress } } : {})),
          ctrl.signal,
        );
        useOffline.setState((s) => ({ entries: { ...s.entries, [id]: entry } }));
        saved += 1;
        lastName = next.title;
      } catch (err) {
        if ((err as Error).name !== "AbortError") failed += 1;
      } finally {
        if (currentCtrl === ctrl) currentCtrl = null;
      }
      useOffline.setState({ active: null });
    }
  } finally {
    working = false;
  }
  const t = getT().offline;
  if (failed) toast(t.failed(failed), "error");
  else if (saved === 1) toast(t.savedOne(lastName));
  else if (saved > 1) toast(t.savedMany(saved));
}

export const useOffline = create<OfflineState>((set, get) => ({
  ready: false,
  entries: {},
  active: null,
  waiting: [],

  init: async () => {
    if (!device.supported) return set({ ready: true });
    try {
      set({ entries: await device.load(), ready: true });
    } catch {
      set({ ready: true });
    }
  },

  save: async (tracks) => {
    if (!device.supported) return;
    const { entries, waiting, active } = get();
    const queued = new Set(waiting.map((t) => t.id));
    if (active) queued.add(active.id);
    const fresh = tracks.filter((t) => !entries[t.id] && !queued.has(t.id));
    if (!fresh.length) return toast(getT().offline.alreadySaved);
    set({ waiting: [...waiting, ...fresh] });
    void pump();
  },

  cancel: () => {
    set({ waiting: [], active: null });
    currentCtrl?.abort();
  },

  remove: async (id) => {
    await device.remove(id);
    set((s) => {
      const entries = { ...s.entries };
      delete entries[id];
      return { entries };
    });
    toast(getT().offline.removed);
  },

  removeMany: async (ids) => {
    await Promise.all(ids.map((id) => device.remove(id).catch(() => {})));
    set((s) => {
      const entries = { ...s.entries };
      for (const id of ids) delete entries[id];
      return { entries };
    });
    toast(getT().offline.removedAll);
  },

  clear: async () => {
    get().cancel();
    await device.clear();
    set({ entries: {}, waiting: [] });
    toast(getT().offline.removedAll);
  },

  isSaved: (id) => get().entries[id] !== undefined,

  bytes: () => Object.values(get().entries).reduce((sum, e) => sum + (e.size || 0), 0),
}));
