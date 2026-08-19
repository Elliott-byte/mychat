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
      return handleApi(request, url, env, ctx).catch((err) => {
        // Log the real error; return something stable so internals (D1 messages,
        // parser errors) never reach the browser.
        console.error("unhandled API error", url.pathname, err);
        return json({ error: "Something went wrong on the server." }, 500);
      });
    }

    // Static assets: the login screen and UI only, never any secret
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
};

async function handleApi(request, url, env, ctx) {
  switch (url.pathname) {
    case "/api/login":
      return handleLogin(request, env);
    case "/api/logout":
      // GET would let any page force a logout with a bare <img> tag
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
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

  // SameSite=Strict is not enough on workers.dev: every Worker under the same
  // account subdomain is same-site, and a top-level form POST needs no preflight.
  // Same-origin fetch always sends Origin on state-changing methods.
  if (!["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(request.url).origin) {
      return json({ error: "Bad origin" }, 403);
    }
  }

  // Everything below requires a session
  if (!(await isAuthed(request, env))) {
    return json({ error: "Not signed in" }, 401);
  }

  if (url.pathname === "/api/models") return handleModels(request, env, ctx);
  if (url.pathname === "/api/chat") return handleChat(request, env, ctx);

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
  // Prefer a dedicated SESSION_SECRET. Deriving the key from the master password
  // means anyone who obtains one cookie can crack the password offline — the
  // signed payload gives them a known plaintext/MAC pair, and a single
  // unstretched SHA-256 is billions of guesses per second on a GPU.
  // Falling back to the password keeps existing deployments working.
  const material = new TextEncoder().encode(
    env.SESSION_SECRET
      ? env.SESSION_SECRET + "|mychat-session-v2"
      : env.MASTER_PASSWORD + "|mychat-session-v1"
  );
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
  // Refuse an oversized body before parsing it — no legitimate password is
  // anywhere near this, and parsing megabytes costs CPU we don't have.
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > 4096) return json({ error: "Request too large" }, 413);

  const { password } = await request.json().catch(() => ({}));
  if (typeof password !== "string" || password.length > 1024) {
    await sleep(1000);
    return json({ error: "Incorrect password" }, 401);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (await isLockedOut(env, ip)) {
    return json(
      { error: "Too many failed attempts. Try again in a few minutes." },
      429
    );
  }

  if (!(await constantTimeEqual(password, env.MASTER_PASSWORD))) {
    await recordFailure(env, ip);
    await sleep(1000); // slows a sequential attacker; the lockout handles parallel ones
    return json({ error: "Incorrect password" }, 401);
  }
  await clearFailures(env, ip);
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

// Compare digests, not the raw strings. A byte-by-byte loop is O(len(input)),
// so an unauthenticated request with a multi-megabyte password field could burn
// far more than the 10ms CPU budget. Hashing first makes the comparison always
// exactly 32 bytes regardless of input size, and removes the length oracle.
async function constantTimeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < 32; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/* ---------------- Login rate limiting ---------------- */

// The 1-second delay on a wrong password does nothing against a parallel
// attacker: Workers invocations are independent, so 500 concurrent guesses all
// sleep at once and still get 500 tries a second. The counter has to be shared,
// so it lives in D1. Without a D1 binding this degrades to no limiting, which
// is why the README also recommends a WAF rate-limit rule.
const MAX_FAILURES = 8;
const LOCKOUT_WINDOW_MS = 10 * 60 * 1000;

async function isLockedOut(env, ip) {
  if (!env.DB) return false;
  try {
    await ensureSchema(env);
    const row = await env.DB.prepare(`SELECT count, first_at FROM login_failures WHERE ip = ?`)
      .bind(ip)
      .first();
    if (!row) return false;
    if (Date.now() - row.first_at > LOCKOUT_WINDOW_MS) {
      await env.DB.prepare(`DELETE FROM login_failures WHERE ip = ?`).bind(ip).run();
      return false;
    }
    return row.count >= MAX_FAILURES;
  } catch {
    return false; // never let a storage problem lock you out of your own site
  }
}

async function recordFailure(env, ip) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO login_failures (ip, count, first_at) VALUES (?1, 1, ?2)
       ON CONFLICT(ip) DO UPDATE SET
         count = CASE WHEN ?2 - first_at > ?3 THEN 1 ELSE count + 1 END,
         first_at = CASE WHEN ?2 - first_at > ?3 THEN ?2 ELSE first_at END`
    )
      .bind(ip, Date.now(), LOCKOUT_WINDOW_MS)
      .run();
  } catch {
    /* best effort */
  }
}

async function clearFailures(env, ip) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(`DELETE FROM login_failures WHERE ip = ?`).bind(ip).run();
  } catch {
    /* best effort */
  }
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
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS login_failures (
         ip TEXT PRIMARY KEY,
         count INTEGER NOT NULL,
         first_at INTEGER NOT NULL
       )`
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
    return json({ conversations: results || [] }, 200, { "Cache-Control": "no-store" });
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
    const messages = (results || []).map((m) => ({
      ...m,
      content: deserializeContent(m.content),
    }));
    return json({ conversation: conv, messages }, 200, { "Cache-Control": "no-store" });
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

function makeTitle(content) {
  // content may be a plain string or a multimodal array
  const text = Array.isArray(content)
    ? content.filter((p) => p?.type === "text").map((p) => p.text).join(" ")
    : content;
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t) return t.length > 40 ? t.slice(0, 40) + "…" : t;
  return Array.isArray(content) && content.some((p) => p?.type === "image_url")
    ? "Image conversation"
    : "New chat";
}

// D1 caps a row at 2 MB, so nothing oversized may ever reach .bind(). The
// message still goes to the model in full — only the stored copy is reduced.
// Note this counts BYTES, not UTF-16 units: CJK text is 3 bytes per character,
// so a character-based limit would let a ~3.6 MB row through.
const MAX_STORED_BYTES = 1_200_000;
const encoder = new TextEncoder();
const byteLength = (str) => encoder.encode(str).length;

function serializeContent(content) {
  const multimodal = Array.isArray(content);

  if (!multimodal) {
    const text = typeof content === "string" ? content : String(content ?? "");
    return byteLength(text) <= MAX_STORED_BYTES ? text : truncate(text);
  }

  let json = JSON.stringify(content);
  if (byteLength(json) <= MAX_STORED_BYTES) return markMultimodal(json);

  // First try dropping just the images — usually they are the bulk of it.
  json = JSON.stringify(
    content.map((p) =>
      p?.type === "image_url"
        ? { type: "text", text: "[image omitted: too large to store]" }
        : p
    )
  );
  if (byteLength(json) <= MAX_STORED_BYTES) return markMultimodal(json);

  // Still too big (a giant pasted transcript). Truncating JSON would leave
  // unparseable content behind the marker, so store the text parts as plain text.
  const text = content
    .filter((p) => p?.type === "text")
    .map((p) => p.text)
    .join("\n\n");
  return truncate(text);
}

// Truncate on a byte boundary. Decoding without {stream:true} turns a severed
// multi-byte sequence into U+FFFD rather than throwing.
function truncate(text) {
  const clipped = encoder.encode(text).slice(0, MAX_STORED_BYTES - 32);
  return new TextDecoder().decode(clipped) + "\n[truncated]";
}

// Multimodal content is stored with an explicit marker rather than being
// sniffed for on read. Without it, a reply that simply *is* a JSON array — very
// common when you ask a model for JSON — gets reinterpreted as content parts:
// it renders blank, and a model could forge an image_url part pointing anywhere.
const MULTIMODAL_PREFIX = "\u0001mm:";

function markMultimodal(json) {
  return MULTIMODAL_PREFIX + json;
}

function deserializeContent(value) {
  if (typeof value !== "string") return value;
  if (value.startsWith(MULTIMODAL_PREFIX)) {
    try {
      const parsed = JSON.parse(value.slice(MULTIMODAL_PREFIX.length));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* truncated or corrupt — fall through and show the raw text */
    }
    return value.slice(MULTIMODAL_PREFIX.length);
  }
  // Rows written before the marker existed: only treat as multimodal when every
  // element really looks like a content part.
  if (value[0] === "[") {
    try {
      const parsed = JSON.parse(value);
      const looksLikeParts =
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        parsed.every((p) => p && (p.type === "text" || p.type === "image_url"));
      if (looksLikeParts) return parsed;
    } catch {
      /* plain text that happens to start with [ */
    }
  }
  return value;
}

async function saveMessage(env, convId, role, content, model) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO messages (conversation_id, role, content, model, created_at) VALUES (?, ?, ?, ?, ?)`
    ).bind(convId, role, serializeContent(content), model || null, now),
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
  const cacheKey = new Request(new URL("/api/models-v1", request.url).toString());
  // "Refresh models" must be able to bypass the cache, otherwise the button and
  // the "model not found, refresh the list" advice would both be no-ops.
  const bypass = new URL(request.url).searchParams.has("refresh");
  if (!bypass) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const resp = await fetch(`${apiBase(env)}/models`, {
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
  });
  if (!resp.ok) return json({ error: `Could not fetch the OpenRouter model list (${resp.status})` }, 502);
  const { data } = (await resp.json().catch(() => ({}))) || {};

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
    "Cache-Control": `private, max-age=${MODELS_CACHE_SECONDS}`,
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
  // When the chosen model can emit images, ask for them alongside text so the
  // same chat turn can return an edited or generated picture.
  const payload = { model, messages: body.messages, stream: true };
  if (body.wantsImage) payload.modalities = ["image", "text"];

  let upstream;
  try {
    upstream = await fetchUpstreamWithRetry(env, request, payload);
  } catch (err) {
    if (err instanceof UpstreamUnreachable) {
      return json({ error: err.message + ". Check your connection and retry.", retryable: true }, 502);
    }
    throw err;
  }

  if (!upstream.ok) {
    const raw = await upstream.text();
    const e = describeUpstreamError(upstream.status, raw);
    return json({ error: e.message, code: upstream.status, retryable: e.retryable }, 502);
  }

  // Upstream is ready: now create or reuse the conversation and save the message.
  // Every D1 call here is best-effort — the model has already answered, so a
  // storage problem must never turn into a failed chat. On error we simply stop
  // persisting this turn and stream it through unsaved.
  let convId = typeof body.conversationId === "string" ? body.conversationId : null;
  let createdNew = false;
  if (env.DB) {
    try {
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

      // The client sends the conversation exactly as it should be. Trim any stored
      // messages beyond that prefix before appending, so Regenerate and Retry
      // rewrite the tail instead of piling up duplicates.
      const keep = Math.max(0, body.messages.length - 1);
      await env.DB.prepare(
        `DELETE FROM messages
          WHERE conversation_id = ?1
            AND id NOT IN (
              SELECT id FROM messages WHERE conversation_id = ?1 ORDER BY id ASC LIMIT ?2
            )`
      )
        .bind(convId, keep)
        .run();

      // Pass content through as-is: it may be a string or a multimodal array, and
      // serializeContent() handles both. Coercing with String() here would turn an
      // array into "[object Object]".
      if (lastUser) await saveMessage(env, convId, "user", lastUser.content, model);
    } catch (err) {
      console.error("history write failed; streaming without persistence", err);
      convId = null;
    }
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

  // Split the stream: one branch goes to the browser, the other is drained in
  // the background and persisted. Doing it this way — rather than persisting
  // from a TransformStream's flush/cancel — means the reply is saved even when
  // the client goes away mid-generation (Stop button, closed tab), and a failed
  // D1 write can never surface as a broken response.
  const [toClient, toStore] = upstream.body.tee();

  ctx.waitUntil(
    (async () => {
      const decoder = new TextDecoder();
      let acc = "";
      const accImages = [];
      let buf = "";

      const consume = (line) => {
        if (!line.startsWith("data:")) return;
        const payload = line.slice(5).trim(); // the spec allows no space after "data:"
        if (!payload || payload === "[DONE]") return;
        let parsed;
        try {
          parsed = JSON.parse(payload);
        } catch {
          return; // keep-alive or other non-JSON line
        }
        const delta = parsed?.choices?.[0]?.delta;
        if (typeof delta?.content === "string") acc += delta.content;
        for (const img of delta?.images || []) {
          const url = img?.image_url?.url;
          if (url) accImages.push(url);
        }
      };

      const reader = toStore.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";
          for (const line of lines) consume(line);
        }
        buf += decoder.decode(); // flush any dangling multi-byte sequence
        if (buf) consume(buf);
      } catch (err) {
        // Upstream died mid-stream; keep whatever arrived before that
        console.error("upstream stream ended early", err);
      }

      if (!acc && !accImages.length) return;
      const content = accImages.length
        ? [
            ...(acc ? [{ type: "text", text: acc }] : []),
            ...accImages.map((url) => ({ type: "image_url", image_url: { url } })),
          ]
        : acc;
      try {
        await saveMessage(env, convId, "assistant", content, model);
      } catch (err) {
        console.error("failed to persist assistant reply", err);
      }
    })()
  );

  return new Response(toClient, { headers });
}

/* ---------------- Helpers ---------------- */

// img-src is the load-bearing directive here. A model can emit an image URL —
// either streamed back as image_url, or as Markdown — and the browser fetches it
// on render with no click. That is the standard prompt-injection exfiltration
// channel: injected text tells the model to encode the conversation into a URL
// on an attacker's host. Allowing only 'self' and data: keeps legitimate
// generated images (which arrive as data URLs) working while killing beacons.
function withSecurityHeaders(res) {
  const headers = new Headers(res.headers);
  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; ")
  );
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// OpenRouter endpoint. Point OPENROUTER_BASE_URL at a mirror or proxy if needed.
function apiBase(env) {
  return (env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
}

class UpstreamUnreachable extends Error {
  constructor(cause) {
    super(`Could not reach OpenRouter: ${cause?.message || cause}`);
    this.name = "UpstreamUnreachable";
  }
}

/**
 * Call upstream, retrying transient failures.
 * Free models draw on a pool shared by every OpenRouter user, so 429s are
 * common but usually clear within seconds. Backing off a few times keeps a
 * momentary blip from surfacing to the user as an error.
 */
async function fetchUpstreamWithRetry(env, request, payload, attempts = 3) {
  const backoffMs = [700, 1800]; // waits after the 1st and 2nd failure
  // Serialise once: the body is identical on every attempt, and for a message
  // with image attachments this is megabytes of work against a 10ms CPU budget.
  const body = JSON.stringify(payload);
  let resp;
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      resp = await fetch(`${apiBase(env)}/chat/completions`, {
        method: "POST",
        headers: openrouterHeaders(env, request),
        body,
      });
    } catch (err) {
      // A dropped connection is exactly the transient failure this retries for,
      // so it must not escape the loop as an unhandled 500.
      lastError = err;
      if (i === attempts - 1) throw new UpstreamUnreachable(lastError);
      await sleep(backoffMs[i] ?? 1800);
      continue;
    }
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
// OPENROUTER_BASE_URL can be pointed at a mirror; if that mirror echoes the
// request back, the Bearer token would travel into the browser through the
// error text. Strip anything that looks like a key before returning it.
function redactKeys(text) {
  return String(text).replace(/sk-[A-Za-z0-9_\-]{8,}/g, "sk-***");
}

function describeUpstreamError(status, rawText) {
  rawText = redactKeys(rawText);
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
