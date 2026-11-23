import {
  ArrowsClockwiseIcon,
  ListPlusIcon,
  MusicNotesIcon,
  PlayIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import { Link } from "react-router";
import { useT } from "../i18n";
import { cn, formatTime } from "../lib/format";
import { paths } from "../lib/routes";
import type { MoodOrGenre, Track } from "../lib/types";
import { usePlayer } from "../player/player";
import { useStyleRecommendations } from "../stores/recommendations";
import { Artwork } from "./Artwork";
import { OfflineTrackBadge } from "./OfflineControls";

export function StyleChip({ item }: { item: MoodOrGenre }) {
  const isMood = item.kind === "mood";
  return (
    <Link
      to={paths.genre(item.id)}
      state={{ name: item.name }}
      className={cn(
        "glass-card inline-flex h-8 shrink-0 items-center gap-2 rounded-full px-3.5 text-xs font-medium transition-transform active:scale-95",
        isMood ? "text-fg" : "text-fg-2 hover:text-fg",
      )}
    >
      <span
        className={cn(
          "size-2 rounded-full",
          isMood ? "bg-fg shadow-[0_0_8px_rgb(255_255_255/0.5)]" : "bg-fg-2",
        )}
      />
      <span>{item.name}</span>
    </Link>
  );
}

/** Compact same-genre, mood style & music style panel inside Now Playing. */
export function SimilarStylePanel({ track, compact = false }: { track: Track; compact?: boolean }) {
  const t = useT();
  const playList = usePlayer((s) => s.playList);
  const addToQueue = usePlayer((s) => s.addToQueue);
  const { data, status, refresh } = useStyleRecommendations([track]);

  const tags: MoodOrGenre[] = [...(data?.moods.slice(0, 3) ?? []), ...(data?.genres.slice(0, 3) ?? [])];
  const tracks = data?.tracks.slice(0, compact ? 10 : 6) ?? [];

  if (status === "idle") return null;

  return (
    <div className="glass-card flex flex-col gap-3 rounded-[16px] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-fg">
          <SparkleIcon size={14} weight="fill" className="text-accent-text" />
          <span>{t.recommendations.forTrack}</span>
        </p>
        <button
          type="button"
          onClick={refresh}
          aria-label={t.recommendations.refresh}
          title={t.recommendations.refresh}
          className="grid size-7 place-items-center rounded-full text-fg-2 transition-colors hover:bg-surface-3 hover:text-fg"
        >
          <ArrowsClockwiseIcon size={14} className={status === "loading" ? "animate-spin" : ""} />
        </button>
      </div>

      {status === "loading" && !data && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-1.5">
            <span className="skeleton h-7 w-20 rounded-full" />
            <span className="skeleton h-7 w-24 rounded-full" />
            <span className="skeleton h-7 w-16 rounded-full" />
          </div>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center gap-2.5 py-1">
              <span className="skeleton size-9 rounded-[8px]" />
              <span className="flex flex-1 flex-col gap-1.5">
                <span className="skeleton h-3 w-3/4 rounded-full" />
                <span className="skeleton h-2.5 w-1/2 rounded-full" />
              </span>
            </div>
          ))}
        </div>
      )}

      {tags.length > 0 && (
        <div className="no-scrollbar flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <StyleChip key={`${tag.kind}-${tag.id}`} item={tag} />
          ))}
        </div>
      )}

      {tracks.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {tracks.map((rec, idx) => (
            <li key={rec.id} className="group flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 transition-colors hover:bg-surface-3">
              <button
                type="button"
                onClick={() => playList(data!.tracks, idx)}
                aria-label={t.common.playX(rec.title)}
                className="relative shrink-0 overflow-hidden rounded-[8px]"
              >
                <Artwork src={rec.thumb} className="size-9 rounded-[8px]" iconSize={16} />
                <span className="absolute inset-0 grid place-items-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
                  <PlayIcon size={14} weight="fill" />
                </span>
              </button>
              <button
                type="button"
                onClick={() => playList(data!.tracks, idx)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-[13px] font-medium text-fg">{rec.title}</span>
                <span className="flex items-center gap-1 truncate text-[11px] text-fg-2">
                  <OfflineTrackBadge trackId={rec.id} />
                  <span className="truncate">{rec.artist || t.common.youtube}</span>
                  {rec.duration > 0 && <span className="shrink-0 font-mono text-fg-3">· {formatTime(rec.duration)}</span>}
                </span>
              </button>
              <button
                type="button"
                onClick={() => addToQueue(rec)}
                aria-label={t.trackMenu.addToQueue}
                title={t.trackMenu.addToQueue}
                className="grid size-7 shrink-0 place-items-center rounded-full text-fg-3 transition-colors hover:bg-surface-4 hover:text-fg"
              >
                <ListPlusIcon size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {status === "error" && !tracks.length && (
        <p className="flex items-center gap-2 py-2 text-xs text-fg-3">
          <MusicNotesIcon size={14} /> {t.recommendations.empty}
        </p>
      )}
    </div>
  );
}
