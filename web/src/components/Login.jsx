import { useEffect, useState } from "react";
import { api } from "../api";

export function Login({ onSuccess }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [missing, setMissing] = useState([]);
  const [busy, setBusy] = useState(false);

  // 一键部署后若漏配密钥,直接在登录页提示,不必去翻构建日志
  useEffect(() => {
    api
      .setup()
      .then((s) => {
        const m = [];
        if (!s.hasPassword) m.push("MASTER_PASSWORD");
        if (!s.hasApiKey) m.push("OPENROUTER_API_KEY");
        setMissing(m);
      })
      .catch(() => {});
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.login(password);
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-view">
      <form className="login-card" onSubmit={submit}>
        <h1>🔐 MyChat</h1>
        <p>私人 AI 试用台 · 请输入主密码</p>

        {missing.length > 0 && (
          <div className="setup-warn">
            ⚠️ <b>部署尚未完成</b>
            <br />
            缺少密钥:<b>{missing.join("、")}</b>
            <br />
            请到 Cloudflare 控制台 → Workers &amp; Pages → mychat → Settings → Variables and
            Secrets 添加(类型选 Secret),然后重新部署。
          </div>
        )}

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="主密码"
          autoComplete="current-password"
          autoFocus
        />
        <button type="submit" disabled={busy}>
          {busy ? "验证中…" : "进入"}
        </button>
        <div className="login-error">{error}</div>
      </form>
    </div>
  );
}
