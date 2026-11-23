import {
  ClockCounterClockwiseIcon,
  CloudArrowDownIcon,
  HeartIcon,
  MagnifyingGlassIcon,
  PlayIcon,
  UserIcon,
} from "@phosphor-icons/react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { Artwork } from "../components/Artwork";
import { LogoMark } from "../components/Brand";
import { PageHeader, Section } from "../components/Page";
import { TrackList, TrackListSkeleton } from "../components/TrackList";
import { useT } from "../i18n";
import { cn, formatBytes } from "../lib/format";
import { paths } from "../lib/routes";
import type { Track } from "../lib/types";
import { usePlayer } from "../player/player";
import { useAppearance } from "../stores/appearance";
import { useLibrary } from "../stores/library";
import { offlineUi, useOffline } from "../stores/offline";

const EXPLORER_VIBES = [
  { label: "Synthwave", grad: "concept-grad-pink", query: "synthwave electronic" },
  { label: "Indie Night", grad: "concept-grad-violet", query: "indie alternative" },
  { label: "Lo-Fi Chill", grad: "concept-grad-cyan", query: "lofi chill beats" },
  { label: "Acoustic", grad: "concept-grad-mix", query: "acoustic hits" },
] as const;

const RING_GRADS = ["concept-grad-pink", "concept-grad-cyan", "concept-grad-violet"] as const;

function ExplorerCard({
  to,
  title,
  sub,
  gradient,
  art,
  tracks,
  icon,
}: {
  to: string;
  title: string;
  sub?: string;
  gradient: string;
  art?: string;
  tracks?: Track[];
  icon?: ReactNode;
}) {
  const playList = usePlayer((s) => s.playList);
  const t = useT();
  return (
    <div className="group relative flex w-36 shrink-0 snap-start flex-col gap-2 md:w-44">
      <div className="relative aspect-square w-full overflow-hidden rounded-[18px] ring-1 ring-line-strong shadow-[0_14px_34px_rgb(4_3_18/0.45)] transition-transform duration-300 ease-out-expo group-hover:scale-[1.02]">
        <Link to={to} aria-label={title} className="absolute inset-0 z-0">
          {art ? (
            <>
              <Artwork src={art} className="size-full" />
              <span aria-hidden="true" className={cn("absolute inset-0 opacity-45 mix-blend-multiply", gradient)} />
              <span aria-hidden="true" className="concept-stripes pointer-events-none absolute inset-0 opacity-45" />
            </>
          ) : (
            <span className={cn("relative grid size-full place-items-center text-white", gradient)}>
              <span aria-hidden="true" className="concept-stripes pointer-events-none absolute inset-0 opacity-60" />
              <span className="relative opacity-25">{icon}</span>
            </span>
          )}
        </Link>
        <button
          type="button"
          onClick={() => (tracks && tracks.length > 0 ? playList(tracks, 0) : undefined)}
          aria-label={t.common.playX(title)}
          className={cn(
            "pointer-events-auto absolute inset-0 m-auto grid size-12 place-items-center rounded-full bg-white/25 text-white backdrop-blur-md ring-1 ring-white/40 shadow-[0_8px_24px_rgb(0_0_0/0.3)] transition-transform duration-200 ease-out-expo hover:scale-110 active:scale-95",
            !(tracks && tracks.length > 0) && "pointer-events-none",
          )}
        >
          <PlayIcon size={22} weight="fill" className="translate-x-0.5 drop-shadow" />
        </button>
      </div>
      <Link to={to} className="min-w-0 px-0.5">
        <span className="block truncate text-sm font-semibold">{title}</span>
        {sub && <span className="block truncate text-xs text-fg-2">{sub}</span>}
      </Link>
    </div>
  );
}

function PopularWideCard({
  title,
  sub,
  art,
  gradient,
  onPlay,
}: {
  title: string;
  sub: string;
  art?: string;
  gradient: string;
  onPlay: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPlay}
      className="group relative flex h-36 w-64 shrink-0 snap-start items-end overflow-hidden rounded-[20px] p-4 text-left ring-1 ring-line-strong shadow-[0_16px_40px_rgb(4_3_18/0.48)] transition-transform duration-300 ease-out-expo hover:scale-[1.02] active:scale-[0.98] md:h-42 md:w-80"
    >
      {art ? (
        <Artwork src={art} className="absolute inset-0 size-full" />
      ) : (
        <span className={cn("absolute inset-0", gradient)} />
      )}
      <span
        aria-hidden="true"
        className={cn("absolute inset-0 opacity-65 mix-blend-multiply transition-opacity group-hover:opacity-55", gradient)}
      />
      <span aria-hidden="true" className="concept-stripes pointer-events-none absolute inset-0 opacity-50" />
      <span aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-black/75 via-black/20 to-transparent" />

      <span className="relative z-10 flex w-full items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-base font-bold text-white">{title}</span>
          <span className="block truncate text-xs text-white/80">{sub}</span>
        </span>
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white/20 text-white backdrop-blur-md ring-1 ring-white/35 transition-transform group-hover:scale-110">
          <PlayIcon size={20} weight="fill" className="translate-x-0.5" />
        </span>
      </span>
    </button>
  );
}

export default function Home() {
  const { favorites, playlists, history, status } = useLibrary();
  const offlineEntries = useOffline((s) => s.entries);
  const playList = usePlayer((s) => s.playList);
  const navigate = useNavigate();
  const t = useT();
  const show = useAppearance();
  const [query, setQuery] = useState("");

  const offlineList = useMemo(
    () =>
      Object.values(offlineEntries)
        .sort((a, b) => b.savedAt - a.savedAt)
        .map((e) => e.track),
    [offlineEntries],
  );
  const offlineBytes = useMemo(
    () => Object.values(offlineEntries).reduce((sum, e) => sum + (e.size || 0), 0),
    [offlineEntries],
  );

  const artists = useMemo(() => {
    const map = new Map<string, { name: string; thumb?: string }>();
    for (const tr of [...favorites, ...history, ...offlineList]) {
      const name = tr.artist?.trim();
      if (!name || name === t.common.youtube) continue;
      if (!map.has(name)) map.set(name, { name, thumb: tr.thumb });
      if (map.size >= 12) break;
    }
    return [...map.values()];
  }, [favorites, history, offlineList, t.common.youtube]);

  const popularTracks = useMemo(() => {
    const seen = new Set<string>();
    const list: Track[] = [];
    for (const tr of [...history, ...favorites, ...offlineList]) {
      if (seen.has(tr.id)) continue;
      seen.add(tr.id);
      list.push(tr);
      if (list.length >= 12) break;
    }
    return list;
  }, [history, favorites, offlineList]);

  const empty = status === "ready" && !favorites.length && !playlists.length && !history.length && !offlineList.length;

  const onSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    navigate(q ? `${paths.search}?q=${encodeURIComponent(q)}` : paths.search);
  };

  return (
    <div className="pb-8">
      <PageHeader />

      {/* Top Greeting + Pill Frosted Search Bar inspired by the design concept */}
      <div className="flex flex-col gap-4 px-4 pt-3 pb-6 md:px-6 md:pt-7">
        <div className="flex items-end justify-between gap-4">
          <h1 className="text-[26px] leading-tight font-bold tracking-tight md:text-4xl">
            {t.time.greeting(new Date().getHours())}
          </h1>
          {offlineUi() && offlineList.length > 0 && (
            <Link
              to={paths.offline}
              className="glass-card hidden h-9 items-center gap-2 rounded-full px-3.5 text-xs font-semibold text-accent-text sm:flex"
            >
              <CloudArrowDownIcon size={16} weight="fill" />
              <span>{t.common.tracks(offlineList.length)}</span>
              {offlineBytes > 0 && <span className="font-mono text-fg-2">· {formatBytes(offlineBytes)}</span>}
            </Link>
          )}
        </div>

        <form onSubmit={onSearchSubmit} role="search" className="relative max-w-xl">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.home.searchPlaceholder}
            aria-label={t.home.searchPlaceholder}
            className="glass-card h-11 w-full rounded-full pr-11 pl-5 text-sm text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          <button
            type="submit"
            aria-label={t.search.title}
            className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-full text-fg-2 transition-colors hover:bg-surface-3 hover:text-fg"
          >
            <MagnifyingGlassIcon size={18} />
          </button>
        </form>
      </div>

      {status === "loading" && <TrackListSkeleton rows={6} />}

      {empty && (
        <div className="glass-card mx-4 mb-8 flex flex-col items-start gap-5 rounded-[22px] p-6 md:mx-6 md:flex-row md:items-center md:p-8">
          <span className="concept-grad-pink grid size-16 shrink-0 place-items-center rounded-[18px] text-white shadow-[0_12px_30px_rgb(255_30_108/0.4)]">
            <LogoMark className="size-10" />
          </span>
          <div className="flex-1">
            <p className="text-xl font-bold tracking-tight">{t.home.startTitle}</p>
            <p className="mt-1 max-w-[52ch] text-sm text-fg-2">{t.home.startBody}</p>
          </div>
          <button
            type="button"
            onClick={() => navigate(paths.search)}
            className="flex h-12 items-center gap-2 rounded-full bg-accent pr-6 pl-5 font-semibold text-accent-ink shadow-[0_10px_28px_rgb(255_30_108/0.35)] transition-transform active:scale-[0.97]"
          >
            <MagnifyingGlassIcon size={20} weight="bold" /> {t.common.searchMusic}
          </button>
        </div>
      )}

      {status === "ready" && (
        <div className="flex flex-col gap-9">
          {/* Explorer carousel (square cards with vibrant gradients & play triangle from 3804655.jpg) */}
          {show.homeShortcuts && (
            <Section title={t.home.explorer}>
              <div className="no-scrollbar flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 md:scroll-px-6 md:px-6">
                <ExplorerCard
                  to={paths.favorites}
                  title={t.nav.favorites}
                  sub={t.common.tracks(favorites.length)}
                  gradient="concept-grad-pink"
                  tracks={favorites}
                  icon={<HeartIcon size={40} weight="fill" />}
                />
                {offlineUi() && (
                  <ExplorerCard
                    to={paths.offline}
                    title={t.nav.downloads}
                    sub={offlineBytes > 0 ? `${t.common.tracks(offlineList.length)} · ${formatBytes(offlineBytes)}` : t.common.tracks(offlineList.length)}
                    gradient="concept-grad-cyan"
                    tracks={offlineList}
                    icon={<CloudArrowDownIcon size={40} weight="fill" />}
                  />
                )}
                <ExplorerCard
                  to={paths.history}
                  title={t.nav.recentlyPlayed}
                  sub={t.common.tracks(history.length)}
                  gradient="concept-grad-violet"
                  tracks={history}
                  icon={<ClockCounterClockwiseIcon size={40} />}
                />
                {playlists.slice(0, 8).map((p, idx) => (
                  <ExplorerCard
                    key={p.id}
                    to={paths.playlist(p.id)}
                    title={p.name}
                    sub={t.common.tracks(p.tracks.length)}
                    gradient={RING_GRADS[idx % RING_GRADS.length]!}
                    art={p.tracks[0]?.art || p.tracks[0]?.thumb}
                    tracks={p.tracks}
                  />
                ))}
                {empty &&
                  EXPLORER_VIBES.map((v) => (
                    <ExplorerCard
                      key={v.label}
                      to={`${paths.search}?q=${encodeURIComponent(v.query)}`}
                      title={v.label}
                      sub={t.search.title}
                      gradient={v.grad}
                    />
                  ))}
              </div>
            </Section>
          )}

          {/* Popular wide cards (matching Popular wide tiles in 3804655.jpg) */}
          {show.homeRecent && popularTracks.length > 0 && (
            <Section
              title={t.home.popular}
              action={
                <Link to={paths.history} className="text-sm font-medium text-fg-2 hover:text-fg">
                  {t.home.seeAll}
                </Link>
              }
            >
              <div className="no-scrollbar flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 md:scroll-px-6 md:px-6">
                {popularTracks.map((tr, i) => (
                  <PopularWideCard
                    key={tr.id}
                    title={tr.title}
                    sub={tr.artist || t.common.youtube}
                    art={tr.art || tr.thumb}
                    gradient={RING_GRADS[(i + 2) % RING_GRADS.length]!}
                    onPlay={() => playList(popularTracks, i)}
                  />
                ))}
              </div>
            </Section>
          )}

          {/* Artists circular gradient-ring avatars (matching Artist row in 3804655.jpg) */}
          {artists.length > 0 && (
            <Section title={t.home.artists}>
              <div className="no-scrollbar flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 md:scroll-px-6 md:px-6">
                {artists.map((a, i) => (
                  <Link
                    key={a.name}
                    to={`${paths.search}?q=${encodeURIComponent(a.name)}`}
                    className="group flex w-24 shrink-0 snap-start flex-col items-center gap-2 text-center md:w-28"
                  >
                    <span
                      className={cn(
                        "block size-22 rounded-full p-[3px] shadow-[0_12px_28px_rgb(4_3_18/0.45)] transition-transform duration-300 ease-out-expo group-hover:scale-105 md:size-26",
                        RING_GRADS[i % RING_GRADS.length],
                      )}
                    >
                      <span className="block size-full overflow-hidden rounded-full bg-surface-solid p-[2px]">
                        {a.thumb ? (
                          <Artwork src={a.thumb} className="size-full rounded-full" />
                        ) : (
                          <span className="grid size-full place-items-center rounded-full bg-surface-3 text-fg-2">
                            <UserIcon size={28} weight="fill" />
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="w-full truncate text-xs font-medium text-fg-2 group-hover:text-fg">{a.name}</span>
                  </Link>
                ))}
              </div>
            </Section>
          )}

          {show.homeFavorites && favorites.length > 0 && (
            <Section
              title={t.home.yourFavorites}
              action={
                <Link to={paths.favorites} className="text-sm font-medium text-fg-2 hover:text-fg">
                  {t.home.seeAll}
                </Link>
              }
            >
              <div className="px-2 md:px-3">
                <TrackList tracks={favorites.slice(0, 6)} context={favorites} header={false} showAlbum={false} />
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}
