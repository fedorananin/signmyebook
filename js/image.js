const MAX_DIMENSION = 1200;
const JPEG_QUALITY = 0.85;

export async function processImageFile(file) {
  const bitmap = await loadBitmap(file);
  const { canvas, width, height } = drawScaled(bitmap, MAX_DIMENSION);
  if (typeof bitmap.close === 'function') bitmap.close();

  const wantsTransparency = file.type === 'image/png' && await hasTransparency(canvas);
  const mime = wantsTransparency ? 'image/png' : 'image/jpeg';
  const ext = wantsTransparency ? 'png' : 'jpg';
  const blob = await canvasToBlob(canvas, mime, JPEG_QUALITY);
  const bytes = new Uint8Array(await blob.arrayBuffer());

  return { bytes, mime, ext, width, height };
}

export async function processCanvasDataUrl(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const { canvas, width, height } = drawScaled(bitmap, MAX_DIMENSION);
  bitmap.close();

  const out = await canvasToBlob(canvas, 'image/png');
  const bytes = new Uint8Array(await out.arrayBuffer());
  return { bytes, mime: 'image/png', ext: 'png', width, height };
}

async function loadBitmap(file) {
  try {
    return await createImageBitmap(file);
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('Could not read the image.'));
        i.src = url;
      });
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function drawScaled(source, maxDim) {
  const sw = source.width;
  const sh = source.height;
  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return { canvas, width, height };
}

async function hasTransparency(canvas) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const step = Math.max(1, Math.floor(Math.max(w, h) / 100));
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const alpha = data[(y * w + x) * 4 + 3];
      if (alpha < 250) return true;
    }
  }
  return false;
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Could not encode the image.')),
      mime,
      quality,
    );
  });
}
