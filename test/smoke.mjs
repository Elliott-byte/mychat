// 在 jsdom 里跑真实构建产物,验证 React 应用能挂载、关键界面能渲染、
// Markdown 能正确解析,以及不可信内容不会被注入为 HTML。
// 这些是「构建成功」无法保证的东西。
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
    { id: "x/fast", name: "X Fast", created: 1750000000, context: 128000, input: ["text"], output: ["text"], promptPrice: 0.000001, completionPrice: 0.000002, imagePrice: 0 },
    { id: "y/free:free", name: "Y Free (free)", created: 1740000000, context: 32000, input: ["text"], output: ["text"], promptPrice: 0, completionPrice: 0, imagePrice: 0 },
  ],
  image: [
    { id: "z/img", name: "Z Image", created: 1745000000, context: 32000, input: ["text"], output: ["image", "text"], promptPrice: 0, completionPrice: 0, imagePrice: 0 },
  ],
};

const MD_SAMPLE = [
  "# 一级标题",
  "## 二级标题",
  "普通段落,含 **粗体**、*斜体*、~~删除线~~ 和 `行内代码`。",
  "",
  "- 无序项 A",
  "- 无序项 B",
  "",
  "1. 有序项一",
  "2. 有序项二",
  "",
  "- [x] 已完成任务",
  "- [ ] 未完成任务",
  "",
  "> 这是一段引用",
  "",
  "| 模型 | 价格 |",
  "|---|---|",
  "| GPT | 便宜 |",
  "",
  "[链接文字](https://example.com)",
  "",
  "```python",
  "def hello(name):",
  "    return f'hi {name}'",
  "```",
  "",
  "```",
  "没有语言标注的代码块",
  "```",
  "",
  "---",
].join("\n");

// 模型可能返回恶意 HTML;必须当作纯文本显示,不能进入 DOM
const EVIL_MD = [
  '<script data-xss>window.__pwned = true;</script>',
  '<img src=x onerror="window.__pwned = true">',
  "[点我](javascript:window.__pwned=true)",
].join("\n\n");

async function render({ authed, convContent = MD_SAMPLE }) {
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
        conversation: { id: "c1", title: "第一个对话", model: "x/fast" },
        messages: [{ role: "assistant", content: convContent, model: "x/fast" }],
      });
    }
    if (u === "/api/conversations") {
      return json({
        conversations: [
          { id: "c1", title: "第一个对话", model: "x/fast", updated_at: 2, message_count: 2 },
          { id: "c2", title: "第二个对话", model: "y/free:free", updated_at: 1, message_count: 4 },
        ],
      });
    }
    return json({}, 404);
  };
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  Object.defineProperty(window.navigator, "clipboard", { value: { writeText: async () => {} }, configurable: true });

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

console.log("=== 场景 A:未登录 ===");
{
  const { doc, errors } = await render({ authed: false });
  check("无运行时错误", errors.length === 0, errors.join(" | "));
  check("渲染登录卡片", !!doc.querySelector(".login-card"));
  check("有密码输入框", !!doc.querySelector('input[type="password"]'));
  check("未渲染主界面", !doc.querySelector(".sidebar"));
}

console.log("\n=== 场景 B:已登录 ===");
{
  const { doc, errors } = await render({ authed: true });
  const txt = doc.body.textContent;
  check("无运行时错误", errors.length === 0, errors.join(" | "));
  check("渲染侧边栏", !!doc.querySelector(".sidebar"));
  check("历史列表渲染 2 条", doc.querySelectorAll(".conv").length === 2, `实际 ${doc.querySelectorAll(".conv").length}`);
  check("历史标题正确", txt.includes("第一个对话") && txt.includes("第二个对话"));
  check("模型下拉框已填充", doc.querySelectorAll("select option").length === 2);
  check("免费模型带 🆓 标记", [...doc.querySelectorAll("option")].some((o) => o.textContent.includes("🆓")));
  check("模型信息栏显示价格", doc.querySelector(".model-info")?.textContent.includes("$"));
  check("显示空状态提示", !!doc.querySelector(".empty-state"));
  check("有输入框与发送按钮", !!doc.querySelector("textarea") && !!doc.querySelector(".icon-btn"));
}

console.log("\n=== 场景 C:Markdown 渲染(点开历史对话) ===");
{
  const { doc, window, errors, settle } = await render({ authed: true });
  doc.querySelector(".conv").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(20);

  const md = doc.querySelector(".md");
  check("加载并渲染了消息", !!md, "未找到 .md 容器");
  if (md) {
    check("渲染 h1", !!md.querySelector("h1"));
    check("渲染 h2", !!md.querySelector("h2"));
    check("渲染粗体", !!md.querySelector("strong"));
    check("渲染斜体", !!md.querySelector("em"));
    check("渲染删除线(GFM)", !!md.querySelector("del"));
    check("渲染行内代码", !!md.querySelector("p code"));
    check("渲染无序列表", !!md.querySelector("ul li"));
    check("渲染有序列表", !!md.querySelector("ol li"));
    check("渲染任务列表(GFM)", !!md.querySelector('input[type="checkbox"]'));
    check("渲染引用", !!md.querySelector("blockquote"));
    check("渲染表格(GFM)", !!md.querySelector("table th"));
    check("表格有横向滚动容器", !!md.querySelector(".table-wrap"));
    check("渲染分隔线", !!md.querySelector("hr"));
    const a = md.querySelector("a");
    check("渲染链接", !!a);
    check("链接新标签打开且带 noopener",
      a?.getAttribute("target") === "_blank" && (a?.getAttribute("rel") || "").includes("noopener"));
    check("代码块数量为 2", md.querySelectorAll(".code-block").length === 2,
      `实际 ${md.querySelectorAll(".code-block").length}`);
    check("代码块有复制按钮", !!md.querySelector(".code-block .copy-code"));
    check("代码块标注语言 python", md.querySelector(".code-lang")?.textContent === "python");
    check("语法高亮已生效",
      !!md.querySelector("pre code .hljs-keyword, pre code .hljs-string, pre code .hljs-title, pre code .hljs-built_in"));
  }
  check("无运行时错误", errors.length === 0, errors.join(" | "));
}

console.log("\n=== 场景 D:不可信内容不得注入 HTML ===");
{
  const { doc, window, errors, settle } = await render({ authed: true, convContent: EVIL_MD });
  doc.querySelector(".conv").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await settle(20);

  const md = doc.querySelector(".md");
  check("恶意 script 未进入 DOM", !doc.querySelector("script[data-xss]"));
  check("恶意 img 未进入 DOM", !doc.querySelector('img[src="x"]'));
  check("未触发注入的代码", window.__pwned !== true);
  const href = md?.querySelector("a")?.getAttribute("href") || "";
  check("javascript: 链接已被拦截", !href.toLowerCase().startsWith("javascript:"), `href=${href}`);
  check("无运行时错误", errors.length === 0, errors.join(" | "));
}

console.log(failures === 0 ? "\n🎉 全部通过" : `\n💥 ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
