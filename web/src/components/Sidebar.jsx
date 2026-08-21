import { useEffect, useRef, useState } from "react";
import {
  IconCheck,
  IconLogOut,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTrash,
} from "../icons";

/**
 * Destructive actions confirm inline (tap once to arm, tap again to commit)
 * instead of through window.confirm/prompt — the native dialogs clash with the
 * UI and block the whole page. An armed control disarms itself after a moment.
 */
function useArmed(timeoutMs = 3500) {
  const [armed, setArmed] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const arm = (id) => {
    setArmed(id);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setArmed(null), timeoutMs);
  };
  const disarm = () => {
    clearTimeout(timer.current);
    setArmed(null);
  };
  return [armed, arm, disarm];
}

function ConvRow({ conv, active, onOpen, onRename, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conv.title);
  const [armed, arm, disarm] = useArmed();
  const cancelled = useRef(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function commit() {
    setEditing(false);
    const title = draft.trim();
    if (!cancelled.current && title && title !== conv.title) onRename(conv, title);
    cancelled.current = false;
  }

  return (
    <div
      className={"conv" + (active ? " active" : "")}
      onClick={() => !editing && onOpen(conv.id)}
      title={conv.title}
    >
      {editing ? (
        <input
          ref={inputRef}
          className="conv-edit"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              cancelled.current = true;
              e.currentTarget.blur();
            }
          }}
          aria-label="Conversation title"
        />
      ) : (
        <>
          <span className="t">{conv.title}</span>
          <span className="acts">
            <button
              className="ibtn"
              title="Rename"
              aria-label="Rename"
              onClick={(e) => {
                e.stopPropagation();
                disarm();
                setDraft(conv.title);
                setEditing(true);
              }}
            >
              <IconPencil size={14} />
            </button>
            <button
              className={"ibtn danger" + (armed ? " armed" : "")}
              title={armed ? "Tap again to delete" : "Delete"}
              aria-label={armed ? "Tap again to delete" : "Delete"}
              onClick={(e) => {
                e.stopPropagation();
                if (armed) {
                  disarm();
                  onDelete(conv);
                } else {
                  arm(conv.id);
                }
              }}
            >
              {armed ? <IconCheck size={14} /> : <IconTrash size={14} />}
            </button>
          </span>
        </>
      )}
    </div>
  );
}

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
  const [clearArmed, arm, disarm] = useArmed();

  return (
    <aside className={"sidebar" + (open ? " open" : "")}>
      <div className="sb-top">
        <button className="new-chat" onClick={onNew}>
          <IconPlus size={15} /> New chat
        </button>
      </div>

      <div className="sb-label">
        <span>History</span>
        {historyEnabled && conversations.length > 0 && (
          <button
            className={"sb-clear" + (clearArmed ? " armed" : "")}
            title="Delete all history"
            onClick={() => {
              if (clearArmed) {
                disarm();
                onClearAll();
              } else {
                arm(true);
              }
            }}
          >
            {clearArmed ? "Delete all?" : "Clear"}
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
            <ConvRow
              key={c.id}
              conv={c}
              active={c.id === currentId}
              onOpen={onOpen}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))
        )}
      </div>

      <div className="sb-bottom">
        <button onClick={onRefreshModels}>
          <IconRefresh size={13} /> Refresh models
        </button>
        <button onClick={onLogout}>
          <IconLogOut size={13} /> Sign out
        </button>
      </div>
    </aside>
  );
}
