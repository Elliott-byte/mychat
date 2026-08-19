export function isFree(m) {
  return (
    m.id.endsWith(":free") ||
    (m.promptPrice === 0 && m.completionPrice === 0 && m.imagePrice === 0)
  );
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
  const current = models.find((m) => m.id === model);

  let info = status;
  if (!info) {
    if (!current) {
      info = "无匹配模型";
    } else {
      const price = isFree(current)
        ? "免费"
        : `输入 $${(current.promptPrice * 1e6).toFixed(2)}/M · 输出 $${(
            current.completionPrice * 1e6
          ).toFixed(2)}/M`;
      const date = current.created
        ? new Date(current.created * 1000).toISOString().slice(0, 10)
        : "?";
      const ctx = current.context ? (current.context / 1000).toFixed(0) + "K" : "?";
      info = `${current.id} · 上线 ${date} · 上下文 ${ctx} · ${price}`;
    }
  }

  return (
    <header>
      <button className="menu-btn" onClick={onMenu}>
        ☰
      </button>
      <input
        className="model-search"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="搜索模型…"
      />
      <label className="chk">
        <input type="checkbox" checked={freeOnly} onChange={(e) => onFreeOnly(e.target.checked)} />
        只看免费
      </label>
      <select value={model} onChange={(e) => onModel(e.target.value)}>
        {models.slice(0, 300).map((m) => (
          <option key={m.id} value={m.id}>
            {(isFree(m) ? "🆓 " : "") + m.name}
          </option>
        ))}
      </select>
      <div className="model-info">{info}</div>
    </header>
  );
}
