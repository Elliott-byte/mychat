// 与 Worker 后端通信的薄封装。所有请求都带 Cookie(会话凭证),
// 密钥全在服务端,前端永远拿不到。

async function req(path, options = {}) {
  const r = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.error || `请求失败 (${r.status})`);
  }
  return r.json();
}

export const api = {
  me: () => fetch("/api/me").then((r) => (r.ok ? r.json() : null)),

  setup: () => req("/api/setup"),

  login: (password) =>
    req("/api/login", { method: "POST", body: JSON.stringify({ password }) }),

  logout: () => fetch("/api/logout", { method: "POST" }),

  models: () => req("/api/models"),

  conversations: () => req("/api/conversations"),

  conversation: (id) => req(`/api/conversations/${encodeURIComponent(id)}`),

  renameConversation: (id, title) =>
    req(`/api/conversations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),

  deleteConversation: (id) =>
    req(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" }),

  clearConversations: () => req("/api/conversations", { method: "DELETE" }),

  image: (body) => req("/api/image", { method: "POST", body: JSON.stringify(body) }),

  // 流式聊天:逐块回调,返回本轮的会话 ID
  async chatStream({ model, messages, conversationId, signal, onDelta }) {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, conversationId }),
      signal,
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error || `请求失败 (${r.status})`);
    }

    const convId = r.headers.get("X-Conversation-Id");
    const isNew = r.headers.get("X-Conversation-New") === "1";

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === "[DONE]") continue;
        let j;
        try {
          j = JSON.parse(payload);
        } catch {
          continue; // 忽略心跳等非 JSON 行
        }
        if (j.error) throw new Error(j.error.message || "上游返回错误");
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) onDelta(delta);
      }
    }
    return { convId, isNew };
  },
};
