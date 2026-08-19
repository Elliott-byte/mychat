/**
 * MyChat — 个人 AI 试用站(Cloudflare Workers 免费版)
 *
 * 安全设计:
 * - OPENROUTER_API_KEY 与 MASTER_PASSWORD 均存放于 Cloudflare Secrets,
 *   永远不会发送到浏览器端。
 * - 登录后签发 HMAC-SHA256 签名的会话 Cookie(HttpOnly + Secure + SameSite=Strict)。
 * - 密码比较使用恒定时间算法,失败时延迟响应以减缓暴力破解。
 */

const SESSION_COOKIE = "mychat_session";
const SESSION_TTL_SECONDS = 7 * 24 * 3600; // 7 天
const MODELS_CACHE_SECONDS = 3600; // 模型列表缓存 1 小时,自动更新

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, url, env, ctx).catch((err) =>
        json({ error: String(err?.message || err) }, 500)
      );
    }

    // 静态页面(仅登录界面与 UI,不含任何密钥)
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
      // 供登录页检测部署后是否漏配密钥(不泄露任何密钥内容)
      return json({
        hasPassword: Boolean(env.MASTER_PASSWORD),
        hasApiKey: Boolean(env.OPENROUTER_API_KEY),
      });
    case "/api/me":
      return (await isAuthed(request, env))
        ? json({ ok: true })
        : json({ ok: false }, 401);
  }

  // 以下端点全部需要登录
  if (!(await isAuthed(request, env))) {
    return json({ error: "未登录" }, 401);
  }

  switch (url.pathname) {
    case "/api/models":
      return handleModels(request, env, ctx);
    case "/api/chat":
      return handleChat(request, env);
    case "/api/image":
      return handleImage(request, env);
    default:
      return json({ error: "Not found" }, 404);
  }
}

/* ---------------- 认证 ---------------- */

async function hmacKey(env) {
  // 用主密码派生 HMAC 密钥(个人站点足够;换密码 = 所有会话失效)
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
          "尚未配置 MASTER_PASSWORD。请到 Cloudflare 控制台 → Workers & Pages → mychat → Settings → Variables and Secrets 添加,或运行 npx wrangler secret put MASTER_PASSWORD",
      },
      500
    );
  }
  const { password } = await request.json().catch(() => ({}));
  if (typeof password !== "string" || !timingSafeEqual(password, env.MASTER_PASSWORD)) {
    await sleep(1000); // 减缓暴力破解
    return json({ error: "密码错误" }, 401);
  }
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const token = await signSession(env, expiresAt);
  return json(
    { ok: true },
    200,
    {
      "Set-Cookie": `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}`,
    }
  );
}

function handleLogout() {
  return json(
    { ok: true },
    200,
    { "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0` }
  );
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

/* ---------------- 模型列表(自动更新) ---------------- */

async function handleModels(request, env, ctx) {
  const cache = caches.default;
  const cacheKey = new Request("https://mychat.internal/api/models-v1");
  let cached = await cache.match(cacheKey);
  if (cached) return withCors(cached);

  const resp = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
  });
  if (!resp.ok) return json({ error: `OpenRouter 模型列表获取失败 (${resp.status})` }, 502);
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
    .sort((a, b) => (b.created || 0) - (a.created || 0)); // 最新模型排最前

  const chat = models.filter((m) => m.output.includes("text"));
  const image = models.filter((m) => m.output.includes("image"));

  const out = json({ updatedAt: Date.now(), chat, image }, 200, {
    "Cache-Control": `public, max-age=${MODELS_CACHE_SECONDS}`,
  });
  ctx.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}

/* ---------------- 聊天(流式) ---------------- */

async function handleChat(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await request.json().catch(() => null);
  if (!body?.model || !Array.isArray(body?.messages)) {
    return json({ error: "参数错误:需要 model 和 messages" }, 400);
  }

  const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: openrouterHeaders(env, request),
    body: JSON.stringify({
      model: body.model,
      messages: body.messages,
      stream: true,
    }),
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    return json({ error: `OpenRouter 错误 (${upstream.status}): ${text.slice(0, 500)}` }, 502);
  }

  // 直接透传 SSE 流
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}

/* ---------------- 图片生成 ---------------- */

async function handleImage(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await request.json().catch(() => null);
  if (!body?.model || !body?.prompt) {
    return json({ error: "参数错误:需要 model 和 prompt" }, 400);
  }

  // 支持图生图:附带用户上传的图片(data URL)
  const content = body.images?.length
    ? [
        { type: "text", text: body.prompt },
        ...body.images.map((url) => ({ type: "image_url", image_url: { url } })),
      ]
    : body.prompt;

  const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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
    return json({ error: `OpenRouter 错误 (${upstream.status}): ${msg}` }, 502);
  }

  const message = data?.choices?.[0]?.message;
  const images = (message?.images || []).map((img) => img?.image_url?.url).filter(Boolean);
  return json({ images, text: message?.content || "" });
}

/* ---------------- 工具函数 ---------------- */

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

function withCors(resp) {
  return new Response(resp.body, resp);
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
