// Downscale images before they leave the browser.
//
// A modern phone photo is 4-8 MB, which would blow past D1's 2 MB row limit,
// waste a lot of tokens, and make every request slow. Resizing to ~1280px and
// re-encoding as JPEG typically lands at 100-300 KB with no visible loss for
// anything a model needs to read.
const MAX_EDGE = 1280;
const QUALITY = 0.82;
const MAX_BYTES = 1_000_000;

export function isImageFile(file) {
  return file && file.type.startsWith("image/");
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error("Could not read the file"));
    fr.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode the image"));
    img.src = src;
  });
}

/** Returns { url, name, bytes } with the image scaled down and re-encoded. */
export async function prepareImage(file) {
  const original = await readAsDataURL(file);

  // SVG has no meaningful pixel size to scale, and canvas would rasterise it.
  if (file.type === "image/svg+xml") {
    return { url: original, name: file.name, bytes: original.length };
  }

  let img;
  try {
    img = await loadImage(original);
  } catch {
    return { url: original, name: file.name, bytes: original.length };
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  let quality = QUALITY;
  let url = original;

  // Shrink, then step the quality down if it is still too heavy to store.
  for (let attempt = 0; attempt < 4; attempt++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    url = canvas.toDataURL("image/jpeg", quality);
    if (url.length <= MAX_BYTES) break;
    quality -= 0.15;
    if (quality < 0.4) break;
  }

  // If re-encoding somehow made it bigger (small PNGs can do this), keep the original.
  if (url.length > original.length) url = original;

  return { url, name: file.name, bytes: url.length };
}

/** Pull image files out of a paste or drop event. */
export function imagesFromDataTransfer(dt) {
  if (!dt) return [];
  const out = [];
  for (const item of dt.items || []) {
    if (item.kind === "file") {
      const f = item.getAsFile();
      if (isImageFile(f)) out.push(f);
    }
  }
  if (!out.length) {
    for (const f of dt.files || []) if (isImageFile(f)) out.push(f);
  }
  return out;
}
