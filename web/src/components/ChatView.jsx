import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Markdown } from "../markdown";

function Message({ role, content, model, streaming, onCopy, onRegenerate }) {
  return (
    <div className={"msg " + role}>
      <div className="avatar">{role === "user" ? "🧑" : "🤖"}</div>
      <div className="body">
        <div className="who">{role === "user" ? "You" : model || "AI"}</div>
        <div className={"bubble" + (streaming ? " cursor" : "")}>
          <Markdown text={content} />
        </div>
        {!streaming && (
          <div className="msg-acts">
            <button onClick={onCopy}>📋 Copy</button>
            {role === "assistant" && onRegenerate && (
              <button onClick={onRegenerate}>↻ Regenerate</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ErrorBlock({ error, onRetry, onDismiss }) {
  return (
    <div className="chat-error">
      <div className="chat-error-title">⚠️ Generation failed</div>
      <div className="chat-error-body">{error.message}</div>
      <div className="chat-error-acts">
        <button className="btn-primary" onClick={onRetry}>
          Retry
        </button>
        <button className="small-btn" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function ChatView({
  messages,
  streamingText,
  busy,
  model,
  onSend,
  onStop,
  onRegenerate,
  onToast,
  error,
  onRetry,
  onDismissError,
}) {
  const [input, setInput] = useState("");
  const logRef = useRef(null);
  const taRef = useRef(null);
  const stickRef = useRef(true); // whether the user is pinned to the bottom

  // Only follow along when already at the bottom, so scrolling back to read
  // never yanks the view down
  useLayoutEffect(() => {
    const el = logRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, streamingText, error]);

  function onScroll() {
    const el = logRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [input]);

  function submit() {
    if (busy) {
      onStop();
      return;
    }
    const text = input.trim();
    if (!text) return;
    setInput("");
    stickRef.current = true;
    onSend(text);
  }

  const empty = messages.length === 0 && !streamingText && !error;

  return (
    <div className="pane">
      <div className="chat-log" ref={logRef} onScroll={onScroll}>
        <div className="inner">
          {empty ? (
            <div className="empty-state">
              <h2>MyChat</h2>
              <p>
                Pick a model and start chatting.
                <br />
                The model list refreshes hourly, newest first.
              </p>
            </div>
          ) : (
            <>
              {messages.map((m, i) => (
                <Message
                  key={i}
                  role={m.role}
                  content={m.content}
                  model={m.model || model}
                  onCopy={() => {
                    navigator.clipboard.writeText(m.content);
                    onToast("Copied");
                  }}
                  onRegenerate={m.role === "assistant" ? () => onRegenerate(i) : undefined}
                />
              ))}
              {streamingText !== null && (
                <Message role="assistant" content={streamingText || "…"} model={model} streaming />
              )}
              {error && !busy && (
                <ErrorBlock error={error} onRetry={onRetry} onDismiss={onDismissError} />
              )}
            </>
          )}
        </div>
      </div>

      <div className="input-wrap">
        <div className="input-bar">
          <textarea
            ref={taRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Message the model…"
          />
          <button
            className={"icon-btn" + (busy ? " stop" : "")}
            onClick={submit}
            title={busy ? "Stop generating" : "Send"}
          >
            {busy ? "■" : "↑"}
          </button>
        </div>
        <div className="hint">Enter to send · Shift+Enter for a new line · history saves automatically</div>
      </div>
    </div>
  );
}
