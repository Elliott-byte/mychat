import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { Login } from "./components/Login";
import { Sidebar } from "./components/Sidebar";
import { ModelBar, isFree } from "./components/ModelBar";
import { ChatView } from "./components/ChatView";
import { ImageView } from "./components/ImageView";

export default function App() {
  const [authed, setAuthed] = useState(null); // null = 尚未确定
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

  const [streamingText, setStreamingText] = useState(null); // null = 未在生成
  const [busy, setBusy] = useState(false);
  // 出错信息单独存放,不混进 messages —— 否则会被当作助手回复带进下一轮上下文
  const [chatError, setChatError] = useState(null);
  const abortRef = useRef(null);

  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 1800);
  }, []);

  /* ---------- 启动:确认登录态 ---------- */
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

  /* ---------- 登录后加载模型与历史 ---------- */
  const loadModels = useCallback(async () => {
    setModelStatus("正在加载模型列表…");
    try {
      const d = await api.models();
      setAllModels({ chat: d.chat || [], image: d.image || [] });
      setModelStatus("");
    } catch (err) {
      setModelStatus("模型列表加载失败:" + err.message);
    }
  }, []);

  const loadConversations = useCallback(async () => {
    if (!historyEnabled) return;
    try {
      const d = await api.conversations();
      setConversations(d.conversations || []);
    } catch {
      /* 静默:侧边栏会显示空态 */
    }
  }, [historyEnabled]);

  useEffect(() => {
    if (authed) {
      loadModels();
      loadConversations();
    }
  }, [authed, loadModels, loadConversations]);

  /* ---------- 模型筛选 ---------- */
  const visibleModels = useMemo(() => {
    let list = (mode === "chat" ? allModels.chat : allModels.image) || [];
    if (freeOnly) list = list.filter(isFree);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((m) => (m.id + " " + m.name).toLowerCase().includes(q));
    return list;
  }, [allModels, mode, freeOnly, search]);

  // 当前选中的模型若已不在筛选结果里,自动落到第一个
  useEffect(() => {
    if (!visibleModels.length) return;
    if (!visibleModels.some((m) => m.id === model)) setModel(visibleModels[0].id);
  }, [visibleModels, model]);

  /* ---------- 会话操作 ---------- */
  function newChat() {
    setCurrentId(null);
    setMessages([]);
    setChatError(null);
    setMode("chat");
    setSidebarOpen(false);
  }

  async function openConv(id) {
    if (busy) return showToast("请先停止当前生成");
    try {
      const d = await api.conversation(id);
      setCurrentId(id);
      setChatError(null);
      setMessages((d.messages || []).map((m) => ({ role: m.role, content: m.content, model: m.model })));
      if (d.conversation?.model) setModel(d.conversation.model);
      setSidebarOpen(false);
    } catch {
      showToast("打开对话失败");
    }
  }

  async function renameConv(c) {
    const title = prompt("重命名对话:", c.title);
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
    if (!confirm(`删除对话「${c.title}」?此操作不可恢复。`)) return;
    await api.deleteConversation(c.id);
    setConversations((list) => list.filter((x) => x.id !== c.id));
    if (currentId === c.id) newChat();
    showToast("已删除");
  }

  async function clearAll() {
    if (!confirm(`确定删除全部 ${conversations.length} 条历史对话?此操作不可恢复。`)) return;
    await api.clearConversations();
    setConversations([]);
    newChat();
    showToast("历史已清空");
  }

  /* ---------- 发送 / 流式接收 ---------- */
  const runChat = useCallback(
    async (payload) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      setChatError(null);
      setStreamingText("");

      let full = "";
      // 每个 token 都重新解析一遍 Markdown 会卡,这里节流到约 60ms 一次。
      // 视觉上仍是流式打字,但解析次数降到十分之一。
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
        setMessages([...payload, { role: "assistant", content: full || "(模型返回了空响应)", model }]);
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
          // 已生成的部分保留下来,不白费
          if (full) setMessages([...payload, { role: "assistant", content: full, model }]);
          else setMessages(payload);
          showToast("已停止生成");
        } else {
          // 失败时保留用户那条消息(方便重试),但错误本身不进对话上下文
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
    if (!model) return showToast("请先选择模型");
    const payload = [...messages, { role: "user", content: text }];
    setMessages(payload);
    runChat(payload);
  }

  function stop() {
    abortRef.current?.abort();
  }

  function regenerate(index) {
    if (busy) return showToast("正在生成中");
    const payload = messages.slice(0, index); // 丢弃该条助手回复及其之后的内容
    setMessages(payload);
    runChat(payload);
  }

  /* ---------- 渲染 ---------- */
  if (authed === null) return <div className="boot">载入中…</div>;
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
          showToast("正在刷新模型列表…");
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
