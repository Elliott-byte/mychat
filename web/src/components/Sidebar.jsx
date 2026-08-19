export function Sidebar({
  open,
  mode,
  onMode,
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
          ＋ 新对话
        </button>
        <div className="mode-tabs">
          <button className={mode === "chat" ? "active" : ""} onClick={() => onMode("chat")}>
            💬 对话
          </button>
          <button className={mode === "image" ? "active" : ""} onClick={() => onMode("image")}>
            🎨 图片
          </button>
        </div>
      </div>

      <div className="sb-label">
        <span>历史记录</span>
        {historyEnabled && conversations.length > 0 && (
          <button onClick={onClearAll} title="删除全部历史">
            清空
          </button>
        )}
      </div>

      <div className="conv-list">
        {!historyEnabled ? (
          <div className="conv-empty">
            未绑定 D1 数据库,
            <br />
            本次对话不会被保存。
          </div>
        ) : conversations.length === 0 ? (
          <div className="conv-empty">
            还没有历史对话
            <br />
            发一条消息试试
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
                  title="重命名"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRename(c);
                  }}
                >
                  ✎
                </button>
                <button
                  title="删除"
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
        <button onClick={onRefreshModels}>⟳ 刷新模型</button>
        <button onClick={onLogout}>退出登录</button>
      </div>
    </aside>
  );
}
