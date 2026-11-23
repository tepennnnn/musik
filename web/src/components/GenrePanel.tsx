import { Link } from "react-router";
import { useRemote } from "../hooks/useRemote";
import { useI18n, useT } from "../i18n";
import { api } from "../lib/api";
import { paths } from "../lib/routes";
import type { Genre } from "../lib/types";

function CategoryChips({
  title,
  state,
  dotClass,
}: {
  title: string;
  state: ReturnType<typeof useRemote<Genre[]>>;
  dotClass: string;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2">
      <p className="px-1 text-xs font-medium text-fg-2">{title}</p>

      {state.status === "loading" && (
        <div aria-label={t.common.loading} className="flex flex-wrap gap-2">
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i} className="skeleton h-9 rounded-full" style={{ width: `${64 + ((i * 23) % 56)}px` }} />
          ))}
        </div>
      )}

      {state.status === "error" && (
        <p className="px-1 text-sm text-fg-2">
          {state.message}{" "}
          <button type="button" onClick={state.retry} className="font-medium text-fg underline-offset-2 hover:underline">
            {t.common.retry}
          </button>
        </p>
      )}

      {state.status === "ok" && (
        <ul className="flex flex-wrap gap-2">
          {state.data.map((g) => (
            <li key={g.id}>
              <Link
                to={paths.genre(g.id)}
                state={{ name: g.name }}
                className="glass-card inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors"
              >
                <span className={`size-2 rounded-full ${dotClass}`} />
                <span>{g.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** YouTube Music's mood styles and genres as glass chips; each opens artists and songs in that style. */
export function GenrePanel({ id }: { id: string }) {
  const lang = useI18n((s) => s.lang);
  const t = useT();
  const moods = useRemote<Genre[]>(`moods:${lang}`, () => api.moods());
  const genres = useRemote<Genre[]>(`genres:${lang}`, () => api.genres());

  return (
    <div id={id} className="glass-card flex flex-col gap-4 rounded-[18px] p-3.5">
      <CategoryChips title={t.search.exploreMoods} state={moods} dotClass="bg-fg shadow-[0_0_6px_rgb(255_255_255/0.45)]" />
      <CategoryChips title={t.search.exploreGenres} state={genres} dotClass="bg-fg-2" />
    </div>
  );
}
