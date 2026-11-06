export function createDrawpad(canvas, options = {}) {
  const ctx = canvas.getContext('2d');
  const strokes = [];
  let current = null;
  let thickness = options.thickness ?? 3;

  paint();

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onUp);

  function getPoint(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function onDown(e) {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const pt = getPoint(e);
    current = { thickness, points: [pt] };
  }

  function onMove(e) {
    if (!current) return;
    e.preventDefault();
    const pt = getPoint(e);
    current.points.push(pt);
    paint();
  }

  function onUp(e) {
    if (!current) return;
    if (canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    if (current.points.length > 0) strokes.push(current);
    current = null;
    paint();
  }

  function paint() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1e3a8a';

    const all = current ? [...strokes, current] : strokes;
    for (const stroke of all) {
      const pts = stroke.points;
      if (pts.length === 0) continue;
      ctx.lineWidth = stroke.thickness;
      ctx.beginPath();
      if (pts.length === 1) {
        ctx.arc(pts[0].x, pts[0].y, stroke.thickness / 2, 0, Math.PI * 2);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
        continue;
      }
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
    }
  }

  return {
    setThickness(value) { thickness = value; },
    undo() {
      strokes.pop();
      paint();
    },
    clear() {
      strokes.length = 0;
      current = null;
      paint();
    },
    isEmpty() {
      return strokes.length === 0 && !current;
    },
    toDataUrl() {
      const trimmed = trimToContent(canvas);
      return trimmed.toDataURL('image/png');
    },
  };
}

function trimToContent(canvas) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h).data;

  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] !== 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    const empty = document.createElement('canvas');
    empty.width = 1;
    empty.height = 1;
    return empty;
  }
  const pad = 16;
  const sx = Math.max(0, minX - pad);
  const sy = Math.max(0, minY - pad);
  const sw = Math.min(w, maxX + pad + 1) - sx;
  const sh = Math.min(h, maxY + pad + 1) - sy;

  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;
  out.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}
