import { useEffect, useState } from "react";
import { api } from "../api";

export function Login({ onSuccess }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [missing, setMissing] = useState([]);
  const [busy, setBusy] = useState(false);

  // Surface a missing secret right on the login screen after a one-click deploy,
  // so nobody has to dig through build logs to find out
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
        <p>Private AI playground · enter your master password</p>

        {missing.length > 0 && (
          <div className="setup-warn">
            ⚠️ <b>Setup incomplete</b>
            <br />
            Missing secret(s): <b>{missing.join(", ")}</b>
            <br />
            Add them under Cloudflare dashboard → Workers &amp; Pages → mychat → Settings →
            Variables and Secrets (choose type <b>Secret</b>), then redeploy.
          </div>
        )}

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Master password"
          autoComplete="current-password"
          autoFocus
        />
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Enter"}
        </button>
        <div className="login-error">{error}</div>
      </form>
    </div>
  );
}
