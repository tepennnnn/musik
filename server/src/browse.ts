import type { Innertube } from "youtubei.js";
import { isLang, msg, type Lang } from "./i18n.js";
import { radio, sized, text, toTrack, withClient } from "./search.js";
import type { MoodOrGenre, SimilarArtist, StyleRecommendations, Track } from "./types.js";
import { HttpError, VIDEO_ID } from "./types.js";

export interface Genre {
  /** YouTube Music's opaque "params" for the genre page. */
  id: string;
  name: string;
}

export interface GenreArtist {
  id: string;
  name: string;
  /** Cover of one of their releases in this genre (artist photos would cost a request each). */
  thumb: string;
  art: string;
  /** A few of their songs in this genre, to recognize them by. */
  hits: string[];
}

export interface GenrePage {
  id: string;
  name: string;
  /** The first page of artists; more come from `genreArtists`. */
  artists: GenreArtist[];
  hasMoreArtists: boolean;
  tracks: Track[];
}

/** An album or single as a cover in a list (artist page, search). */
export interface AlbumCard {
  id: string;
  title: string;
  /** Empty on an artist's own page, where it goes without saying. */
  artist: string;
  year: string;
  thumb: string;
  art: string;
}

export interface ArtistPage {
  id: string;
  name: string;
  description: string;
  banner: string;
  tracks: Track[];
  albums: AlbumCard[];
  singles: AlbumCard[];
}

export interface AlbumPage {
  id: string;
  title: string;
  artist: string;
  artistId: string | null;
  /** YouTube Music's own lines, in the request's language: "Album • 1991", "13 songs • 49 minutes". */
  kind: string;
  info: string;
  thumb: string;
  art: string;
  tracks: Track[];
}

export const ALBUM_ID = /^MPRE[\w-]{6,60}$/;

export const GENRE_ID = /^[\w-]{8,120}={0,2}$/;
export const ARTIST_ID = /^UC[\w-]{22}$/;

const MINUTE = 60_000;
const ARTISTS_PAGE = 40;
/** Enough for anyone browsing; stops reading playlists after that. */
const MAX_ARTISTS = 600;
const PLAYLISTS_PER_ROUND = 4;
const MAX_GENRE_TRACKS = 150;
const MAX_HITS = 50;

/** Time-boxed memo: these pages change slowly, and going back and forth between them should be instant. */
function cached<T>(ttl: number, load: (key: string) => Promise<T>): (key: string) => Promise<T> {
  const memo = new Map<string, { at: number; value: Promise<T> }>();
  return (key) => {
    const hit = memo.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    if (memo.size > 200) memo.delete(memo.keys().next().value!);
    const value = load(key);
    memo.set(key, { at: Date.now(), value });
    // Failures are not cached, so the next visit tries again.
    value.catch(() => memo.get(key)?.value === value && memo.delete(key));
    return value;
  };
}

// youtubei.js has no typed helper for the genre pages, so these responses are read defensively.
const browse = (yt: Innertube, payload: Record<string, unknown>): Promise<any> =>
  yt.actions.execute("/browse", { ...payload, client: "YTMUSIC", parse: true });

function shelvesOf(page: any): any[] {
  const root = typeof page?.contents?.item === "function" ? page.contents.item() : page?.contents;
  return root?.tabs?.[0]?.content?.contents ?? [];
}

const itemsOf = (shelf: any): any[] => shelf?.contents ?? shelf?.items ?? [];

function imagesOf(item: any): { thumb: string; art: string } {
  const thumbs = item?.thumbnail?.contents ?? item?.thumbnail ?? item?.thumbnails ?? [];
  const url: string | undefined = Array.isArray(thumbs) ? thumbs[0]?.url : undefined;
  return { thumb: sized(url, 240), art: sized(url, 544) };
}

/** Same song twice (another upload, a playlist repeat) only shows once. */
function uniqueTracks(tracks: (Track | null)[]): Track[] {
  const seen = new Set<string>();
  return tracks.filter((t): t is Track => {
    if (!t) return false;
    const key = `${t.title}|${t.artist}`.toLocaleLowerCase("pt-BR");
    if (seen.has(t.id) || seen.has(key)) return false;
    seen.add(t.id);
    seen.add(key);
    return true;
  });
}

/** [[a1, a2], [b1]] → [a1, b1, a2] */
function roundRobin<T>(lists: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]!);
  return out;
}

/** "Céu Azul (Ao Vivo)" → "Céu Azul": enough to recognize the song in a short preview. */
const bareTitle = (title: string) => title.replace(/\s*[([].*?[)\]]/g, "").trim() || title;

// Pages are cached per language: YouTube Music words genre names and bios in the session's language.
const keyOf = (lang: Lang, id = "") => `${lang}|${id}`;
function parseKey(key: string): { lang: Lang; id: string } {
  const [lang = "", ...rest] = key.split("|");
  return { lang: isLang(lang) ? lang : "en", id: rest.join("|") };
}

const parseCategories = (grid: any, kind: "genre" | "mood"): MoodOrGenre[] =>
  itemsOf(grid)
    .map((b) => ({
      id: String(b.endpoint?.payload?.params ?? ""),
      name: text(b.button_text ?? b.title),
      kind,
    }))
    .filter((g) => GENRE_ID.test(g.id) && g.name);

const moodsAndGenresCatalog = cached(6 * 60 * MINUTE, async (key): Promise<{ genres: MoodOrGenre[]; moods: MoodOrGenre[] }> => {
  const { lang } = parseKey(key);
  const page = await withClient((yt) => browse(yt, { browseId: "FEmusic_moods_and_genres" }), lang).catch(() => {
    throw new HttpError(502, msg("genresUnavailable"));
  });
  const grids = shelvesOf(page);
  const genreGrid = grids.find((g) => /g[eéê]ne?r/i.test(text(g.header?.title ?? g.title))) ?? grids.at(-1);
  const moodGrid =
    grids.find((g) => g !== genreGrid && /mood|moment|humor|clima|atividades|feel/i.test(text(g.header?.title ?? g.title))) ??
    grids.find((g) => g !== genreGrid);

  return {
    genres: parseCategories(genreGrid, "genre"),
    moods: moodGrid ? parseCategories(moodGrid, "mood") : [],
  };
});

export const genres = async (lang: Lang): Promise<Genre[]> =>
  (await moodsAndGenresCatalog(keyOf(lang))).genres.map(({ id, name }) => ({ id, name }));

export const moods = async (lang: Lang): Promise<Genre[]> =>
  (await moodsAndGenresCatalog(keyOf(lang))).moods.map(({ id, name }) => ({ id, name }));

async function playlistItems(id: string, limit: number, lang: Lang): Promise<any[]> {
  try {
    const list = await withClient((yt) => yt.music.getPlaylist(id), lang);
    return ((list as any).items ?? (list as any).contents ?? []).slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Ranks the artists credited on `sources` by how often they show up (times the source's weight),
 * skipping the ones already `known`. Channels that are not artist pages (labels, uploaders) are left out.
 */
function rankArtists(sources: { items: any[]; weight: number; hits: boolean }[], known: Set<string>): GenreArtist[] {
  const ranked = new Map<string, GenreArtist & { score: number }>();
  for (const { items, weight, hits } of sources) {
    for (const item of items) {
      const hit = hits ? bareTitle(text(item.title)) : "";
      for (const a of item.artists ?? []) {
        const pageType = a?.endpoint?.payload?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
        if (!ARTIST_ID.test(a?.channel_id ?? "") || known.has(a.channel_id)) continue;
        if (pageType && pageType !== "MUSIC_PAGE_TYPE_ARTIST") continue;
        let entry = ranked.get(a.channel_id);
        if (!entry) {
          entry = { id: a.channel_id, name: text(a.name), ...imagesOf(item), hits: [], score: 0 };
          ranked.set(a.channel_id, entry);
        }
        entry.score += weight;
        if (hit && entry.hits.length < 3 && !entry.hits.includes(hit)) entry.hits.push(hit);
      }
    }
  }
  return [...ranked.values()]
    .filter((a) => a.name)
    .sort((a, b) => b.score - a.score)
    .map(({ score: _, ...a }) => a);
}

/** What a genre has turned up so far. "Load more" keeps reading its playlists for artists not seen yet. */
interface GenreState {
  page: GenrePage;
  /** Every artist found so far, in a fixed order: later pages append, never reshuffle earlier ones. */
  pool: GenreArtist[];
  /** Playlists not read yet. */
  queue: string[];
  lang: Lang;
  extending?: Promise<void>;
}

/**
 * A genre's songs and the artists behind them. The page lists ~50 songs, playlists and albums;
 * two editorial playlists widen the song list (and are all there is for pages like "Décadas").
 */
const genreState = cached(30 * MINUTE, async (key): Promise<GenreState> => {
  const { lang, id } = parseKey(key);
  const [catalog, page] = await Promise.all([
    moodsAndGenresCatalog(keyOf(lang)).catch(() => ({ genres: [] as MoodOrGenre[], moods: [] as MoodOrGenre[] })),
    withClient((yt) => browse(yt, { browseId: "FEmusic_moods_and_genres_category", params: id }), lang).catch(() => {
      throw new HttpError(502, msg("genreUnavailable"));
    }),
  ]);
  const all = [...catalog.genres, ...catalog.moods];
  const shelves = shelvesOf(page);
  const items = shelves.flatMap(itemsOf);
  const songs = items.filter((i) => i.item_type === "song");
  const albums = items.filter((i) => i.item_type === "album");

  // One playlist from each shelf in turn (so "Décadas" mixes decades), editorial ("RDCLAK...") before
  // community ones, which are hit and miss.
  const perShelf = shelves.map((s) => itemsOf(s).filter((i) => i.item_type === "playlist" && typeof i.id === "string"));
  const editorial = (p: any) => /RDCLAK/.test(p.id);
  const playlists = [
    ...new Set(
      [...roundRobin(perShelf.map((list) => list.filter(editorial))), ...roundRobin(perShelf.map((list) => list.filter((p) => !editorial(p))))].map(
        (p): string => p.id,
      ),
    ),
  ];
  const first = songs.length >= 10 ? 2 : 4;
  const fromPlaylists = (await Promise.all(playlists.slice(0, first).map((p) => playlistItems(p, 60, lang)))).flat();

  const tracks = uniqueTracks([...songs, ...fromPlaylists].map((i) => toTrack(i, "song"))).slice(0, MAX_GENRE_TRACKS);
  if (!tracks.length && !albums.length) throw new HttpError(404, msg("genreEmpty"));

  // The genre's own song and album shelves weigh more than playlists.
  const pool = rankArtists(
    [
      { items: songs, weight: 2, hits: true },
      { items: albums, weight: 2, hits: false },
      { items: fromPlaylists, weight: 1, hits: true },
    ],
    new Set(),
  );
  // More artists come from the remaining editorial playlists; community ones only when there is nothing else.
  const rest = playlists.slice(first);
  const queue = rest.some((p) => /RDCLAK/.test(p)) ? rest.filter((p) => /RDCLAK/.test(p)) : rest;

  return {
    page: {
      id,
      name: all.find((g) => g.id === id)?.name ?? "",
      artists: pool.slice(0, ARTISTS_PAGE),
      hasMoreArtists: pool.length > ARTISTS_PAGE || queue.length > 0,
      tracks,
    },
    pool,
    queue,
    lang,
  };
});

export const genre = async (id: string, lang: Lang): Promise<GenrePage> => (await genreState(keyOf(lang, id))).page;

/** Reads the next few playlists of the genre and appends the artists they bring. */
async function extend(state: GenreState): Promise<void> {
  const batch = state.queue.splice(0, PLAYLISTS_PER_ROUND);
  const items = (await Promise.all(batch.map((p) => playlistItems(p, 100, state.lang)))).flat();
  state.pool.push(...rankArtists([{ items, weight: 1, hits: true }], new Set(state.pool.map((a) => a.id))));
  if (state.pool.length >= MAX_ARTISTS) state.queue.length = 0;
}

/** The next page of a genre's artists, reading more of its playlists when the ones found so far run out. */
export async function genreArtists(id: string, offset: number, lang: Lang): Promise<{ artists: GenreArtist[]; hasMore: boolean }> {
  const state = await genreState(keyOf(lang, id));
  // A few rounds at most per request, so a run of playlists with no new names can't stall it.
  for (let round = 0; round < 5 && state.pool.length < offset + ARTISTS_PAGE && state.queue.length; round++) {
    // Two "load more" taps at once share the same read instead of skipping playlists.
    state.extending ??= extend(state).finally(() => (state.extending = undefined));
    await state.extending;
  }
  return {
    artists: state.pool.slice(offset, offset + ARTISTS_PAGE),
    hasMore: state.pool.length > offset + ARTISTS_PAGE || state.queue.length > 0,
  };
}

/** An artist's most played songs (the "Top songs" shelf, expanded to its full list). */
function albumCard(item: any): AlbumCard | null {
  const id = typeof item?.id === "string" ? item.id : "";
  if (!ALBUM_ID.test(id)) return null;
  const subtitle = text(item.subtitle);
  const artists: string[] = (item.artists ?? []).map((a: { name?: string }) => text(a?.name)).filter(Boolean);
  return {
    id,
    title: text(item.title),
    artist: artists.join(", ") || text(item.author?.name),
    year: String(item.year ?? subtitle.match(/\b(19|20)\d\d\b/)?.[0] ?? ""),
    ...imagesOf(item),
  };
}

const albumCards = (items: any[]) => items.map(albumCard).filter((a): a is AlbumCard => !!a && !!a.title);

/** Every album of an artist: the page shows ten, its "more" link opens the whole discography. */
async function allAlbums(shelf: any, lang: Lang): Promise<AlbumCard[]> {
  const shown = albumCards(itemsOf(shelf));
  const more = shelf?.header?.more_content?.endpoint?.payload;
  if (!more?.browseId) return shown;
  try {
    const page = await withClient((yt) => browse(yt, { browseId: more.browseId, params: more.params }), lang);
    const all = albumCards(page.contents_memo?.get("MusicTwoRowItem") ?? []);
    return all.length >= shown.length ? all : shown;
  } catch {
    return shown;
  }
}

const artistPage = cached(30 * MINUTE, async (key): Promise<ArtistPage> => {
  const { lang, id } = parseKey(key);
  const page = await withClient((yt) => yt.music.getArtist(id), lang).catch(() => {
    throw new HttpError(502, msg("artistUnavailable"));
  });
  const header: any = page.header;
  const shelf: any = page.sections.find((s) => s.type === "MusicShelf");
  // Album shelves are told apart by what they hold, not by their (translated) titles: albums come first, then singles.
  const releaseShelves: any[] = page.sections.filter((s: any) => itemsOf(s).some((i) => i.item_type === "album"));
  let items: any[] = itemsOf(shelf);
  // The shelf shows 5; its "show all" link is a playlist with the full ranking.
  const fullList = shelf?.endpoint?.payload?.browseId;
  const [more, albums] = await Promise.all([
    typeof fullList === "string" && fullList.startsWith("VL") ? playlistItems(fullList, MAX_HITS * 2, lang) : Promise.resolve([]),
    releaseShelves[0] ? allAlbums(releaseShelves[0], lang) : Promise.resolve([]),
  ]);
  if (more.length) items = more;
  const banner = (header?.thumbnail?.contents ?? header?.thumbnail ?? [])[0]?.url;
  const name = text(header?.title);
  const tracks = uniqueTracks(items.map((i) => toTrack(i, "song"))).slice(0, MAX_HITS);
  if (!name && !tracks.length) throw new HttpError(404, msg("artistNotFound"));
  return {
    id,
    name,
    description: text(header?.description),
    banner: typeof banner === "string" && banner.startsWith("https://") ? banner : "",
    tracks,
    albums,
    singles: releaseShelves[1] ? albumCards(itemsOf(releaseShelves[1])) : [],
  };
});

export const artist = (id: string, lang: Lang) => artistPage(keyOf(lang, id));

/** An album's tracks in order. Its tracks carry no cover or artist of their own: they get the album's. */
const albumPage = cached(60 * MINUTE, async (key): Promise<AlbumPage> => {
  const { lang, id } = parseKey(key);
  const album: any = await withClient((yt) => yt.music.getAlbum(id), lang).catch(() => {
    throw new HttpError(502, msg("albumUnavailable"));
  });
  const header = album.header;
  const title = text(header?.title);
  const artistRuns: any[] = header?.strapline_text_one?.runs ?? [];
  const artist = text(header?.strapline_text_one) || text(header?.author?.name);
  const artistId: string | null = artistRuns.map((r) => r?.endpoint?.payload?.browseId).find((b) => ARTIST_ID.test(b ?? "")) ?? null;
  const cover = imagesOf(header);
  const tracks = (album.contents ?? [])
    .filter((i: any) => typeof i?.id === "string" && VIDEO_ID.test(i.id))
    .map(
      (i: any): Track => ({
        id: i.id,
        title: text(i.title) || "Untitled",
        artist: (i.artists ?? []).map((a: { name?: string }) => text(a?.name)).filter(Boolean).join(", ") || artist,
        album: title,
        duration: i.duration?.seconds ?? 0,
        thumb: sized(cover.art, 120),
        art: cover.art,
        kind: "song",
      }),
    );
  if (!title && !tracks.length) throw new HttpError(404, msg("albumNotFound"));
  return {
    id,
    title,
    artist,
    artistId,
    kind: text(header?.subtitle),
    info: text(header?.second_subtitle),
    thumb: cover.thumb,
    art: cover.art,
    tracks,
  };
});

export const album = (id: string, lang: Lang) => albumPage(keyOf(lang, id));

export async function searchAlbums(query: string, lang: Lang): Promise<AlbumCard[]> {
  const result: any = await withClient((yt) => yt.music.search(query, { type: "album" }), lang);
  return albumCards(itemsOf(result.contents?.[0]));
}

interface RelatedBundle {
  tracks: Track[];
  artists: SimilarArtist[];
  cues: string[];
}

const relatedFor = cached(30 * MINUTE, async (key): Promise<RelatedBundle> => {
  const { lang, id } = parseKey(key);
  const [upNext, relPage] = await Promise.all([
    radio(id).catch(() => [] as Track[]),
    withClient((yt) => yt.music.getRelated(id), lang).catch(() => null),
  ]);

  const relTracks: Track[] = [];
  const artists: SimilarArtist[] = [];
  const cues: string[] = [];
  const seenArtists = new Set<string>();

  const sections: any[] = Array.isArray((relPage as any)?.contents) ? (relPage as any).contents : [];
  for (const section of sections) {
    const heading = text(section?.header?.title ?? section?.title);
    if (heading) cues.push(heading);
    for (const item of itemsOf(section)) {
      const itemTitle = text(item?.title ?? item?.name);
      const itemSub = text(item?.subtitle);
      if (itemTitle) cues.push(itemTitle);
      if (itemSub) cues.push(itemSub);

      const browseId = String(item?.endpoint?.payload?.browseId ?? item?.id ?? "");
      if (ARTIST_ID.test(browseId) && !seenArtists.has(browseId) && itemTitle) {
        seenArtists.add(browseId);
        artists.push({ id: browseId, name: itemTitle, ...imagesOf(item) });
        continue;
      }

      const track = toTrack(item, "song");
      if (track && track.id !== id) relTracks.push(track);
    }
  }

  return {
    tracks: uniqueTracks([...relTracks, ...upNext]).filter((t) => t.id !== id),
    artists,
    cues,
  };
});

/** Maps style keywords (from titles, artists, related playlists) to YouTube Music genre & mood names. */
const STYLE_HINTS: [RegExp, string[]][] = [
  [/\b(synth|electronic|edm|house|techno|trance|dubstep|electro|club|dj|remix|dance)\b/i, ["electronic", "dance", "eletrônica", "energy", "energia", "party", "festa"]],
  [/\b(lofi|lo-fi|chill|ambient|downtempo|study|sleep|rain|calm|relax|soft|acoustic)\b/i, ["chill", "focus", "foco", "relax", "dormir", "sleep", "acoustic", "acústico"]],
  [/\b(rock|metal|punk|grunge|guitar|hardcore|alt-?rock|classic rock)\b/i, ["rock", "metal", "indie", "alternative", "alternativo", "energy", "energia"]],
  [/\b(indie|alternative|shoegaze|dream pop|bedroom pop)\b/i, ["indie", "alternative", "alternativo", "feel good", "chill", "astral"]],
  [/\b(hip[\s-]?hop|rap|trap|drill|boom bap|beats)\b/i, ["hip-hop", "hip hop", "rap", "workout", "treino", "energy", "energia"]],
  [/\b(r&b|rnb|soul|neo[\s-]?soul|funk|groove)\b/i, ["r&b", "soul", "romance", "chill", "feel good"]],
  [/\b(jazz|bossa|blues|sax|swing)\b/i, ["jazz", "blues", "chill", "focus", "foco", "dinner"]],
  [/\b(pop|hits|dance pop|teen pop)\b/i, ["pop", "feel good", "party", "festa", "commute"]],
  [/\b(classical|piano|orchestra|symphony|violin|cello|instrumental)\b/i, ["classical", "clássica", "focus", "foco", "sleep"]],
  [/\b(latin|reggaeton|salsa|bachata|sertanejo|mpb|samba|pagode|forro|forró)\b/i, ["latin", "latina", "mpb", "sertanejo", "party", "festa", "feel good"]],
  [/\b(country|folk|americana|bluegrass)\b/i, ["country", "folk", "acoustic", "feel good", "commute"]],
  [/\b(sad|melanchol|heartbreak|cry|lonely|blue)\b/i, ["sad", "triste", "romance", "chill"]],
  [/\b(workout|gym|run|cardio|pump|hype|beast)\b/i, ["workout", "treino", "energy", "energia", "pump"]],
];

function scoreCategories(list: MoodOrGenre[], corpus: string, seedHash: number): MoodOrGenre[] {
  const lower = corpus.toLowerCase();
  const scored = list.map((cat, idx) => {
    let score = 0;
    const catLower = cat.name.toLowerCase();
    // Direct word match against catalog name
    for (const word of catLower.split(/[^a-zà-ÿ0-9]+/).filter((w) => w.length >= 3)) {
      if (lower.includes(word)) score += 6;
    }
    // Style taxonomy match
    for (const [pattern, targets] of STYLE_HINTS) {
      if (pattern.test(lower) && targets.some((t) => catLower.includes(t))) {
        score += 4;
      }
    }
    // Deterministic tie-breaker so different songs pick fresh, varied genres/moods instead of always index 0.
    const tie = ((seedHash * 31 + idx * 17) % 97) / 100;
    return { cat, score: score + tie };
  });
  return scored.sort((a, b) => b.score - a.score).map((s) => s.cat);
}

/**
 * Recommends tracks, artists, genres and mood styles matching the given seed tracks
 * (same genre, mood style, and music style).
 */
export async function recommendations(seeds: Track[], lang: Lang): Promise<StyleRecommendations> {
  const cleanSeeds = seeds.filter((s) => s && VIDEO_ID.test(s.id)).slice(0, 4);
  const catalog = await moodsAndGenresCatalog(keyOf(lang)).catch(() => ({
    genres: [] as MoodOrGenre[],
    moods: [] as MoodOrGenre[],
  }));

  if (!cleanSeeds.length) {
    const pickGenres = catalog.genres.slice(0, 6);
    const pickMoods = catalog.moods.slice(0, 6);
    const starterIds = [pickMoods[0]?.id, pickGenres[0]?.id].filter((x): x is string => !!x);
    const pages = await Promise.all(starterIds.map((id) => genre(id, lang).catch(() => null)));
    const tracks = uniqueTracks(roundRobin(pages.filter((p): p is GenrePage => !!p).map((p) => p.tracks))).slice(0, 24);
    return { genres: pickGenres, moods: pickMoods, tracks, artists: [] };
  }

  const seedIds = new Set(cleanSeeds.map((s) => s.id));
  const relatedResults = await Promise.all(cleanSeeds.slice(0, 3).map((s) => relatedFor(keyOf(lang, s.id)).catch(() => null)));

  const cues: string[] = [];
  const relatedTracksList: Track[][] = [];
  const allArtists: SimilarArtist[] = [];
  const seenArtists = new Set<string>();

  for (const s of cleanSeeds) {
    cues.push(s.title, s.artist, s.album ?? "");
  }
  for (const rel of relatedResults) {
    if (!rel) continue;
    cues.push(...rel.cues);
    relatedTracksList.push(rel.tracks);
    for (const tr of rel.tracks.slice(0, 8)) cues.push(tr.title, tr.artist);
    for (const a of rel.artists) {
      if (!seenArtists.has(a.id)) {
        seenArtists.add(a.id);
        allArtists.push(a);
      }
    }
  }

  const corpus = cues.filter(Boolean).join(" ");
  const seedHash = [...cleanSeeds[0]!.id].reduce((acc, ch) => acc * 33 + ch.charCodeAt(0), 7) >>> 0;

  const matchedGenres = scoreCategories(catalog.genres, corpus, seedHash).slice(0, 6);
  const matchedMoods = scoreCategories(catalog.moods, corpus, seedHash + 13).slice(0, 6);

  // Pull tracks from the top matched Genre and top matched Mood to widen same-genre & same-mood variety.
  const catTargets = [matchedGenres[0]?.id, matchedMoods[0]?.id].filter((x): x is string => !!x);
  const catPages = await Promise.all(catTargets.map((id) => genre(id, lang).catch(() => null)));
  const catTrackLists = catPages
    .filter((p): p is GenrePage => !!p)
    .map((p) => p.tracks.slice(0, 14));

  const blended = uniqueTracks(roundRobin([...relatedTracksList, ...catTrackLists]))
    .filter((t) => !seedIds.has(t.id))
    .slice(0, 30);

  return {
    genres: matchedGenres,
    moods: matchedMoods,
    tracks: blended,
    artists: allArtists.slice(0, 12),
  };
}
