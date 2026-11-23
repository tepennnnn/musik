import { cn } from "../lib/format";

/** The Musik mark: three equalizer bars forming an M. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <g fill="currentColor">
        <rect x="10" y="10" width="8" height="28" rx="4" />
        <rect x="20" y="10" width="8" height="16" rx="4" />
        <rect x="30" y="10" width="8" height="28" rx="4" />
      </g>
    </svg>
  );
}

/** Two-tone Musik wordmark inspired by MusicLogo in the design concept. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="concept-grad-pink grid size-7 place-items-center rounded-[9px] text-white shadow-[0_6px_18px_rgb(255_30_108/0.38)]">
        <LogoMark className="size-4.5" />
      </span>
      <span className="text-[19px] font-bold tracking-tight">
        <span className="text-accent-text">Mus</span>
        <span className="text-fg">ik</span>
      </span>
    </span>
  );
}

/** The mark in motion: marks the track that is playing. */
export function Equalizer({ live, className }: { live: boolean; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex h-3.5 items-end gap-[2px]", live && "eq-live", className)}>
      <span className="eq-bar h-full w-[3px] rounded-full bg-accent-text" />
      <span className="eq-bar h-full w-[3px] rounded-full bg-accent-text" />
      <span className="eq-bar h-full w-[3px] rounded-full bg-accent-text" />
    </span>
  );
}
