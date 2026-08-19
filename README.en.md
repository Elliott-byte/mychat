<div align="right">

[简体中文](README.md) · **English**

</div>

# MyChat — Your Private AI Playground

A personal AI playground running on Cloudflare Workers' free tier, calling the latest chat and image models through OpenRouter.

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
- **Chat + images in one place** — Streaming conversations, text-to-image, and image-to-image.

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
npm run dev
```

Open http://localhost:8787 . `.dev.vars` is listed in `.gitignore`, so it will never be committed.

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
- Code blocks get their own **copy** button in the top-right corner
- The model dropdown is **sorted by release date**, newest first; searchable, with a "free only" filter
- The info bar shows model ID, release date, context length, and price per million tokens
- Switching models does **not** clear the current conversation, so you can put the same question to different models back to back
- The input box grows with your text, and scrolling up to read won't yank you back to the bottom

### 🎨 Images
- Automatically filters to models that **output images** (Nano Banana, GPT-5 Image, and so on)
- Enter a prompt to generate an image, then download it
- **Image-to-image** is supported: click "📎 reference image" to attach one or more inputs

### ⟳ Refresh models
The model list is cached server-side for one hour and refreshes on its own. Click "⟳ refresh models" at the bottom-left to pull the latest immediately.

### 📱 On mobile
Below 820px the sidebar collapses; tap ☰ at the top-left to open it. History lives in the cloud, so your phone and laptop see the same conversations.

---

## 6. Updating a deployed site

When you click the deploy button, Cloudflare **clones the repo into a new repository** (adding a suffix if the
name is taken, e.g. `mychat-deploy`) and wires CI/CD to *that* clone. So pushing to this repo does **not**
update your live site on its own.

Sync it:

```bash
./sync-deploy.sh                  # defaults to mychat-deploy
./sync-deploy.sh your-repo-name   # if your clone is named differently
```

The script merges this repo's latest code into the deploy repo and pushes, which triggers an automatic rebuild.

> **Why it isn't just a `git push`:** when Cloudflare cloned the repo it rewrote `name` in `wrangler.jsonc`
> and `package.json` to the new repository's name. That `name` determines the Worker's identity and URL, and
> your secrets are attached to that Worker — overwriting it blindly would deploy a brand-new Worker under a
> different URL with no secrets set. The script preserves it for you.

If you'd rather not maintain two repositories, go to **Cloudflare dashboard → your Worker → Settings → Build**
and repoint the connected repository at this one. After that a plain `git push` deploys.

---

## 7. Security design

| Area | Approach |
|---|---|
| API key storage | Cloudflare Secret (encrypted at rest), read only server-side via `env.OPENROUTER_API_KEY` |
| Master password storage | Cloudflare Secret, never committed to the repo |
| Session credential | HMAC-SHA256 signed cookie, `HttpOnly` + `Secure` + `SameSite=Strict`, valid 7 days |
| Password comparison | Constant-time comparison against timing attacks; 1-second delay on failure to slow brute force |
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
- **Cloudflare D1** (chat history): free tier includes 5GB storage and 5M row reads / 100K row writes per day
- **OpenRouter**: models ending in `:free` cost nothing (rate-limited); everything else is pay-as-you-go

Personal use will essentially never reach Cloudflare's free ceiling.

---

## 9. Project layout

```
mychat/
├── wrangler.jsonc        # Cloudflare configuration
├── package.json          # includes cloudflare.bindings — the secret descriptions shown during one-click deploy
├── src/index.js          # Worker: auth + history (D1) + OpenRouter proxy
├── public/index.html     # Single-page frontend (login + sidebar + chat + images)
├── setup-github.sh       # Push to GitHub and generate your deploy link
├── sync-deploy.sh        # Sync updates into the clone the deploy button made, triggering a redeploy
├── .dev.vars.example     # Source of the secret prompts on deploy; also the local dev template
└── .gitignore
```

---

## 10. Optional: environment variables

| Variable | Type | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | Secret | **Required.** Your OpenRouter key |
| `MASTER_PASSWORD` | Secret | **Required.** The password you log in with |
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
