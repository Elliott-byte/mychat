export function Sidebar({
  open,
  conversations,
  currentId,
  historyEnabled,
  onNew,
  onOpen,
  onRename,
  onDelete,
  onClearAll,
  onRefreshModels,
  onLogout,
}) {
  return (
    <aside className={"sidebar" + (open ? " open" : "")}>
      <div className="sb-top">
        <button className="new-chat" onClick={onNew}>
          ＋ New chat
        </button>
      </div>

      <div className="sb-label">
        <span>History</span>
        {historyEnabled && conversations.length > 0 && (
          <button onClick={onClearAll} title="Delete all history">
            Clear
          </button>
        )}
      </div>

      <div className="conv-list">
        {!historyEnabled ? (
          <div className="conv-empty">
            No D1 database bound —
            <br />
            this conversation will not be saved.
          </div>
        ) : conversations.length === 0 ? (
          <div className="conv-empty">
            No conversations yet
            <br />
            send a message to start one
          </div>
        ) : (
          conversations.map((c) => (
            <div
              key={c.id}
              className={"conv" + (c.id === currentId ? " active" : "")}
              onClick={() => onOpen(c.id)}
              title={c.title}
            >
              <span className="t">{c.title}</span>
              <span className="acts">
                <button
                  title="Rename"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRename(c);
                  }}
                >
                  ✎
                </button>
                <button
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(c);
                  }}
                >
                  🗑
                </button>
              </span>
            </div>
          ))
        )}
      </div>

      <div className="sb-bottom">
        <button onClick={onRefreshModels}>⟳ Refresh models</button>
        <button onClick={onLogout}>Sign out</button>
      </div>
    </aside>
  );
}
