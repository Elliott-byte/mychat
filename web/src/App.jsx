import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { Login } from "./components/Login";
import { Sidebar } from "./components/Sidebar";
import { ModelBar, isFree } from "./components/ModelBar";
import { ChatView } from "./components/ChatView";
import { ImageView } from "./components/ImageView";

export default function App() {
  const [authed, setAuthed] = useState(null); // null = not determined yet
  const [historyEnabled, setHistoryEnabled] = useState(false);

  const [allModels, setAllModels] = useState({ chat: [], image: [] });
  const [modelStatus, setModelStatus] = useState("");
  const [model, setModel] = useState("");
  const [search, setSearch] = useState("");
  const [freeOnly, setFreeOnly] = useState(false);

  const [mode, setMode] = useState("chat");
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

  /* ---------- Startup: determine session state ---------- */
  useEffect(() => {
    api.me().then((d) => {
      if (d?.ok) {
        setHistoryEnabled(Boolean(d.history));
        setAuthed(true);
      } else {
        setAuthed(false);
      }
    });
  }, []);

  /* ---------- After login: load models and history ---------- */
  const loadModels = useCallback(async () => {
    setModelStatus("Loading models…");
    try {
      const d = await api.models();
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
  const visibleModels = useMemo(() => {
    let list = (mode === "chat" ? allModels.chat : allModels.image) || [];
    if (freeOnly) list = list.filter(isFree);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((m) => (m.id + " " + m.name).toLowerCase().includes(q));
    return list;
  }, [allModels, mode, freeOnly, search]);

  // If the selected model is filtered out, fall back to the first visible one
  useEffect(() => {
    if (!visibleModels.length) return;
    if (!visibleModels.some((m) => m.id === model)) setModel(visibleModels[0].id);
  }, [visibleModels, model]);

  /* ---------- Conversation actions ---------- */
  function newChat() {
    setCurrentId(null);
    setMessages([]);
    setChatError(null);
    setMode("chat");
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

  async function renameConv(c) {
    const title = prompt("Rename conversation:", c.title);
    if (title === null || !title.trim()) return;
    try {
      await api.renameConversation(c.id, title);
      setConversations((list) =>
        list.map((x) => (x.id === c.id ? { ...x, title: title.trim() } : x))
      );
    } catch (err) {
      showToast(err.message);
    }
  }

  async function deleteConv(c) {
    if (!confirm(`Delete "${c.title}"? This cannot be undone.`)) return;
    await api.deleteConversation(c.id);
    setConversations((list) => list.filter((x) => x.id !== c.id));
    if (currentId === c.id) newChat();
    showToast("Deleted");
  }

  async function clearAll() {
    if (!confirm(`Delete all ${conversations.length} conversations? This cannot be undone.`)) return;
    await api.clearConversations();
    setConversations([]);
    newChat();
    showToast("History cleared");
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
        const { convId, isNew } = await api.chatStream({
          model,
          messages: payload,
          conversationId: currentId,
          signal: controller.signal,
          onDelta: (d) => {
            full += d;
            if (!flushTimer) flushTimer = setTimeout(flush, 60);
          },
        });
        clearTimeout(flushTimer);
        if (convId) setCurrentId(convId);
        setMessages([...payload, { role: "assistant", content: full || "(the model returned an empty response)", model }]);
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
    [model, currentId, loadConversations, showToast]
  );

  function send(text) {
    if (!model) return showToast("Pick a model first");
    const payload = [...messages, { role: "user", content: text }];
    setMessages(payload);
    runChat(payload);
  }

  function stop() {
    abortRef.current?.abort();
  }

  function regenerate(index) {
    if (busy) return showToast("Already generating");
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
          api.me().then((d) => {
            setHistoryEnabled(Boolean(d?.history));
            setAuthed(true);
          })
        }
      />
    );

  return (
    <div className="app">
      {sidebarOpen && <div className="overlay" onClick={() => setSidebarOpen(false)} />}
      <Sidebar
        open={sidebarOpen}
        mode={mode}
        onMode={(m) => {
          setMode(m);
          setSidebarOpen(false);
        }}
        conversations={conversations}
        currentId={currentId}
        historyEnabled={historyEnabled}
        onNew={newChat}
        onOpen={openConv}
        onRename={renameConv}
        onDelete={deleteConv}
        onClearAll={clearAll}
        onRefreshModels={() => {
          loadModels();
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
        {mode === "chat" ? (
          <ChatView
            messages={messages}
            streamingText={streamingText}
            busy={busy}
            model={model}
            onSend={send}
            onStop={stop}
            onRegenerate={regenerate}
            onToast={showToast}
            error={chatError}
            onRetry={() => chatError && runChat(chatError.payload)}
            onDismissError={() => setChatError(null)}
          />
        ) : (
          <ImageView model={model} onToast={showToast} />
        )}
      </div>

      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </div>
  );
}
