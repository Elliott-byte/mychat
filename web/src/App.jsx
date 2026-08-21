import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { Login } from "./components/Login";
import { Sidebar } from "./components/Sidebar";
import { ModelBar, isFree } from "./components/ModelBar";
import { ChatView } from "./components/ChatView";

// Remember the few choices that would otherwise reset on every page load.
// Nothing sensitive goes in here — just a model id and a checkbox.
const PREFS_KEY = "mychat.prefs";
function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

/**
 * Keep the app exactly as tall as the browser is actually showing.
 *
 * `100dvh` already handles a collapsing URL bar, but it knows nothing about the
 * software keyboard: on iOS the layout viewport keeps its full height and the
 * keyboard is simply drawn on top, so the composer ends up underneath it. Only
 * visualViewport reports the height that is genuinely visible.
 *
 * Deliberately touch-only — on a desktop the same event fires on pinch-zoom,
 * where shrinking the app to the zoomed region is exactly the wrong response.
 */
function useViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv || !window.matchMedia("(pointer: coarse)").matches) return;
    const root = document.documentElement;

    const apply = () => {
      root.style.setProperty("--app-h", vv.height + "px");
      root.classList.add("vv-h");
      // A shortfall this big is the keyboard, not the URL bar sliding away.
      document.body.classList.toggle("kb-open", window.innerHeight - vv.height > 120);
      // iOS scrolls the *layout* viewport to reveal a focused field. Since the
      // app is already sized to fit, that shove only pushes the header off the
      // top of the screen; undo it.
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };

    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      root.classList.remove("vv-h");
      root.style.removeProperty("--app-h");
      document.body.classList.remove("kb-open");
    };
  }, []);
}

export default function App() {
  // useRef(loadPrefs()) would re-read localStorage on every render and throw the
  // result away; read it once instead.
  const prefsRef = useRef(null);
  if (prefsRef.current === null) prefsRef.current = loadPrefs();
  const prefs = prefsRef.current;
  const [authed, setAuthed] = useState(null); // null = not determined yet
  const [historyEnabled, setHistoryEnabled] = useState(false);

  const [allModels, setAllModels] = useState({ chat: [], image: [] });
  const [modelStatus, setModelStatus] = useState("");
  const [model, setModel] = useState(prefs.model || "");
  const [search, setSearch] = useState("");
  const [freeOnly, setFreeOnly] = useState(Boolean(prefs.freeOnly));

  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [conversations, setConversations] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [messages, setMessages] = useState([]);

  const [streamingText, setStreamingText] = useState(null); // null = not generating
  const [busy, setBusy] = useState(false);
  // Errors live outside `messages`. Folding them in would send the error text
  // back to the model as if it were an assistant turn.
  const [chatError, setChatError] = useState(null);
  const abortRef = useRef(null);

  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 1800);
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  useViewportHeight();

  /* ---------- Startup: determine session state ---------- */
  useEffect(() => {
    api
      .me()
      .then((d) => {
        if (d?.ok) {
          setHistoryEnabled(Boolean(d.history));
          setAuthed(true);
        } else {
          setAuthed(false);
        }
      })
      // A failed check must land on the login screen, not a permanent "Loading…"
      .catch(() => setAuthed(false));
  }, []);

  /* ---------- After login: load models and history ---------- */
  const loadModels = useCallback(async ({ refresh = false } = {}) => {
    setModelStatus("Loading models…");
    try {
      const d = await api.models({ refresh });
      setAllModels({ chat: d.chat || [], image: d.image || [] });
      setModelStatus("");
    } catch (err) {
      setModelStatus("Could not load models: " + err.message);
    }
  }, []);

  const loadConversations = useCallback(async () => {
    if (!historyEnabled) return;
    try {
      const d = await api.conversations();
      setConversations(d.conversations || []);
    } catch {
      /* Silent: the sidebar shows its empty state */
    }
  }, [historyEnabled]);

  useEffect(() => {
    if (authed) {
      loadModels();
      loadConversations();
    }
  }, [authed, loadModels, loadConversations]);

  /* ---------- Model filtering ---------- */
  // One list for everything: a model is usable if it outputs text or images.
  // Capability badges (📷 reads images, 🎨 returns them) replace the old tabs.
  const visibleModels = useMemo(() => {
    const byId = new Map();
    for (const m of [...(allModels.chat || []), ...(allModels.image || [])]) {
      if (!byId.has(m.id)) byId.set(m.id, m);
    }
    let list = [...byId.values()].sort((a, b) => (b.created || 0) - (a.created || 0));
    if (freeOnly) list = list.filter(isFree);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((m) => (m.id + " " + m.name).toLowerCase().includes(q));
    return list;
  }, [allModels, freeOnly, search]);

  const current = visibleModels.find((m) => m.id === model);
  const supportsVision = Boolean(current?.input?.includes("image"));
  const supportsImageOut = Boolean(current?.output?.includes("image"));

  // Fall back only when the model genuinely doesn't exist. Checking against the
  // *filtered* list would mean typing in the search box, or ticking "free only",
  // silently switches which model you're talking to.
  const allIds = useMemo(
    () => new Set([...(allModels.chat || []), ...(allModels.image || [])].map((m) => m.id)),
    [allModels]
  );
  useEffect(() => {
    if (!allIds.size || !visibleModels.length) return;
    if (!allIds.has(model)) setModel(visibleModels[0].id);
  }, [allIds, visibleModels, model]);

  // Persist the choices worth keeping across reloads
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ model, freeOnly }));
    } catch {
      /* private mode or a full quota — not worth surfacing */
    }
  }, [model, freeOnly]);

  /* ---------- Conversation actions ---------- */
  function newChat() {
    if (busy) return showToast("Stop the current generation first");
    setCurrentId(null);
    setMessages([]);
    setChatError(null);
    setSidebarOpen(false);
  }

  async function openConv(id) {
    if (busy) return showToast("Stop the current generation first");
    try {
      const d = await api.conversation(id);
      setCurrentId(id);
      setChatError(null);
      setMessages((d.messages || []).map((m) => ({ role: m.role, content: m.content, model: m.model })));
      if (d.conversation?.model) setModel(d.conversation.model);
      setSidebarOpen(false);
    } catch {
      showToast("Could not open that conversation");
    }
  }

  // Confirmation for destructive actions happens inline in the sidebar
  // (tap to arm, tap again to commit) — no window.confirm/prompt dialogs.
  async function renameConv(c, title) {
    try {
      await api.renameConversation(c.id, title);
      setConversations((list) =>
        list.map((x) => (x.id === c.id ? { ...x, title } : x))
      );
    } catch (err) {
      showToast(err.message);
    }
  }

  async function deleteConv(c) {
    if (busy) return showToast("Stop the current generation first");
    try {
      await api.deleteConversation(c.id);
      setConversations((list) => list.filter((x) => x.id !== c.id));
      if (currentId === c.id) newChat();
      showToast("Deleted");
    } catch (err) {
      showToast(err.message || "Could not delete that conversation");
    }
  }

  async function clearAll() {
    if (busy) return showToast("Stop the current generation first");
    try {
      await api.clearConversations();
      setConversations([]);
      newChat();
      showToast("History cleared");
    } catch (err) {
      showToast(err.message || "Could not clear history");
    }
  }

  /* ---------- Sending and receiving the stream ---------- */
  const runChat = useCallback(
    async (payload) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      setChatError(null);
      setStreamingText("");

      let full = "";
      // Re-parsing Markdown on every token is slow, so updates are throttled to
      // roughly 60ms. It still reads as live typing, at a tenth of the parses.
      let flushTimer = null;
      const flush = () => {
        flushTimer = null;
        setStreamingText(full);
      };
      try {
        const { convId, isNew, images } = await api.chatStream({
          model,
          messages: payload,
          conversationId: currentId,
          wantsImage: supportsImageOut,
          signal: controller.signal,
          onDelta: (d) => {
            full += d;
            if (!flushTimer) flushTimer = setTimeout(flush, 60);
          },
        });
        clearTimeout(flushTimer);
        if (convId) setCurrentId(convId);
        // An image-only reply has no text; don't call that an empty response.
        const replyContent = images?.length
          ? [...(full ? [{ type: "text", text: full }] : []), ...images.map((url) => ({ type: "image_url", image_url: { url } }))]
          : full || "(the model returned an empty response)";
        setMessages([...payload, { role: "assistant", content: replyContent, model }]);
        if (isNew) loadConversations();
        else
          setConversations((list) => {
            const i = list.findIndex((c) => c.id === convId);
            if (i <= 0) return list;
            const copy = [...list];
            copy.unshift(copy.splice(i, 1)[0]);
            return copy;
          });
      } catch (err) {
        clearTimeout(flushTimer);
        if (err.name === "AbortError") {
          // Keep whatever was generated rather than discarding it
          if (full) setMessages([...payload, { role: "assistant", content: full, model }]);
          else setMessages(payload);
          showToast("Stopped");
        } else {
          // Keep the user's message so retrying is easy, but keep the error
          // itself out of the conversation context
          setMessages(payload);
          setChatError({ message: err.message, payload });
        }
      } finally {
        abortRef.current = null;
        setBusy(false);
        setStreamingText(null);
      }
    },
    [model, currentId, supportsImageOut, loadConversations, showToast]
  );

  function send(text, images = []) {
    if (!model) return showToast("Pick a model first");
    // Plain string when there is only text; OpenRouter's multimodal array otherwise
    const content = images.length
      ? [
          ...(text ? [{ type: "text", text }] : []),
          ...images.map((url) => ({ type: "image_url", image_url: { url } })),
        ]
      : text;
    const payload = [...messages, { role: "user", content }];
    setMessages(payload);
    runChat(payload);
  }

  function stop() {
    abortRef.current?.abort();
  }

  function regenerate(index) {
    if (busy) return showToast("Already generating");
    if (index < 1) return; // nothing to regenerate from
    const payload = messages.slice(0, index); // drop this reply and everything after it
    setMessages(payload);
    runChat(payload);
  }

  /* ---------- Render ---------- */
  if (authed === null) return <div className="boot">Loading…</div>;
  if (!authed)
    return (
      <Login
        onSuccess={() =>
          api
            .me()
            .then((d) => setHistoryEnabled(Boolean(d?.history)))
            .catch(() => {})
            .finally(() => setAuthed(true))
        }
      />
    );

  return (
    <div className="app">
      {sidebarOpen && <div className="overlay" onClick={() => setSidebarOpen(false)} />}
      <Sidebar
        open={sidebarOpen}
        conversations={conversations}
        currentId={currentId}
        historyEnabled={historyEnabled}
        onNew={newChat}
        onOpen={openConv}
        onRename={renameConv}
        onDelete={deleteConv}
        onClearAll={clearAll}
        onRefreshModels={() => {
          loadModels({ refresh: true });
          showToast("Refreshing models…");
        }}
        onLogout={async () => {
          await api.logout();
          location.reload();
        }}
      />

      <div className="main">
        <ModelBar
          models={visibleModels}
          model={model}
          onModel={setModel}
          search={search}
          onSearch={setSearch}
          freeOnly={freeOnly}
          onFreeOnly={setFreeOnly}
          onMenu={() => setSidebarOpen((v) => !v)}
          status={modelStatus}
        />
        <ChatView
          messages={messages}
          streamingText={streamingText}
          busy={busy}
          model={model}
          supportsVision={supportsVision}
          onSend={send}
          onStop={stop}
          onRegenerate={regenerate}
          onToast={showToast}
          error={chatError}
          onRetry={() => chatError && runChat(chatError.payload)}
          onDismissError={() => setChatError(null)}
        />
      </div>

      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </div>
  );
}
