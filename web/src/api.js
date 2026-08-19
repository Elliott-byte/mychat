// Thin client for the Worker backend. Every request carries the session cookie;
// secrets stay server-side and never reach the browser.

async function req(path, options = {}) {
  const r = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.error || `Request failed (${r.status})`);
  }
  return r.json();
}

export const api = {
  me: () => fetch("/api/me").then((r) => (r.ok ? r.json() : null)),

  setup: () => req("/api/setup"),

  login: (password) =>
    req("/api/login", { method: "POST", body: JSON.stringify({ password }) }),

  logout: () => fetch("/api/logout", { method: "POST" }),

  models: ({ refresh } = {}) => req("/api/models" + (refresh ? "?refresh=1" : "")),

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

  // Streaming chat: fires onDelta per chunk, resolves with this turn's conversation id
  async chatStream({ model, messages, conversationId, wantsImage, signal, onDelta }) {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, conversationId, wantsImage }),
      signal,
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error || `Request failed (${r.status})`);
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
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim(); // the spec allows no space after "data:"
        if (!payload || payload === "[DONE]") continue;
        let j;
        try {
          j = JSON.parse(payload);
        } catch {
          continue; // ignore keep-alive and other non-JSON lines
        }
        if (j.error) throw new Error(j.error.message || "Upstream returned an error");
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) onDelta(delta);
      }
    }
    return { convId, isNew };
  },
};
