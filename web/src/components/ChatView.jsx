import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Markdown } from "../markdown";
import { imagesFromDataTransfer, isImageFile, prepareImage } from "../lib/image";
import {
  IconAlert,
  IconArrowUp,
  IconCamera,
  IconCopy,
  IconPaperclip,
  IconRefresh,
  IconSparkles,
  IconStop,
  IconX,
} from "../icons";

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

/** "anthropic/claude-sonnet-4.5" → "claude-sonnet-4.5"; the header shows the full id. */
function shortModel(id) {
  return id ? id.split("/").pop() : "AI";
}

function Message({ role, content, model, streaming, onCopy, onRegenerate, onImageLoad }) {
  const { text, images } = partsOf(content);
  return (
    <div className={"msg " + role}>
      {role === "assistant" && (
        <div className="msg-head">
          <div className="avatar">
            <IconSparkles size={14} />
          </div>
          <div className="who" title={model}>
            {shortModel(model)}
          </div>
        </div>
      )}

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
          <button className="ibtn" onClick={onCopy} title="Copy" aria-label="Copy">
            <IconCopy size={14} />
          </button>
          {role === "assistant" && onRegenerate && (
            <button className="ibtn" onClick={onRegenerate} title="Regenerate" aria-label="Regenerate">
              <IconRefresh size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ErrorBlock({ error, onRetry, onDismiss }) {
  return (
    <div className="chat-error">
      <div className="chat-error-title">
        <IconAlert size={15} /> Generation failed
      </div>
      <div className="chat-error-body">{error.message}</div>
      <div className="chat-error-acts">
        <button className="btn-primary" onClick={onRetry}>
          Retry
        </button>
        <button className="btn-ghost" onClick={onDismiss}>
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
  const cameraRef = useRef(null);
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
    // The scrollbar only exists once the 200px cap is hit; leaving overflow on
    // all the time shows a phantom scrollbar track inside the empty composer.
    ta.style.overflowY = ta.scrollHeight > 200 ? "auto" : "hidden";
  }, [input]);

  // Opening the keyboard halves the log's height without changing any state, so
  // nothing re-runs the pin-to-bottom effect and the reply you were reading
  // slides up behind the composer. rAF, not the event itself: this listener runs
  // before App's, which is what actually shrinks the app.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const repin = () => requestAnimationFrame(scrollIfStuck);
    vv.addEventListener("resize", repin);
    return () => vv.removeEventListener("resize", repin);
    // scrollIfStuck only touches refs, so the first binding stays correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      onToast("This model cannot read images — pick one marked 📷");
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
  // The button stays live while busy (it is the Stop button) and while an image
  // is still being prepared (pressing it explains what's holding the send up).
  const canSubmit = busy || preparing > 0 || Boolean(input.trim()) || attached.length > 0;

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
              <div className="empty-icon">
                <IconSparkles size={26} />
              </div>
              <h2>MyChat</h2>
              <p>Pick a model above and start chatting.</p>
              <div className="empty-caps">
                <span>🆓 free</span>
                <span>📷 reads images</span>
                <span>🎨 returns images</span>
              </div>
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
                  aria-label="Remove image"
                  onClick={() => setAttached((list) => list.filter((_, k) => k !== i))}
                >
                  <IconX size={11} />
                </button>
                <span className="attachment-size">{Math.round(a.bytes / 1024)} KB</span>
              </div>
            ))}
            {preparing > 0 &&
              Array.from({ length: preparing }, (_, i) => (
                <div className="attachment preparing" key={"p" + i} aria-label="Preparing image" />
              ))}
          </div>
        )}

        <div className="input-bar">
          <button
            className="attach-btn"
            title={supportsVision ? "Attach an image" : "This model cannot read images"}
            aria-label="Attach an image"
            onClick={() => fileRef.current?.click()}
            disabled={!supportsVision}
          >
            <IconPaperclip size={17} />
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
          {/* `capture` opens the rear camera straight away instead of the
              photo-library sheet — the fast path for "what does this say?".
              The button is hidden unless the pointer is a fingertip. */}
          <button
            className="camera-btn"
            title={supportsVision ? "Take a photo" : "This model cannot read images"}
            aria-label="Take a photo"
            onClick={() => cameraRef.current?.click()}
            disabled={!supportsVision}
          >
            <IconCamera size={18} />
          </button>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
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
            placeholder="Message the model…"
            aria-label="Message"
          />
          <button
            className={"icon-btn" + (busy ? " stop" : "")}
            onClick={submit}
            disabled={!canSubmit}
            title={busy ? "Stop generating" : "Send"}
            aria-label={busy ? "Stop generating" : "Send"}
          >
            {busy ? <IconStop size={16} /> : <IconArrowUp size={17} />}
          </button>
        </div>
        <div className="hint">
          Enter to send · Shift+Enter for a new line · paste or drop images to attach them
        </div>
      </div>

      {dragging && <div className="drop-overlay">Drop an image to attach it</div>}
    </div>
  );
}
