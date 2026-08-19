<div align="right">

[简体中文](README.zh-CN.md) · **English**

</div>

# MyChat — Your Private AI Playground

A personal AI playground running on Cloudflare Workers' free tier, calling the latest chat and image models through OpenRouter.

> The interface and source are in English; this documentation is available in both English and Chinese.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Elliott-byte/mychat)

> 👆 **Click the button to deploy in one step.** Cloudflare will prompt you for
> `OPENROUTER_API_KEY` and `MASTER_PASSWORD` during setup, then build and go live automatically — no command line needed.

---

## Features

- **Entirely free infrastructure** — Cloudflare Workers free tier (100,000 requests/day) plus static asset hosting. No paid plan required.
- **Master password protection** — Only you can use it. Every API route returns 401 without a valid session.
- **Keys stay secret** — Your OpenRouter API key lives in a Cloudflare Secret, is used only server-side, and never appears in page source or the browser.
- **Models update themselves** — The model list is fetched live from OpenRouter and sorted newest-first, so new releases show up at the top without any code changes.
- **ChatGPT-style interface** — Conversation history in a left sidebar, streaming output, stop generation, regenerate, one-click copy.
- **History stored in the cloud** — Conversations live in Cloudflare D1 (also free), so switching devices shows you the same history.
- **Images live in the chat** — paste, drop, or attach an image without switching screens. Models that read images are marked 👁, models that return them 🎨.
- **React frontend** — React 19 + Vite, component-based.
- **Full Markdown** — headings, lists, tables, blockquotes, task lists; code blocks get syntax highlighting and a copy button.

---

## 1. One-click deploy (recommended)

Click the **Deploy to Cloudflare** button above, or visit:

<https://deploy.workers.cloudflare.com/?url=https://github.com/Elliott-byte/mychat>

Cloudflare will:

1. Ask you to sign in to Cloudflare (free to register if you don't have an account)
2. Fork this repository into your GitHub account
3. **Prompt you for two secrets** — this is the important step:
   - `OPENROUTER_API_KEY` — create one at https://openrouter.ai/keys, format `sk-or-v1-...`
   - `MASTER_PASSWORD` — the password you'll log in with. Generate a strong one with `openssl rand -base64 24`
4. **Create a D1 database automatically** (for chat history) and fill in its ID — nothing for you to do
5. Build, deploy, and wire up CI/CD, so future `git push`es redeploy automatically

When it finishes you'll get a URL like `https://mychat.<your-account>.workers.dev`. Open it, enter your master password, and you're in.

> If you skip a secret during setup, the login page tells you exactly which one is missing. Add it under
> **Cloudflare dashboard → Workers & Pages → mychat → Settings → Variables and Secrets**
> (choose type **Secret**), then redeploy.

---

## 2. Command-line deploy (if you'd rather skip GitHub)

```bash
git clone https://github.com/Elliott-byte/mychat.git && cd mychat
nvm use 22                                    # wrangler needs Node 22+

npm install
npx wrangler login                            # opens a browser to sign in to Cloudflare

npx wrangler secret put OPENROUTER_API_KEY    # input is hidden as you type
npx wrangler secret put MASTER_PASSWORD

npm run deploy    # creates the D1 database for history automatically
```

> The D1 database is provisioned automatically on deploy, and the schema is created the first time
> the Worker runs. Neither needs your attention.
>
> ⚠️ **Do not add a `database_id` to the `d1_databases` block.** Wrangler treats any non-empty value
> as "fully configured", skips auto-provisioning, and ships that ID to the API, which rejects it —
> the deploy fails outright (error 10021). Leaving it out is correct (requires wrangler >= 4.45.0).
> Don't want history? Delete the whole `d1_databases` block from `wrangler.jsonc`. Chat keeps working; it just won't save anything.

---

## 3. Local development

```bash
cp .dev.vars.example .dev.vars
# edit .dev.vars and fill in your real key and password
nvm use 22
npm install
npm run dev          # builds the frontend, starts the Worker at http://localhost:8787
```

For hot reload while working on the UI, open a second terminal:

```bash
npm run dev:ui       # Vite dev server; /api is proxied to the wrangler process above
```

Run the tests (builds, then verifies in jsdom that the React app mounts and renders):

```bash
npm test
```

Both `.dev.vars` and `dist/` are in `.gitignore`, so neither is ever committed.

---

## 4. Node version

Wrangler requires **Node.js 22+**. If your default is older, switch first:

```bash
nvm use 22                  # switch for this shell
nvm alias default 22        # or make it the default once and for all
```

(With the one-click deploy button the build happens in Cloudflare's cloud, so your local Node version doesn't matter.)

---

## 5. How it works

### 💬 Chat
- The left sidebar lists your conversation history — click any entry to resume it with full context
- Titles come from your first message; hover to **rename (✎) or delete (🗑)**
- Streaming output (typewriter effect). While generating, the button becomes **■ stop**, so you can interrupt at any time
- Hover any message to **copy** it; assistant messages also offer **↻ regenerate** (drops that reply and everything after it, then answers again)
- **Full Markdown rendering**: headings, ordered/unordered lists, task lists, tables, blockquotes, rules, links, bold/italic/strikethrough
- Code blocks get **syntax highlighting** (18 common languages built in, auto-detection for the rest), a language label, and a **copy** button
- Links always open in a new tab; model output renders as React nodes rather than HTML, so pasted or model-returned markup cannot inject anything
- The model dropdown is **sorted by release date**, newest first; searchable, with a "free only" filter
- The info bar shows model ID, release date, context length, and price per million tokens
- Switching models does **not** clear the current conversation, so you can put the same question to different models back to back
- The input box grows with your text, and scrolling up to read won't yank you back to the bottom

### 🖼 Images
Images work inside the conversation — there is no separate screen:

- **Paste** (Cmd+V), **drop** onto the window, or click **📎** beside the composer
- Thumbnails appear before you send, each removable, labelled with its compressed size
- Images are resized in the browser to 1280px on the long edge and re-encoded as JPEG,
  usually taking a multi-megabyte photo down to 100-300 KB — cheaper in tokens, faster to
  upload, and small enough for D1 (2 MB per row)
- In the model dropdown, **👁** means the model can read images and **🎨** means it can
  return them. Pick an image-capable model and its output appears inline; click to open full size
- Attachments are saved with the conversation. If one is too large to store, only the stored
  copy degrades to a placeholder — what gets sent to the model is always complete

### ⟳ Refresh models
The model list is cached server-side for one hour and refreshes on its own. Click "⟳ refresh models" at the bottom-left to pull the latest immediately.

### 📱 On mobile
Below 820px the sidebar collapses; tap ☰ at the top-left to open it. History lives in the cloud, so your phone and laptop see the same conversations.

---

## 6. Updating a deployed site

### Recommended: connect the Worker straight to this repo (set up once, then push to deploy)

Go to **Cloudflare dashboard → Workers & Pages → your Worker → Settings → Builds → Git Repository → Manage**
and select this repository. From then on every `git push` triggers a rebuild and deploy, with no clone involved.

You can also start this way for a new Worker: **Workers & Pages → Create → Workers → Import a repository**.

> The `name` in `wrangler.jsonc` must match the target Worker — it decides which Worker you deploy to and
> what the URL is. A mismatch creates a brand-new Worker, and you'd have to set the secrets again.

### Note: the one-click button clones the repo

When you deploy via the **Deploy to Cloudflare** button, Cloudflare doesn't connect to this repo directly —
it **clones it into a new repository** (adding a suffix if the name is taken, e.g. `mychat-deploy`) and wires
CI/CD to the clone. In that setup, pushing here does not update your live site.

If that's your situation, sync the updates across:

```bash
./sync-deploy.sh                  # defaults to mychat-deploy
./sync-deploy.sh your-repo-name   # if your clone is named differently
```

The script merges (it never rewrites history) and preserves the Worker name the clone was given — overwriting
it blindly would deploy a brand-new Worker under a different URL with no secrets set.

Long term, the direct connection above is cleaner: one repository instead of two.

---

## 7. Security design

| Area | Approach |
|---|---|
| API key storage | Cloudflare Secret (encrypted at rest), read only server-side via `env.OPENROUTER_API_KEY` |
| Master password storage | Cloudflare Secret, never committed to the repo |
| Session credential | HMAC-SHA256 signed cookie, `HttpOnly` + `Secure` + `SameSite=Strict`, valid 7 days |
| Password comparison | Compares SHA-256 digests (always 32 bytes), which defeats timing attacks and stops an oversized password field from burning the CPU budget |
| Brute force | Failures are counted in D1 and lock out after 8 attempts in 10 minutes. The counter is shared across requests, so parallel guessing is limited too |
| CSRF | Every state-changing request checks Origin (`SameSite=Strict` is not enough when sibling Workers share your workers.dev subdomain) |
| Content Security Policy | `img-src 'self' data:` — if a prompt injection makes the model emit a remote image URL, the browser never fetches it, closing the usual conversation-exfiltration channel |
| Route protection | `/api/models`, `/api/chat`, and `/api/image` all verify the session and return 401 when absent |
| Chat history | Stored in your own Cloudflare D1, readable and writable only after login, never touching a third party |
| Search engines | Pages carry `noindex, nofollow` |

All the browser ever sees is the frontend HTML/JS and a session cookie — **never the API key**. Every OpenRouter request is proxied by the Worker.

**Changing your password**: set `MASTER_PASSWORD` again and redeploy. Because the session signing key is derived from the master password, changing it automatically invalidates all existing sessions.

**⚠️ A public repo is only safe because it holds no secrets** — `.dev.vars` is excluded via `.gitignore`. Never write a real key into any file that gets committed.

---

## 8. Free tier limits

- **Cloudflare Workers free tier**: 100,000 requests/day, 10ms CPU time per request (proxying a stream uses almost no CPU)
- **Static assets**: free, and they don't count toward the request quota
- **Cloudflare D1** (chat history): free tier gives **500 MB** of storage and 5M row reads / 100K row writes per day (2 MB max per row)
- **OpenRouter**: models ending in `:free` cost nothing (rate-limited); everything else is pay-as-you-go

Personal use will essentially never reach Cloudflare's free ceiling.

---

## 9. Project layout

```
mychat/
├── wrangler.jsonc            # Cloudflare config (D1 binding + frontend build command)
├── vite.config.mjs           # Vite config: web/ → dist/
├── .node-version             # pins the Node version for Cloudflare builds (wrangler needs 22+)
├── package.json              # includes cloudflare.bindings — the secret prompts on one-click deploy
├── src/index.js              # Worker: auth + history (D1) + OpenRouter proxy
├── web/                      # React frontend source
│   ├── index.html
│   └── src/
│       ├── main.jsx          # entry point
│       ├── App.jsx           # global state and orchestration
│       ├── api.js            # backend client (including stream parsing)
│       ├── markdown.jsx      # Markdown rendering (react-markdown + GFM + lowlight)
│       ├── styles.css
│       └── components/       # Login / Sidebar / ModelBar / ChatView
├── test/smoke.mjs            # jsdom smoke test: asserts the app mounts and renders
├── setup-github.sh           # Push to GitHub and generate your deploy link
├── sync-deploy.sh            # Sync updates into a clone made by the deploy button
├── .dev.vars.example         # Source of the secret prompts on deploy; also the local dev template
└── .gitignore                # excludes dist/ and .dev.vars
```

> The frontend build is wired through `build.command` in `wrangler.jsonc`, so `wrangler deploy`
> runs `npm run build` first. Cloudflare's cloud builds need **no extra configuration**.

---

## 10. Optional: environment variables

| Variable | Type | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | Secret | **Required.** Your OpenRouter key |
| `MASTER_PASSWORD` | Secret | **Required.** The password you log in with |
| `SESSION_SECRET` | Secret | Optional but **recommended**. Generate with `openssl rand -base64 32`; used to sign session cookies. Without it the signing key is derived from your master password, so a leaked cookie could be used to crack that password offline |
| `OPENROUTER_BASE_URL` | Plain var | Optional. Defaults to `https://openrouter.ai/api/v1`; point it at a mirror or your own proxy if the default is unreachable |

---

## 11. Optional: use your own domain

If your domain is on Cloudflare, add this to `wrangler.jsonc`:

```jsonc
"routes": [
  { "pattern": "ai.yourdomain.com", "custom_domain": true }
]
```

Then redeploy.
