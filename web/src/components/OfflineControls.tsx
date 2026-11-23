import { CheckCircleIcon, CloudArrowDownIcon, CircleNotchIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { useT } from "../i18n";
import { cn } from "../lib/format";
import type { Track } from "../lib/types";
import { offlineUi, useOffline } from "../stores/offline";
import { IconButton } from "./IconButton";

/** Compact badge shown on track rows that are saved locally or currently downloading. */
export function OfflineTrackBadge({ trackId }: { trackId: string }) {
  const saved = useOffline((s) => !!s.entries[trackId]);
  const active = useOffline((s) => s.active?.id === trackId);
  const queued = useOffline((s) => s.waiting.some((t) => t.id === trackId));
  const t = useT();

  if (!offlineUi()) return null;
  if (active) {
    return (
      <span title={t.offline.downloadingOne} aria-label={t.offline.downloadingOne} className="inline-flex shrink-0 text-accent-text">
        <CircleNotchIcon size={14} className="animate-spin" />
      </span>
    );
  }
  if (queued) {
    return (
      <span title={t.offline.downloadingOne} aria-label={t.offline.downloadingOne} className="inline-flex shrink-0 text-fg-3">
        <CloudArrowDownIcon size={14} />
      </span>
    );
  }
  if (saved) {
    return (
      <span title={t.offline.downloaded} aria-label={t.offline.downloaded} className="inline-flex shrink-0 text-accent-text">
        <CheckCircleIcon size={14} weight="fill" />
      </span>
    );
  }
  return null;
}

/** Single-track download / remove icon button for PlayerBar and NowPlaying. */
export function OfflineTrackButton({ track, size = "sm" }: { track: Track | null; size?: "sm" | "md" | "lg" }) {
  const t = useT();
  const saved = useOffline((s) => !!track && !!s.entries[track.id]);
  const active = useOffline((s) => !!track && s.active?.id === track.id);
  const queued = useOffline((s) => !!track && s.waiting.some((w) => w.id === track.id));
  const save = useOffline((s) => s.save);
  const remove = useOffline((s) => s.remove);

  if (!offlineUi()) return null;

  const busy = active || queued;
  const label = saved ? t.offline.remove : busy ? t.offline.downloadingOne : t.offline.download;
  const px = size === "lg" ? 23 : 18;

  return (
    <IconButton
      label={label}
      active={saved}
      size={size}
      disabled={!track || busy}
      onClick={() => {
        if (!track) return;
        if (saved) void remove(track.id);
        else void save([track]);
      }}
    >
      {busy ? (
        <CircleNotchIcon size={px} className="animate-spin text-accent-text" />
      ) : saved ? (
        <CheckCircleIcon size={px} weight="fill" />
      ) : (
        <CloudArrowDownIcon size={px} />
      )}
    </IconButton>
  );
}

/** Collection / Album pill button for downloading all tracks in a list for offline playback. */
export function OfflineCollectionButton({ tracks, className }: { tracks: Track[]; className?: string }) {
  const t = useT();
  const entries = useOffline((s) => s.entries);
  const active = useOffline((s) => s.active);
  const waiting = useOffline((s) => s.waiting);
  const save = useOffline((s) => s.save);
  const cancel = useOffline((s) => s.cancel);
  const removeMany = useOffline((s) => s.removeMany);

  if (!offlineUi() || tracks.length === 0) return null;

  const ids = new Set(tracks.map((tr) => tr.id));
  const savedCount = tracks.filter((tr) => !!entries[tr.id]).length;
  const allSaved = savedCount === tracks.length;
  const activeHere = active ? ids.has(active.id) : false;
  const queuedHere = waiting.filter((w) => ids.has(w.id)).length;
  const downloadingHere = activeHere || queuedHere > 0;

  if (downloadingHere) {
    const done = savedCount;
    const total = tracks.length;
    const pct = Math.min(100, Math.round(((done + (activeHere ? active?.progress ?? 0 : 0)) / total) * 100));
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <div className="glass-card relative flex h-11 items-center gap-2.5 overflow-hidden rounded-full px-4 text-sm font-medium">
          <span
            className="pointer-events-none absolute inset-y-0 left-0 bg-accent-soft transition-[width] duration-200"
            style={{ width: `${pct}%` }}
          />
          <CircleNotchIcon size={17} className="relative animate-spin text-accent-text" />
          <span className="relative tabular-nums">{t.offline.downloading(done, total)}</span>
          <button
            type="button"
            onClick={cancel}
            aria-label={t.offline.cancel}
            title={t.offline.cancel}
            className="relative -mr-1 grid size-7 place-items-center rounded-full text-fg-2 hover:bg-surface-3 hover:text-fg"
          >
            <XIcon size={15} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => (allSaved ? void removeMany(tracks.map((tr) => tr.id)) : void save(tracks))}
      className={cn(
        "glass-card flex h-11 items-center gap-2 rounded-full px-4 text-sm font-medium transition-transform active:scale-[0.97]",
        allSaved ? "text-accent-text" : "text-fg",
        className,
      )}
      title={allSaved ? t.offline.removeAll : t.offline.download}
    >
      {allSaved ? (
        <>
          <CheckCircleIcon size={18} weight="fill" />
          <span>{t.offline.downloaded}</span>
        </>
      ) : (
        <>
          <CloudArrowDownIcon size={18} />
          <span>{t.offline.downloadShort}</span>
          {savedCount > 0 && <span className="font-mono text-xs text-fg-3 tabular-nums">{savedCount}/{tracks.length}</span>}
        </>
      )}
    </button>
  );
}

/** Collection-level progress bar displayed under action buttons when downloads are running for that list. */
export function OfflineProgressBanner({ tracks }: { tracks: Track[] }) {
  const t = useT();
  const entries = useOffline((s) => s.entries);
  const active = useOffline((s) => s.active);
  const waiting = useOffline((s) => s.waiting);

  if (!offlineUi() || !tracks.length) return null;
  const ids = new Set(tracks.map((tr) => tr.id));
  const activeHere = active && ids.has(active.id) ? active : null;
  const waitingHere = waiting.filter((w) => ids.has(w.id)).length;
  if (!activeHere && waitingHere === 0) return null;

  const savedHere = tracks.filter((tr) => !!entries[tr.id]).length;
  const trackPct = activeHere ? Math.round(activeHere.progress * 100) : 0;

  return (
    <div className="glass-card mx-4 mb-3 flex flex-col gap-1.5 rounded-[14px] px-3.5 py-2.5 md:mx-6">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="truncate font-medium text-fg">
          {activeHere ? activeHere.title : t.offline.downloadingOne}
        </span>
        <span className="shrink-0 font-mono text-fg-2 tabular-nums">
          {t.offline.savedCount(savedHere, tracks.length)} · {trackPct}%
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-4">
        <div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: `${trackPct}%` }} />
      </div>
    </div>
  );
}

export { TrashIcon };
