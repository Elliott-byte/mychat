// Downscale images before they leave the browser.
//
// A modern phone photo is 4-8 MB, which would blow past D1's 2 MB row limit,
// waste a lot of tokens, and make every request slow. Resizing to ~1280px and
// re-encoding as JPEG typically lands at 100-300 KB with no visible loss for
// anything a model needs to read.
const MAX_EDGE = 1280;
const QUALITY = 0.82;
const MAX_BYTES = 1_000_000;

/** Actual byte size of a data URL's payload (base64 inflates by ~4/3). */
export function dataUrlBytes(url) {
  const comma = url.indexOf(",");
  if (comma < 0) return url.length;
  return Math.round(((url.length - comma - 1) * 3) / 4);
}

// Some Android cameras hand back a file with an empty MIME type, so fall back
// to the extension rather than silently refusing the photo.
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|avif|heic|heif|svg)$/i;
export function isImageFile(file) {
  if (!file) return false;
  return file.type ? file.type.startsWith("image/") : IMAGE_EXT.test(file.name || "");
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

/**
 * Decode straight from the File via an object URL.
 *
 * Going through readAsDataURL first would materialise an 8 MB phone photo as an
 * ~11 MB base64 string on top of the decoded bitmap — enough to get the tab
 * killed on a mid-range phone, and all of it thrown away a moment later.
 */
async function decode(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await loadImage(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Returns { url, name, bytes } with the image scaled down and re-encoded. */
export async function prepareImage(file) {
  const tooBig = () =>
    new Error(`"${file.name}" is too large to attach — try a smaller image.`);

  // Pass the file through untouched, if it fits. The only route to a data URL
  // that isn't a re-encode, so it stays lazy: the common path never builds one.
  const passThrough = async () => {
    const original = await readAsDataURL(file);
    const bytes = dataUrlBytes(original);
    if (bytes > MAX_BYTES) throw tooBig();
    return { url: original, name: file.name, bytes };
  };

  // SVG has no pixel size to scale and canvas would rasterise it, so it can only
  // be passed through — which means the size limit has to be enforced here.
  if (file.type === "image/svg+xml") return passThrough();

  let img;
  try {
    img = await decode(file);
  } catch {
    // Undecodable in this browser (HEIC on desktop Chrome, for instance). We
    // cannot resize it, so it only goes through if it is already small enough.
    return passThrough();
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  let edge = MAX_EDGE;
  let url = "";

  // Step the quality down first, then the dimensions. Reducing quality alone is
  // not enough for dense images (detailed scans, full-page screenshots), which
  // would otherwise be attached over the limit and silently dropped on save.
  for (let attempt = 0; attempt < 6; attempt++) {
    const scale = Math.min(1, edge / Math.max(img.width, img.height));
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const quality = attempt === 0 ? QUALITY : Math.max(0.45, QUALITY - attempt * 0.12);
    url = canvas.toDataURL("image/jpeg", quality);
    if (dataUrlBytes(url) <= MAX_BYTES) break;
    if (attempt >= 2) edge = Math.round(edge * 0.75); // shrink once quality stops helping
  }

  const bytes = dataUrlBytes(url);
  if (bytes > MAX_BYTES) throw tooBig();
  // If re-encoding made it bigger (small PNGs can do this), keep the original.
  // file.size is the same measure as dataUrlBytes — decoded payload bytes — so
  // they compare directly, without reading the original just to find out.
  if (bytes > file.size && file.size <= MAX_BYTES) return passThrough();

  return { url, name: file.name, bytes };
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
