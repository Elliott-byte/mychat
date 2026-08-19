import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Markdown } from "../markdown";

function Message({ role, content, model, streaming, onCopy, onRegenerate }) {
  return (
    <div className={"msg " + role}>
      <div className="avatar">{role === "user" ? "🧑" : "🤖"}</div>
      <div className="body">
        <div className="who">{role === "user" ? "我" : model || "AI"}</div>
        <div className={"bubble" + (streaming ? " cursor" : "")}>
          <Markdown text={content} />
        </div>
        {!streaming && (
          <div className="msg-acts">
            <button onClick={onCopy}>📋 复制</button>
            {role === "assistant" && onRegenerate && (
              <button onClick={onRegenerate}>↻ 重新生成</button>
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
      <div className="chat-error-title">⚠️ 生成失败</div>
      <div className="chat-error-body">{error.message}</div>
      <div className="chat-error-acts">
        <button className="btn-primary" onClick={onRetry}>
          重试
        </button>
        <button className="small-btn" onClick={onDismiss}>
          关闭
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
  const stickRef = useRef(true); // 用户是否贴着底部(决定要不要自动滚动)

  // 只在用户本来就在底部时才自动跟随,避免翻看历史时被拽走
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
                选一个模型,开始对话。
                <br />
                模型列表每小时自动更新,最新的排在最前面。
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
                    onToast("已复制");
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
            placeholder="给 AI 发消息…"
          />
          <button
            className={"icon-btn" + (busy ? " stop" : "")}
            onClick={submit}
            title={busy ? "停止生成" : "发送"}
          >
            {busy ? "■" : "↑"}
          </button>
        </div>
        <div className="hint">Enter 发送 · Shift+Enter 换行 · 历史自动保存</div>
      </div>
    </div>
  );
}
