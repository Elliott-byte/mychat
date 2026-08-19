import { useState } from "react";
import { api } from "../api";

export function ImageView({ model, onToast }) {
  const [prompt, setPrompt] = useState("");
  const [attached, setAttached] = useState([]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState([]);

  async function pickFiles(e) {
    const files = [...e.target.files];
    const urls = await Promise.all(
      files.map(
        (f) =>
          new Promise((res) => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result);
            fr.readAsDataURL(f);
          })
      )
    );
    setAttached(urls);
  }

  async function generate() {
    if (!prompt.trim() || !model) return onToast("Enter a prompt and pick a model");
    setBusy(true);
    try {
      const d = await api.image({ model, prompt, images: attached });
      setResults((r) => [{ prompt, model, images: d.images, text: d.text }, ...r]);
    } catch (err) {
      setResults((r) => [{ prompt, model, error: err.message }, ...r]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pane">
      <div className="img-wrap">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the image you want… (the model list is already filtered to image-capable models)"
        />
        <div className="img-controls">
          <button className="btn-primary" onClick={generate} disabled={busy}>
            {busy ? "Generating…" : "Generate image"}
          </button>
          <label className="small-btn">
            📎 Reference image (image-to-image)
            <input type="file" accept="image/*" multiple hidden onChange={pickFiles} />
          </label>
          {attached.length > 0 && (
            <button className="small-btn" onClick={() => setAttached([])}>
              Clear references ({attached.length})
            </button>
          )}
        </div>

        {attached.length > 0 && (
          <div className="img-attach">
            {attached.map((u, i) => (
              <img key={i} src={u} alt="" />
            ))}
          </div>
        )}

        <div className="img-results">
          {results.map((r, i) => (
            <div className="img-item" key={i}>
              <div className="prompt-text">
                “{r.prompt}” · {r.model}
              </div>
              {r.error ? (
                <div className="error-text">⚠️ {r.error}</div>
              ) : (
                <>
                  {(!r.images || r.images.length === 0) && !r.text && (
                    <div className="error-text">The model returned no image. Try a different image-capable model.</div>
                  )}
                  {(r.images || []).map((url, k) => (
                    <div key={k}>
                      <img src={url} alt={r.prompt} />
                      <div className="actions">
                        <a
                          className="small-btn"
                          href={url}
                          download={`mychat-${i}-${k}.png`}
                          style={{ textDecoration: "none" }}
                        >
                          ⬇ Download
                        </a>
                      </div>
                    </div>
                  ))}
                  {r.text && <div className="note">{r.text}</div>}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
