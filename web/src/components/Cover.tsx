import { ClockCounterClockwiseIcon, CloudArrowDownIcon, HeartIcon } from "@phosphor-icons/react";
import { cn } from "../lib/format";
import type { Track } from "../lib/types";
import { Artwork } from "./Artwork";

export type CoverKind = "playlist" | "favorites" | "history" | "offline";

/** Playlist cover: a 2x2 mosaic from the first distinct covers, or a single cover / monochrome glass tile. */
export function Cover({ kind, tracks, className, iconSize = 40 }: { kind: CoverKind; tracks: Track[]; className?: string; iconSize?: number }) {
  if (kind === "favorites") {
    return (
      <span className={cn("mono-grad-platinum grid place-items-center text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]", className)}>
        <HeartIcon size={iconSize} weight="fill" />
      </span>
    );
  }
  if (kind === "offline") {
    return (
      <span className={cn("mono-grad-slate grid place-items-center text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.28)]", className)}>
        <CloudArrowDownIcon size={iconSize} weight="fill" />
      </span>
    );
  }
  if (kind === "history") {
    return (
      <span className={cn("mono-grad-obsidian grid place-items-center text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.22)]", className)}>
        <ClockCounterClockwiseIcon size={iconSize} />
      </span>
    );
  }
  const arts = [...new Map(tracks.map((t) => [t.thumb, t])).values()].slice(0, 4);
  if (arts.length < 4) {
    return <Artwork src={arts[0]?.art} fallback={arts[0]?.thumb} className={className} iconSize={iconSize} />;
  }
  return (
    <span className={cn("grid grid-cols-2 grid-rows-2 overflow-hidden", className)}>
      {arts.map((t) => (
        <Artwork key={t.id} src={t.thumb} className="size-full" />
      ))}
    </span>
  );
}
