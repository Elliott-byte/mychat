import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Markdown } from "../markdown";
import { imagesFromDataTransfer, isImageFile, prepareImage } from "../lib/image";

/** Split a message's content into its text and its images. */
function partsOf(content) {
  if (typeof content === "string") return { text: content, images: [] };
  if (!Array.isArray(content)) return { text: "", images: [] };
  const text = content.filter((p) => p?.type === "text").map((p) => p.text).join("\n\n");
  const images = content
    .filter((p) => p?.type === "image_url")
    .map((p) => p.image_url?.url)
    .filter(Boolean);
  // An array we don't recognise (e.g. the user literally sent JSON) would
  // otherwise render as an empty bubble — show it rather than lose it.
  if (!text && !images.length) return { text: JSON.stringify(content), images: [] };
  return { text, images };
}

function Message({ role, content, model, streaming, onCopy, onRegenerate, onImageLoad }) {
  const { text, images } = partsOf(content);
  return (
    <div className={"msg " + role}>
      <div className="avatar">{role === "user" ? "🧑" : "🤖"}</div>
      <div className="body">
        <div className="who">{role === "user" ? "You" : model || "AI"}</div>

        {images.length > 0 && (
          <div className="msg-images">
            {images.map((src, i) => (
              <a key={i} href={src} target="_blank" rel="noopener noreferrer">
                <img src={src} alt="" onLoad={onImageLoad} />
              </a>
            ))}
          </div>
        )}

        {(text || streaming) && (
          <div className={"bubble" + (streaming ? " cursor" : "")}>
            <Markdown text={text} streaming={streaming} />
          </div>
        )}

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
  supportsVision,
  onSend,
  onStop,
  onRegenerate,
  onToast,
  error,
  onRetry,
  onDismissError,
}) {
  const [input, setInput] = useState("");
  const [attached, setAttached] = useState([]);
  const [preparing, setPreparing] = useState(0);
  const [dragging, setDragging] = useState(false);
  const logRef = useRef(null);
  const taRef = useRef(null);
  const fileRef = useRef(null);
  const stickRef = useRef(true); // whether the user is pinned to the bottom

  // Only follow along when already at the bottom, so scrolling back to read
  // never yanks the view down
  useLayoutEffect(() => {
    const el = logRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, streamingText, error, attached]);

  function onScroll() {
    const el = logRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  // Images have no height until they decode, so the layout grows after the
  // scroll already happened. Re-pin once each one lands.
  function scrollIfStuck() {
    const el = logRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }

  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [input]);

  // #20: dropping a file anywhere outside the drop zone would otherwise make the
  // browser navigate to it, losing an unsent conversation.
  useEffect(() => {
    const swallow = (e) => e.preventDefault();
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, []);

  async function addFiles(files) {
    const list = [...files].filter(isImageFile);
    if (!list.length) return;
    if (!supportsVision) {
      onToast("This model cannot read images — pick one marked 👁");
      return;
    }
    setPreparing((n) => n + list.length);
    // allSettled: one bad file must not discard the whole batch
    const results = await Promise.allSettled(list.map(prepareImage));
    setPreparing((n) => Math.max(0, n - list.length));
    const ok = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
    const failed = results.filter((r) => r.status === "rejected");
    if (ok.length) setAttached((a) => [...a, ...ok]);
    if (failed.length) onToast(failed[0].reason?.message || "Could not attach that image");
  }

  // Paste an image straight into the composer
  function onPaste(e) {
    const files = imagesFromDataTransfer(e.clipboardData);
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    addFiles(imagesFromDataTransfer(e.dataTransfer));
  }

  function submit() {
    if (busy) {
      onStop();
      return;
    }
    if (preparing > 0) {
      onToast("Still processing the image…");
      return;
    }
    const text = input.trim();
    if (!text && !attached.length) return;
    setInput("");
    const images = attached.map((a) => a.url);
    setAttached([]);
    stickRef.current = true;
    onSend(text, images);
  }

  const empty = messages.length === 0 && !streamingText && !error;

  return (
    <div
      className={"pane" + (dragging ? " dragging" : "")}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return;
        setDragging(false);
      }}
      onDrop={onDrop}
    >
      <div className="chat-log" ref={logRef} onScroll={onScroll}>
        <div className="inner">
          {empty ? (
            <div className="empty-state">
              <h2>MyChat</h2>
              <p>
                Pick a model and start chatting.
                <br />
                Paste or drop an image to send it along — models marked 👁 can read
                images, and 🎨 can return them.
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
                    navigator.clipboard.writeText(partsOf(m.content).text);
                    onToast("Copied");
                  }}
                  onRegenerate={m.role === "assistant" ? () => onRegenerate(i) : undefined}
                  onImageLoad={scrollIfStuck}
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
        {(attached.length > 0 || preparing > 0) && (
          <div className="attachments">
            {attached.map((a, i) => (
              <div className="attachment" key={i}>
                <img src={a.url} alt={a.name} />
                <button
                  className="attachment-x"
                  title="Remove"
                  onClick={() => setAttached((list) => list.filter((_, k) => k !== i))}
                >
                  ✕
                </button>
                <span className="attachment-size">{Math.round(a.bytes / 1024)} KB</span>
              </div>
            ))}
            {preparing > 0 &&
              Array.from({ length: preparing }, (_, i) => (
                <div className="attachment preparing" key={"p" + i}>
                  <span>…</span>
                </div>
              ))}
          </div>
        )}

        <div className="input-bar">
          <button
            className="attach-btn"
            title={supportsVision ? "Attach an image" : "This model cannot read images"}
            onClick={() => fileRef.current?.click()}
            disabled={!supportsVision}
          >
            📎
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <textarea
            ref={taRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              // While an IME is composing, Enter confirms the candidate — it must
              // not also send the message, or Chinese/Japanese input sends fragments.
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              supportsVision ? "Message the model, or paste an image…" : "Message the model…"
            }
          />
          <button
            className={"icon-btn" + (busy ? " stop" : "")}
            onClick={submit}
            title={busy ? "Stop generating" : "Send"}
          >
            {busy ? "■" : "↑"}
          </button>
        </div>
        <div className="hint">
          Enter to send · Shift+Enter for a new line · paste or drop images · history saves
          automatically
        </div>
      </div>

      {dragging && <div className="drop-overlay">Drop an image to attach it</div>}
    </div>
  );
}
