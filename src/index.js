/**
 * MyChat — a personal AI playground on the Cloudflare Workers free tier.
 *
 * Security model:
 * - OPENROUTER_API_KEY and MASTER_PASSWORD live in Cloudflare Secrets and are
 *   never sent to the browser.
 * - Login issues an HMAC-SHA256 signed session cookie
 *   (HttpOnly + Secure + SameSite=Strict).
 * - Passwords are compared in constant time, and failures are delayed to slow
 *   down brute-force attempts.
 *
 * Chat history lives in D1 (binding: DB); the schema is created on first run.
 * Without a D1 binding the app still works, it just doesn't persist anything.
 */

const SESSION_COOKIE = "mychat_session";
const SESSION_TTL_SECONDS = 7 * 24 * 3600; // 7 days
const MODELS_CACHE_SECONDS = 3600; // model list is cached for an hour, then refreshes itself

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, url, env, ctx).catch((err) =>
        json({ error: String(err?.message || err) }, 500)
      );
    }

    // Static assets: the login screen and UI only, never any secret
    return env.ASSETS.fetch(request);
  },
};

async function handleApi(request, url, env, ctx) {
  switch (url.pathname) {
    case "/api/login":
      return handleLogin(request, env);
    case "/api/logout":
      return handleLogout();
    case "/api/setup":
      // Lets the login page report a missing secret after deploy (never leaks values)
      return json({
        hasPassword: Boolean(env.MASTER_PASSWORD),
        hasApiKey: Boolean(env.OPENROUTER_API_KEY),
      });
    case "/api/me":
      return (await isAuthed(request, env))
        ? json({ ok: true, history: Boolean(env.DB) })
        : json({ ok: false }, 401);
  }

  // Everything below requires a session
  if (!(await isAuthed(request, env))) {
    return json({ error: "Not signed in" }, 401);
  }

  if (url.pathname === "/api/models") return handleModels(request, env, ctx);
  if (url.pathname === "/api/chat") return handleChat(request, env, ctx);
  if (url.pathname === "/api/image") return handleImage(request, env);

  // History: /api/conversations and /api/conversations/<id>
  if (url.pathname.startsWith("/api/conversations")) {
    if (!env.DB) return json({ error: "No D1 database bound; history is unavailable" }, 503);
    await ensureSchema(env);
    const id = url.pathname.slice("/api/conversations".length).replace(/^\//, "");
    return id ? handleConversation(request, env, id) : handleConversationList(request, env);
  }

  return json({ error: "Not found" }, 404);
}

/* ---------------- Authentication ---------------- */

async function hmacKey(env) {
  // Derive the HMAC key from the master password. Good enough for a personal
  // site, and changing the password invalidates every existing session.
  const material = new TextEncoder().encode(env.MASTER_PASSWORD + "|mychat-session-v1");
  const digest = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

async function signSession(env, expiresAt) {
  const key = await hmacKey(env);
  const payload = String(expiresAt);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return payload + "." + b64url(new Uint8Array(sig));
}

async function verifySession(env, token) {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt) || Date.now() / 1000 > expiresAt) return false;
  const key = await hmacKey(env);
  let sig;
  try {
    sig = b64urlDecode(token.slice(dot + 1));
  } catch {
    return false;
  }
  return crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(payload));
}

async function isAuthed(request, env) {
  if (!env.MASTER_PASSWORD) return false;
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return verifySession(env, match ? match[1] : null);
}

async function handleLogin(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!env.MASTER_PASSWORD) {
    return json(
      {
        error:
          "MASTER_PASSWORD is not configured. Add it under Cloudflare dashboard → Workers & Pages → mychat → Settings → Variables and Secrets, or run: npx wrangler secret put MASTER_PASSWORD",
      },
      500
    );
  }
  const { password } = await request.json().catch(() => ({}));
  if (typeof password !== "string" || !timingSafeEqual(password, env.MASTER_PASSWORD)) {
    await sleep(1000); // slow down brute force
    return json({ error: "Incorrect password" }, 401);
  }
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const token = await signSession(env, expiresAt);
  return json({ ok: true }, 200, {
    "Set-Cookie": `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}`,
  });
}

function handleLogout() {
  return json({ ok: true }, 200, {
    "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`,
  });
}

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i % (ab.length || 1)] || 0) ^ (bb[i % (bb.length || 1)] || 0);
  }
  return diff === 0;
}

/* ---------------- History (D1) ---------------- */

let schemaReady = false;

async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS conversations (
         id TEXT PRIMARY KEY,
         title TEXT NOT NULL,
         model TEXT,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       )`
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS messages (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         conversation_id TEXT NOT NULL,
         role TEXT NOT NULL,
         content TEXT NOT NULL,
         model TEXT,
         created_at INTEGER NOT NULL
       )`
    ),
    env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id)`
    ),
    env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC)`
    ),
  ]);
  schemaReady = true;
}

async function handleConversationList(request, env) {
  if (request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT c.id, c.title, c.model, c.updated_at,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
         FROM conversations c
        ORDER BY c.updated_at DESC
        LIMIT 200`
    ).all();
    return json({ conversations: results || [] });
  }

  if (request.method === "DELETE") {
    // Wipe all history
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM messages`),
      env.DB.prepare(`DELETE FROM conversations`),
    ]);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
}

async function handleConversation(request, env, id) {
  if (request.method === "GET") {
    const conv = await env.DB.prepare(`SELECT * FROM conversations WHERE id = ?`).bind(id).first();
    if (!conv) return json({ error: "Conversation not found" }, 404);
    const { results } = await env.DB.prepare(
      `SELECT role, content, model, created_at FROM messages
        WHERE conversation_id = ? ORDER BY id ASC`
    )
      .bind(id)
      .all();
    return json({ conversation: conv, messages: results || [] });
  }

  if (request.method === "PATCH") {
    const { title } = await request.json().catch(() => ({}));
    if (typeof title !== "string" || !title.trim()) {
      return json({ error: "Title cannot be empty" }, 400);
    }
    await env.DB.prepare(`UPDATE conversations SET title = ? WHERE id = ?`)
      .bind(title.trim().slice(0, 200), id)
      .run();
    return json({ ok: true });
  }

  if (request.method === "DELETE") {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM messages WHERE conversation_id = ?`).bind(id),
      env.DB.prepare(`DELETE FROM conversations WHERE id = ?`).bind(id),
    ]);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
}

function makeTitle(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return (t.length > 40 ? t.slice(0, 40) + "…" : t) || "New chat";
}

async function saveMessage(env, convId, role, content, model) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO messages (conversation_id, role, content, model, created_at) VALUES (?, ?, ?, ?, ?)`
    ).bind(convId, role, content, model || null, now),
    env.DB.prepare(`UPDATE conversations SET updated_at = ?, model = ? WHERE id = ?`).bind(
      now,
      model || null,
      convId
    ),
  ]);
}

/* ---------------- Model list (self-updating) ---------------- */

async function handleModels(request, env, ctx) {
  const cache = caches.default;
  const cacheKey = new Request("https://mychat.internal/api/models-v1");
  let cached = await cache.match(cacheKey);
  if (cached) return new Response(cached.body, cached);

  const resp = await fetch(`${apiBase(env)}/models`, {
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
  });
  if (!resp.ok) return json({ error: `Could not fetch the OpenRouter model list (${resp.status})` }, 502);
  const { data } = await resp.json();

  const models = (data || [])
    .map((m) => ({
      id: m.id,
      name: m.name,
      created: m.created,
      context: m.context_length,
      input: m.architecture?.input_modalities || [],
      output: m.architecture?.output_modalities || [],
      promptPrice: Number(m.pricing?.prompt ?? 0),
      completionPrice: Number(m.pricing?.completion ?? 0),
      imagePrice: Number(m.pricing?.image ?? 0),
    }))
    .sort((a, b) => (b.created || 0) - (a.created || 0)); // newest models first

  const chat = models.filter((m) => m.output.includes("text"));
  const image = models.filter((m) => m.output.includes("image"));

  const out = json({ updatedAt: Date.now(), chat, image }, 200, {
    "Cache-Control": `public, max-age=${MODELS_CACHE_SECONDS}`,
  });
  ctx.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}

/* ---------------- Chat (streaming + persistence) ---------------- */

async function handleChat(request, env, ctx) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await request.json().catch(() => null);
  if (!body?.model || !Array.isArray(body?.messages) || !body.messages.length) {
    return json({ error: "Bad request: model and messages are required" }, 400);
  }

  const model = body.model;
  const lastUser = [...body.messages].reverse().find((m) => m.role === "user");

  // Call upstream first and only touch the database once it succeeds.
  // Otherwise every rate-limited attempt leaves an orphaned user message
  // in the database with no reply attached to it.
  const upstream = await fetchUpstreamWithRetry(env, request, {
    model,
    messages: body.messages,
    stream: true,
  });

  if (!upstream.ok) {
    const raw = await upstream.text();
    const e = describeUpstreamError(upstream.status, raw);
    return json({ error: e.message, code: upstream.status, retryable: e.retryable }, 502);
  }

  // Upstream is ready: now create or reuse the conversation and save the message
  let convId = body.conversationId || null;
  let createdNew = false;
  if (env.DB) {
    await ensureSchema(env);
    if (convId) {
      const exists = await env.DB.prepare(`SELECT id FROM conversations WHERE id = ?`)
        .bind(convId)
        .first();
      if (!exists) convId = null;
    }
    if (!convId) {
      convId = crypto.randomUUID();
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
      )
        .bind(convId, makeTitle(lastUser?.content), model, now, now)
        .run();
      createdNew = true;
    }
    if (lastUser) await saveMessage(env, convId, "user", String(lastUser.content), model);
  }

  const headers = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
  };
  if (convId) {
    headers["X-Conversation-Id"] = convId;
    headers["X-Conversation-New"] = createdNew ? "1" : "0";
    headers["Access-Control-Expose-Headers"] = "X-Conversation-Id, X-Conversation-New";
  }

  // Forward the stream while accumulating the reply, then persist it once done
  if (!env.DB || !convId) {
    return new Response(upstream.body, { headers });
  }

  const decoder = new TextDecoder();
  let acc = "";
  let buf = "";
  const collector = new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk); // pass through untouched so the UI stays live
      buf += decoder.decode(chunk, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
          if (delta) acc += delta;
        } catch {
          /* ignore non-JSON keep-alive lines */
        }
      }
    },
    async flush() {
      if (acc) await saveMessage(env, convId, "assistant", acc, model);
    },
  });

  return new Response(upstream.body.pipeThrough(collector), { headers });
}

/* ---------------- Image generation ---------------- */

async function handleImage(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await request.json().catch(() => null);
  if (!body?.model || !body?.prompt) {
    return json({ error: "Bad request: model and prompt are required" }, 400);
  }

  // Image-to-image: attach the user's uploaded images as data URLs
  const content = body.images?.length
    ? [
        { type: "text", text: body.prompt },
        ...body.images.map((url) => ({ type: "image_url", image_url: { url } })),
      ]
    : body.prompt;

  const upstream = await fetch(`${apiBase(env)}/chat/completions`, {
    method: "POST",
    headers: openrouterHeaders(env, request),
    body: JSON.stringify({
      model: body.model,
      messages: [{ role: "user", content }],
      modalities: ["image", "text"],
    }),
  });

  const data = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    const msg = data?.error?.message || JSON.stringify(data)?.slice(0, 500);
    return json({ error: `OpenRouter error (${upstream.status}): ${msg}` }, 502);
  }

  const message = data?.choices?.[0]?.message;
  const images = (message?.images || []).map((img) => img?.image_url?.url).filter(Boolean);
  return json({ images, text: message?.content || "" });
}

/* ---------------- Helpers ---------------- */

// OpenRouter endpoint. Point OPENROUTER_BASE_URL at a mirror or proxy if needed.
function apiBase(env) {
  return (env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
}

/**
 * Call upstream, retrying transient failures.
 * Free models draw on a pool shared by every OpenRouter user, so 429s are
 * common but usually clear within seconds. Backing off a few times keeps a
 * momentary blip from surfacing to the user as an error.
 */
async function fetchUpstreamWithRetry(env, request, payload, attempts = 3) {
  const backoffMs = [700, 1800]; // waits after the 1st and 2nd failure
  let resp;
  for (let i = 0; i < attempts; i++) {
    resp = await fetch(`${apiBase(env)}/chat/completions`, {
      method: "POST",
      headers: openrouterHeaders(env, request),
      body: JSON.stringify(payload),
    });
    if (resp.ok) return resp;
    // Retry only transient failures. A 4xx other than 429 means a bad request
    // or bad config, and retrying it would never help.
    const transient = resp.status === 429 || resp.status === 502 || resp.status === 503;
    if (!transient || i === attempts - 1) return resp;
    await resp.body?.cancel(); // release the unconsumed body
    await sleep(backoffMs[i] ?? 1800);
  }
  return resp;
}

/** Turn OpenRouter's raw error JSON into one plain-English sentence */
function describeUpstreamError(status, rawText) {
  let data = null;
  try {
    data = JSON.parse(rawText);
  } catch {
    /* not JSON; fall back to the raw text */
  }
  const inner = data?.error || {};
  const meta = inner.metadata || {};
  const provider = meta.provider_name ? ` (provider: ${meta.provider_name})` : "";

  if (status === 429) {
    const shared = meta.limit_source === "upstream_provider_shared_pool";
    return {
      retryable: true,
      message: shared
        ? `This free model's shared quota is rate-limited right now${provider}. Every OpenRouter user draws on the same pool, so this is not a problem with your setup.\n\nYou can wait a moment and retry, switch to a different free model, or add credit to OpenRouter and untick "Free only" to use paid models (usually a fraction of a cent per message).`
        : `Too many requests, so you have been rate-limited${provider}. Try again shortly.`,
    };
  }
  if (status === 401 || status === 403) {
    return {
      retryable: false,
      message: `OpenRouter rejected this API key (${status}). Check that OPENROUTER_API_KEY is correct and has not expired.`,
    };
  }
  if (status === 402) {
    return {
      retryable: false,
      message: "Your OpenRouter account is out of credit. Add funds, or switch to a model ending in `:free`.",
    };
  }
  if (status === 404) {
    return {
      retryable: false,
      message: "Model not found — it may have been retired. Click \"⟳ Refresh models\" at the bottom left to pull the current list.",
    };
  }
  if (status >= 500) {
    return { retryable: true, message: `Upstream is temporarily unavailable (${status})${provider}. Try again shortly.` };
  }
  const detail = inner.message || rawText.slice(0, 300) || "Unknown error";
  return { retryable: false, message: `OpenRouter error (${status}): ${detail}` };
}

function openrouterHeaders(env, request) {
  return {
    Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
    "HTTP-Referer": new URL(request.url).origin,
    "X-Title": "MyChat",
  };
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
