// Run the real build output inside jsdom to verify the React app mounts, the
// key screens render, Markdown parses correctly, and untrusted content never
// reaches the DOM as HTML. A successful build guarantees none of this.
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const bundle = fs.readFileSync(
  path.join(DIST, "assets", fs.readdirSync(path.join(DIST, "assets")).find((f) => f.endsWith(".js"))),
  "utf8"
);

const MODELS = {
  chat: [
    { id: "x/fast", name: "X Fast", created: 1750000000, context: 128000, input: ["text", "image"], output: ["text"], promptPrice: 0.000001, completionPrice: 0.000002, imagePrice: 0 },
    { id: "y/free:free", name: "Y Free (free)", created: 1740000000, context: 32000, input: ["text"], output: ["text"], promptPrice: 0, completionPrice: 0, imagePrice: 0 },
  ],
  image: [
    { id: "z/img", name: "Z Image", created: 1745000000, context: 32000, input: ["text", "image"], output: ["image", "text"], promptPrice: 0, completionPrice: 0, imagePrice: 0 },
  ],
};

const MD_SAMPLE = [
  "# Heading one",
  "## Heading two",
  "A paragraph with **bold**, *italics*, ~~strikethrough~~ and `inline code`.",
  "",
  "- Bullet A",
  "- Bullet B",
  "",
  "1. First",
  "2. Second",
  "",
  "- [x] Done task",
  "- [ ] Pending task",
  "",
  "> A blockquote",
  "",
  "| Model | Price |",
  "|---|---|",
  "| GPT | Cheap |",
  "",
  "[Link text](https://example.com)",
  "",
  "```python",
  "def hello(name):",
  "    return f'hi {name}'",
  "```",
  "",
  "```",
  "a fenced block with no language",
  "```",
  "",
  "---",
].join("\n");

// A model may return malicious HTML. It must render as plain text, never as DOM.
const EVIL_MD = [
  '<script data-xss>window.__pwned = true;</script>',
  '<img src=x onerror="window.__pwned = true">',
  "[click me](javascript:window.__pwned=true)",
].join("\n\n");

async function render({ authed, convContent = MD_SAMPLE, prefs = null }) {
  const dom = new JSDOM(fs.readFileSync(path.join(DIST, "index.html"), "utf8"), {
    runScripts: "outside-only",
    url: "https://mychat.test/",
    pretendToBeVisual: true,
  });
  const { window } = dom;

  const errors = [];
  window.addEventListener("error", (e) => errors.push("window.error: " + e.message));
  window.console.error = (...a) => errors.push("console.error: " + a.join(" "));

  window.fetch = async (url) => {
    const u = String(url);
    const json = (o, status = 200, headers = {}) => ({
      ok: status < 400,
      status,
      headers: { get: (k) => headers[k.toLowerCase()] ?? null },
      json: async () => o,
    });
    if (u === "/api/me") return authed ? json({ ok: true, history: true }) : json({ ok: false }, 401);
    if (u === "/api/setup") return json({ hasPassword: true, hasApiKey: true });
    if (u === "/api/models") return json({ updatedAt: 1, ...MODELS });
    if (u.startsWith("/api/conversations/")) {
      return json({
        conversation: { id: "c1", title: "First conversation", model: "x/fast" },
        messages: [{ role: "assistant", content: convContent, model: "x/fast" }],
      });
    }
    if (u === "/api/conversations") {
      return json({
        conversations: [
          { id: "c1", title: "First conversation", model: "x/fast", updated_at: 2, message_count: 2 },
          { id: "c2", title: "Second conversation", model: "y/free:free", updated_at: 1, message_count: 4 },
        ],
      });
    }
    return json({}, 404);
  };
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  Object.defineProperty(window.navigator, "clipboard", { value: { writeText: async () => {} }, configurable: true });

  if (prefs) window.localStorage.setItem("mychat.prefs", JSON.stringify(prefs));

  window.eval(bundle);
  const settle = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 25)); };
  await settle();

  return { window, doc: window.document, errors, settle };
}

let failures = 0;
const check = (label, cond, extra = "") => {
  console.log(`  ${cond ? "✅" : "❌"} ${label}${cond ? "" : "  ← " + extra}`);
  if (!cond) failures++;
};

console.log("=== Case A: signed out ===");
{
  const { doc, errors } = await render({ authed: false });
  check("no runtime errors", errors.length === 0, errors.join(" | "));
  check("renders the login card", !!doc.querySelector(".login-card"));
  check("has a password field", !!doc.querySelector('input[type="password"]'));
  check("does not render the main UI", !doc.querySelector(".sidebar"));
}

console.log("\n=== Case B: signed in ===");
{
  const { doc, errors } = await render({ authed: true });
  const txt = doc.body.textContent;
  check("no runtime errors", errors.length === 0, errors.join(" | "));
  check("renders the sidebar", !!doc.querySelector(".sidebar"));
  check("lists 2 conversations", doc.querySelectorAll(".conv").length === 2, `got ${doc.querySelectorAll(".conv").length}`);
  check("conversation titles are correct", txt.includes("First conversation") && txt.includes("Second conversation"));
  check("model dropdown merges chat + image models", doc.querySelectorAll("select option").length === 3,
    `got ${doc.querySelectorAll("select option").length}`);
  check("composer has an attach button", !!doc.querySelector(".attach-btn"));
  check("image tab is gone", !doc.querySelector(".mode-tabs"));
  check("free models are marked 🆓", [...doc.querySelectorAll("option")].some((o) => o.textContent.includes("🆓")));
  check("vision models are marked 📷", [...doc.querySelectorAll("option")].some((o) => o.textContent.includes("📷")));
  check("image-output models are marked 🎨", [...doc.querySelectorAll("option")].some((o) => o.textContent.includes("🎨")));
  check("info bar shows pricing", doc.querySelector(".model-info")?.textContent.includes("$"));
  check("shows the empty state", !!doc.querySelector(".empty-state"));
  check("has a composer and send button", !!doc.querySelector("textarea") && !!doc.querySelector(".icon-btn"));
}

console.log("\n=== Case C: Markdown rendering (opening a past conversation) ===");
{
  const { doc, window, errors, settle } = await render({ authed: true });
  doc.querySelector(".conv").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(20);

  const md = doc.querySelector(".md");
  check("loaded and rendered the message", !!md, ".md container not found");
  if (md) {
    check("renders h1", !!md.querySelector("h1"));
    check("renders h2", !!md.querySelector("h2"));
    check("renders bold", !!md.querySelector("strong"));
    check("renders italics", !!md.querySelector("em"));
    check("renders strikethrough (GFM)", !!md.querySelector("del"));
    check("renders inline code", !!md.querySelector("p code"));
    check("renders unordered lists", !!md.querySelector("ul li"));
    check("renders ordered lists", !!md.querySelector("ol li"));
    check("renders task lists (GFM)", !!md.querySelector('input[type="checkbox"]'));
    check("renders blockquotes", !!md.querySelector("blockquote"));
    check("renders tables (GFM)", !!md.querySelector("table th"));
    check("tables get a scroll container", !!md.querySelector(".table-wrap"));
    check("renders horizontal rules", !!md.querySelector("hr"));
    const a = md.querySelector("a");
    check("renders links", !!a);
    check("links open in a new tab with noopener",
      a?.getAttribute("target") === "_blank" && (a?.getAttribute("rel") || "").includes("noopener"));
    check("renders 2 code blocks", md.querySelectorAll(".code-block").length === 2,
      `got ${md.querySelectorAll(".code-block").length}`);
    check("code blocks have a copy button", !!md.querySelector(".code-block .copy-code"));
    check("code block is labelled python", md.querySelector(".code-lang")?.textContent === "python");
    check("syntax highlighting applied",
      !!md.querySelector("pre code .hljs-keyword, pre code .hljs-string, pre code .hljs-title, pre code .hljs-built_in"));
  }
  check("no runtime errors", errors.length === 0, errors.join(" | "));
}

console.log("\n=== Case D: untrusted content must not inject HTML ===");
{
  const { doc, window, errors, settle } = await render({ authed: true, convContent: EVIL_MD });
  doc.querySelector(".conv").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(20);

  const md = doc.querySelector(".md");
  check("malicious script never reaches the DOM", !doc.querySelector("script[data-xss]"));
  check("malicious img never reaches the DOM", !doc.querySelector('img[src="x"]'));
  check("injected code did not execute", window.__pwned !== true);
  const href = md?.querySelector("a")?.getAttribute("href") || "";
  check("javascript: URLs are blocked", !href.toLowerCase().startsWith("javascript:"), `href=${href}`);
  check("no runtime errors", errors.length === 0, errors.join(" | "));
}

console.log("\n=== Case E: multimodal messages render inline ===");
{
  const PIXEL =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const MULTIMODAL = [
    { type: "text", text: "Here is **the image** I mean:" },
    { type: "image_url", image_url: { url: PIXEL } },
  ];
  const { doc, window, errors, settle } = await render({ authed: true, convContent: MULTIMODAL });
  doc.querySelector(".conv").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(20);

  check("renders the attached image inline", !!doc.querySelector(".msg-images img"));
  check("image points at the stored data URL",
    doc.querySelector(".msg-images img")?.getAttribute("src") === PIXEL);
  check("image opens full size in a new tab",
    doc.querySelector(".msg-images a")?.getAttribute("target") === "_blank");
  check("text alongside the image still renders as Markdown", !!doc.querySelector(".md strong"));
  check("no runtime errors", errors.length === 0, errors.join(" | "));
}

console.log("\n=== Case F: preferences survive a reload ===");
{
  // A remembered model should be reselected instead of defaulting to the newest
  const { doc, errors } = await render({ authed: true, prefs: { model: "y/free:free", freeOnly: true } });
  check("remembered model is reselected", doc.querySelector("select")?.value === "y/free:free",
    `got ${doc.querySelector("select")?.value}`);
  check("remembered 'free only' filter is applied", doc.querySelector('input[type="checkbox"]')?.checked === true);
  check("no runtime errors", errors.length === 0, errors.join(" | "));
}

console.log("\n=== Case G: a stale remembered model falls back cleanly ===");
{
  const { doc, errors } = await render({ authed: true, prefs: { model: "gone/retired-model" } });
  const v = doc.querySelector("select")?.value;
  check("falls back to a real model", !!v && v !== "gone/retired-model", `got ${v}`);
  check("no runtime errors", errors.length === 0, errors.join(" | "));
}

console.log(failures === 0 ? "\n🎉 All checks passed" : `\n💥 ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
