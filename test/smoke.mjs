// 在 jsdom 里跑真实构建产物,验证 React 应用能挂载、关键界面能渲染。
// 捕获任何运行时报错(错误的 import、挂载时空指针等),这是构建成功也无法保证的。
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

async function render({ authed }) {
  const dom = new JSDOM(fs.readFileSync(path.join(DIST, "index.html"), "utf8"), {
    runScripts: "outside-only",
    url: "https://mychat.test/",
    pretendToBeVisual: true,
  });
  const { window } = dom;

  const errors = [];
  window.addEventListener("error", (e) => errors.push("window.error: " + e.message));
  const origErr = console.error;
  window.console.error = (...a) => errors.push("console.error: " + a.join(" "));

  // 桩:模拟后端响应
  window.fetch = async (url, opts = {}) => {
    const u = String(url);
    const json = (o, status = 200, headers = {}) => ({
      ok: status < 400, status,
      headers: { get: (k) => headers[k.toLowerCase()] ?? null },
      json: async () => o,
    });
    if (u === "/api/me") return authed ? json({ ok: true, history: true }) : json({ ok: false }, 401);
    if (u === "/api/setup") return json({ hasPassword: true, hasApiKey: true });
    if (u === "/api/models") return json({ updatedAt: Date.now(), ...MODELS });
    if (u === "/api/conversations") return json({ conversations: [
      { id: "c1", title: "第一个对话", model: "x/fast", updated_at: Date.now(), message_count: 2 },
      { id: "c2", title: "第二个对话", model: "y/free:free", updated_at: Date.now() - 1000, message_count: 4 },
    ] });
    return json({}, 404);
  };
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  Object.defineProperty(window.navigator, "clipboard", { value: { writeText: async () => {} }, configurable: true });

  window.eval(bundle);
  // 等 React 完成挂载与几轮 effect/异步 fetch
  for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 25));

  window.console.error = origErr;
  return { dom, window, doc: window.document, errors };
}

let failures = 0;
const check = (label, cond, extra = "") => {
  console.log(`  ${cond ? "✅" : "❌"} ${label}${cond ? "" : "  " + extra}`);
  if (!cond) failures++;
};

console.log("=== 场景 A:未登录 ===");
{
  const { doc, errors } = await render({ authed: false });
  const txt = doc.body.textContent;
  check("无运行时错误", errors.length === 0, errors.join(" | "));
  check("渲染登录卡片", !!doc.querySelector(".login-card"));
  check("有密码输入框", !!doc.querySelector('input[type="password"]'));
  check("显示标题 MyChat", txt.includes("MyChat"));
  check("未渲染主界面", !doc.querySelector(".sidebar"));
}

console.log("\n=== 场景 B:已登录 ===");
{
  const { doc, errors } = await render({ authed: true });
  const txt = doc.body.textContent;
  check("无运行时错误", errors.length === 0, errors.join(" | "));
  check("渲染侧边栏", !!doc.querySelector(".sidebar"));
  check("有「新对话」按钮", !!doc.querySelector(".new-chat"));
  check("历史列表渲染 2 条", doc.querySelectorAll(".conv").length === 2,
    `实际 ${doc.querySelectorAll(".conv").length} 条`);
  check("历史标题正确", txt.includes("第一个对话") && txt.includes("第二个对话"));
  check("模型下拉框已填充", doc.querySelectorAll("select option").length === 2,
    `实际 ${doc.querySelectorAll("select option").length} 项`);
  check("免费模型带 🆓 标记", [...doc.querySelectorAll("option")].some((o) => o.textContent.includes("🆓")));
  check("模型信息栏显示价格", doc.querySelector(".model-info")?.textContent.includes("$"));
  check("显示空状态提示", !!doc.querySelector(".empty-state"));
  check("有输入框与发送按钮", !!doc.querySelector("textarea") && !!doc.querySelector(".icon-btn"));
  check("未误留登录界面", !doc.querySelector(".login-card"));
}

console.log(failures === 0 ? "\n🎉 全部通过" : `\n💥 ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
