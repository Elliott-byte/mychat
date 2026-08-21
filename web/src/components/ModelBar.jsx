import { useState } from "react";
import { IconMenu, IconSearch } from "../icons";

export function isFree(m) {
  return (
    m.id.endsWith(":free") ||
    (m.promptPrice === 0 && m.completionPrice === 0 && m.imagePrice === 0)
  );
}

/** The model id, plus everything else worth knowing about it. */
function describe(current) {
  if (!current) return null;
  const price = isFree(current)
    ? "Free"
    : `in $${(current.promptPrice * 1e6).toFixed(2)}/M · out $${(
        current.completionPrice * 1e6
      ).toFixed(2)}/M`;
  const date = current.created
    ? new Date(current.created * 1000).toISOString().slice(0, 10)
    : "?";
  const ctx = current.context ? (current.context / 1000).toFixed(0) + "K" : "?";
  const caps = [];
  if (current.input?.includes("image")) caps.push("reads images");
  if (current.output?.includes("image")) caps.push("returns images");
  return { id: current.id, meta: [`released ${date}`, `${ctx} context`, price].join(" · "), caps };
}

export function ModelBar({
  models,
  model,
  onModel,
  search,
  onSearch,
  freeOnly,
  onFreeOnly,
  onMenu,
  status,
}) {
  // On a phone the search box and the "free only" toggle would leave the picker
  // itself about 150px wide, so they fold away behind the search button until
  // asked for. On a wide screen .model-filters is `display: contents` and this
  // state is inert.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtering = Boolean(search.trim()) || freeOnly;

  const info = describe(models.find((m) => m.id === model));

  return (
    <header>
      <button className="menu-btn" onClick={onMenu} aria-label="Conversations" title="Conversations">
        <IconMenu size={18} />
      </button>

      <select value={model} onChange={(e) => onModel(e.target.value)} aria-label="Model">
        {models.slice(0, 300).map((m) => (
          <option key={m.id} value={m.id}>
            {(isFree(m) ? "🆓 " : "") +
              (m.input?.includes("image") ? "📷 " : "") +
              (m.output?.includes("image") ? "🎨 " : "") +
              m.name}
          </option>
        ))}
      </select>

      <button
        className={"filter-btn" + (filtersOpen || filtering ? " on" : "")}
        onClick={() => setFiltersOpen((v) => !v)}
        aria-label="Filter models"
        aria-expanded={filtersOpen}
        title="Filter models"
      >
        <IconSearch size={17} />
      </button>

      <div className={"model-filters" + (filtersOpen ? " open" : "")}>
        <input
          className="model-search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search models…"
          aria-label="Search models"
        />
        <label className="chk">
          <input type="checkbox" checked={freeOnly} onChange={(e) => onFreeOnly(e.target.checked)} />
          Free only
        </label>
      </div>

      <div className="model-info">
        {status ? (
          status
        ) : info ? (
          <>
            <span className="mi-id">{info.id} · </span>
            <span className="mi-meta">{info.meta}</span>
            {info.caps.map((c) => (
              <span className="mi-cap" key={c}>
                {c}
              </span>
            ))}
          </>
        ) : (
          "No matching model"
        )}
      </div>
    </header>
  );
}
