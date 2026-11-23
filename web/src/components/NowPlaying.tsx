import {
  CaretDownIcon,
  MagnifyingGlassIcon,
  QueueIcon,
  RadioIcon,
  SparkleIcon,
  VideoCameraSlashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useDragControls, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";
import { cn } from "../lib/format";
import type { Track } from "../lib/types";
import { selectCurrent, usePlayer, useStatusText } from "../player/player";
import { useUi, type PanelTab } from "../stores/ui";
import { Artwork } from "./Artwork";
import { FavoriteButton, ModeSwitch, Scrubber, Transport } from "./Controls";
import { IconButton } from "./IconButton";
import { OfflineTrackButton } from "./OfflineControls";
import { QueueList } from "./Queue";
import { SimilarStylePanel } from "./Recommendations";
import { SLOT, VideoSlot } from "./Video";

/** Artwork or the live video, with a soft ambient glow and diagonal glass reflection from the concept. */
function Stage({ track, slot, className }: { track: Track; slot: number; className?: string }) {
  const t = useT();
  const showsVideo = usePlayer((s) => s.mediaKind === "video");
  const aspect = usePlayer((s) => s.videoAspect);
  // In Video mode on a song: say we're looking for its clip, or that it has none.
  const note = usePlayer((s) =>
    s.preferVideo ? (s.videoNote ?? (s.statusText === "findingClip" ? s.statusText : null)) : null,
  );
  if (showsVideo) {
    const portrait = aspect < 1;
    return (
      <div className="flex justify-center">
        <VideoSlot
          priority={slot}
          expandable
          className={cn("rounded-[18px] ring-1 ring-line-strong", portrait ? "h-[min(52dvh,560px)]" : "w-full")}
          style={{ aspectRatio: Math.min(16 / 9, Math.max(9 / 16, aspect)) }}
        />
      </div>
    );
  }
  return (
    <div className={cn("relative mx-auto aspect-square w-full", className)}>
      <img
        src={track.thumb}
        alt=""
        aria-hidden="true"
        className="absolute inset-[8%] h-[84%] w-[84%] scale-110 rounded-full object-cover opacity-55 blur-3xl"
      />
      <div className="relative size-full overflow-hidden rounded-[20px] ring-1 ring-line-strong shadow-[0_24px_60px_rgb(0_0_0/0.55)]">
        <Artwork
          src={track.art}
          fallback={track.thumb}
          alt={t.nowPlaying.coverOf(track.title)}
          iconSize={48}
          className="size-full"
        />
        <span aria-hidden="true" className="concept-stripes pointer-events-none absolute inset-0 opacity-35" />
      </div>
      {note && (
        <span className="glass-panel absolute inset-x-3 bottom-3 flex items-center justify-center gap-2 rounded-full px-3 py-2 text-center text-[13px] font-medium text-fg">
          {note === "findingClip" ? (
            <MagnifyingGlassIcon size={16} className="shrink-0" />
          ) : (
            <VideoCameraSlashIcon size={16} className="shrink-0" />
          )}{" "}
          {note === "findingClip" ? t.player.status.findingClip : t.player.noClip}
        </span>
      )}
    </div>
  );
}

function TrackHeading({ track, large = false }: { track: Track; large?: boolean }) {
  const statusText = useStatusText();
  const status = usePlayer((s) => s.status);
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <h2 className={cn("truncate font-semibold tracking-tight", large ? "text-[22px] leading-tight" : "text-lg")}>{track.title}</h2>
        <p className={cn("truncate", large ? "text-base" : "text-sm", status === "error" ? "text-danger" : "text-fg-2")}>
          {statusText ?? [track.artist, track.album].filter(Boolean).join(" · ")}
        </p>
      </div>
      <OfflineTrackButton track={track} size={large ? "lg" : "md"} />
      <FavoriteButton track={track} size={large ? "lg" : "md"} />
    </div>
  );
}

function PanelBody({ tab, slot }: { tab: PanelTab; slot: number }) {
  const track = usePlayer(selectCurrent);
  const startRadio = usePlayer((s) => s.startRadio);
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const t = useT();

  if (tab === "queue") return <QueueList />;
  if (!track) {
    return <p className="px-2 py-16 text-center text-sm text-fg-2">{t.nowPlaying.playSomething}</p>;
  }
  const nextUp = queue[index + 1];
  return (
    <div className="flex flex-col gap-5 px-1 pb-4">
      <Stage track={track} slot={slot} />
      <TrackHeading track={track} />
      <ModeSwitch />
      <button
        type="button"
        onClick={() => void startRadio(track)}
        className="glass-card flex h-11 items-center justify-center gap-2 rounded-full text-sm font-medium active:scale-[0.98]"
      >
        <RadioIcon size={18} /> {t.nowPlaying.startRadio}
      </button>
      {nextUp && (
        <div className="glass-card rounded-[16px] p-3">
          <p className="pb-2 text-xs font-medium text-fg-3">{t.nowPlaying.upNext}</p>
          <div className="flex items-center gap-3">
            <Artwork src={nextUp.thumb} className="size-10 rounded-[8px]" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{nextUp.title}</p>
              <p className="truncate text-xs text-fg-2">{nextUp.artist}</p>
            </div>
          </div>
        </div>
      )}
      <SimilarStylePanel track={track} />
    </div>
  );
}

function PanelTabs({ tab, onTab }: { tab: PanelTab; onTab: (t: PanelTab) => void }) {
  const t = useT();
  return (
    <div role="tablist" className="flex gap-1">
      {(
        [
          ["playing", t.nowPlaying.tabPlaying],
          ["queue", t.nowPlaying.tabQueue],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          role="tab"
          type="button"
          aria-selected={tab === id}
          onClick={() => onTab(id)}
          className={cn(
            "h-9 rounded-full px-4 text-sm font-medium transition-colors",
            tab === id ? "bg-surface-4 text-fg" : "text-fg-2 hover:text-fg",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Docked right column (≥1280px). */
export function SidePanel() {
  const tab = useUi((s) => s.panelTab);
  const openPanel = useUi((s) => s.openPanel);
  const togglePanel = useUi((s) => s.togglePanel);
  const t = useT();
  return (
    <aside className="island hidden w-[360px] shrink-0 xl:flex" aria-label={t.nowPlaying.panel}>
      <div className="island-core flex w-full flex-col overflow-hidden">
        <div className="flex h-16 items-center justify-between px-3">
          <PanelTabs tab={tab} onTab={openPanel} />
          <IconButton label={t.nowPlaying.closePanel} size="sm" onClick={() => togglePanel(tab)}>
            <XIcon size={18} />
          </IconButton>
        </div>
        <div className="scroll-area flex-1 overflow-y-auto px-2">
          <PanelBody tab={tab} slot={SLOT.panel} />
        </div>
      </div>
    </aside>
  );
}

/** Same content as an overlay drawer for tablets and small laptops (768-1279px). */
export function PanelDrawer() {
  const open = useUi((s) => s.drawerOpen);
  const tab = useUi((s) => s.panelTab);
  const openPanel = useUi((s) => s.openPanel);
  const close = useUi((s) => s.closePanel);
  const reduce = useReducedMotion();
  const t = useT();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-40 hidden md:block xl:hidden">
          <motion.div className="absolute inset-0 bg-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} />
          <motion.aside
            aria-label={t.nowPlaying.panel}
            data-escape-closes
            initial={reduce ? { opacity: 0 } : { x: "105%" }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { x: "105%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            className="island drawer-top absolute right-2 bottom-2 flex w-[380px] max-w-[calc(100vw-16px)]"
          >
            <div className="island-core flex w-full flex-col overflow-hidden">
              <div className="flex h-16 items-center justify-between px-3">
                <PanelTabs tab={tab} onTab={openPanel} />
                <IconButton label={t.common.close} size="sm" onClick={close}>
                  <XIcon size={18} />
                </IconButton>
              </div>
              <div className="scroll-area flex-1 overflow-y-auto px-2">
                <PanelBody tab={tab} slot={SLOT.panel} />
              </div>
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Full-screen Now Playing for phones. Drag down (or Back) to close. */
export function NowPlayingSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const track = usePlayer(selectCurrent);
  const statusText = useStatusText();
  const status = usePlayer((s) => s.status);
  const reduce = useReducedMotion();
  const drag = useDragControls();
  const [view, setView] = useState<"player" | "queue" | "style">("player");
  const t = useT();

  return createPortal(
    <AnimatePresence onExitComplete={() => setView("player")}>
      {open && track && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={t.nowPlaying.title}
          initial={reduce ? { opacity: 0 } : { y: "100%" }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { y: "100%" }}
          transition={{ type: "spring", stiffness: 380, damping: 36 }}
          drag="y"
          dragListener={false}
          dragControls={drag}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.9 }}
          onDragEnd={(_, info) => {
            if (info.offset.y > 120 || info.velocity.y > 700) onClose();
          }}
          className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-bg/90 backdrop-blur-3xl md:hidden"
        >
          <img
            src={track.thumb}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-3/5 w-full scale-125 object-cover opacity-35 blur-3xl"
          />
          <div className="ambient-canvas opacity-70" aria-hidden="true" />
          <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-bg/20 via-bg/65 to-bg/95" />

          <div className="overlay-top relative flex flex-1 flex-col px-5">
            <div className="flex h-14 touch-none items-center justify-between gap-2" onPointerDown={(e) => drag.start(e)}>
              <IconButton label={t.common.close} onClick={onClose} className="-ml-2 text-fg">
                <CaretDownIcon size={24} />
              </IconButton>
              <ModeSwitch className="scale-90" />
              <div className="-mr-2 flex items-center gap-0.5">
                <IconButton
                  label={t.recommendations.forTrack}
                  active={view === "style"}
                  onClick={() => setView(view === "style" ? "player" : "style")}
                >
                  <SparkleIcon size={20} weight={view === "style" ? "fill" : "regular"} />
                </IconButton>
                <IconButton
                  label={view === "queue" ? t.nowPlaying.backToPlayer : t.nowPlaying.showQueue}
                  active={view === "queue"}
                  onClick={() => setView(view === "queue" ? "player" : "queue")}
                >
                  <QueueIcon size={22} />
                </IconButton>
              </div>
            </div>

            {view === "queue" ? (
              <div className="scroll-area -mx-3 flex-1 overflow-y-auto pb-6">
                <QueueList />
              </div>
            ) : view === "style" ? (
              <div className="scroll-area -mx-1 flex-1 overflow-y-auto pb-6">
                <SimilarStylePanel track={track} compact />
              </div>
            ) : (
              <div className="flex flex-1 flex-col justify-evenly gap-4 pb-[calc(16px+env(safe-area-inset-bottom))]">
                <div className="touch-none" onPointerDown={(e) => drag.start(e)}>
                  <Stage track={track} slot={SLOT.sheet} className="max-w-[min(100%,44dvh)]" />
                </div>
                <div className="flex flex-col gap-5">
                  <div className="flex items-center gap-2">
                    <FavoriteButton track={track} size="lg" />
                    <div className="min-w-0 flex-1 text-center">
                      <h2 className="truncate text-[22px] leading-tight font-bold tracking-tight">{track.title}</h2>
                      <p className={cn("mt-0.5 truncate text-sm", status === "error" ? "text-danger" : "text-fg-2")}>
                        {statusText ?? [track.artist, track.album].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <OfflineTrackButton track={track} size="lg" />
                  </div>
                  <Scrubber touch />
                  <Transport big />
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
