import { loadEpub, signEpub } from './js/epub.js';
import { loadFb2, signFb2 } from './js/fb2.js';
import { processImageFile, processCanvasDataUrl } from './js/image.js';
import { createDrawpad } from './js/drawpad.js';
import { buildSignatureXhtml } from './js/signature-page.js';

const ADAPTERS = {
  epub: {
    load: loadEpub,
    sign: (loaded, sig) => signEpub(loaded, { ...sig, buildXhtml: buildSignatureXhtml }),
  },
  fb2: {
    load: loadFb2,
    sign: signFb2,
  },
};

function detectFormat(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.epub')) return 'epub';
  if (name.endsWith('.fb2') || name.endsWith('.fb2.zip')) return 'fb2';
  return null;
}

function getAdapter(format) {
  return ADAPTERS[format] || null;
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

function trackEvent(eventName, eventData = {}) {
  try {
    if (window.umami && typeof window.umami.track === 'function') {
      window.umami.track(eventName, eventData);
    }
  } catch (e) {
    // Ignore tracking errors
  }
}

const els = {
  dropzone: document.getElementById('dropzone'),
  epubInput: document.getElementById('epub-input'),
  fileName: document.getElementById('file-name'),
  fileSize: document.getElementById('file-size'),
  fileClear: document.getElementById('file-clear'),
  emptyView: document.querySelector('.dropzone-empty'),
  filledView: document.querySelector('.dropzone-filled'),
  meta: document.getElementById('meta'),
  metaTitle: document.getElementById('meta-title'),
  metaAuthor: document.getElementById('meta-author'),
  metaAuthorRow: document.getElementById('meta-author-row'),
  alreadySigned: document.getElementById('already-signed'),
  textInput: document.getElementById('text-input'),
  tabs: Array.from(document.querySelectorAll('.tab')),
  tabPanels: Array.from(document.querySelectorAll('.tab-panel')),
  imageDropzone: document.getElementById('image-dropzone'),
  imageInput: document.getElementById('image-input'),
  imageName: document.getElementById('image-name'),
  imagePreviewImg: document.getElementById('image-preview-img'),
  imageEmpty: document.querySelector('.image-dropzone-empty'),
  imageFilled: document.querySelector('.image-dropzone-filled'),
  imageClear: document.getElementById('image-clear'),
  drawpadCanvas: document.getElementById('drawpad'),
  drawpadThickness: document.getElementById('drawpad-thickness'),
  drawpadUndo: document.getElementById('drawpad-undo'),
  drawpadClear: document.getElementById('drawpad-clear'),
  dateInput: document.getElementById('date-input'),
  submit: document.getElementById('submit'),
  hint: document.getElementById('hint'),
  error: document.getElementById('error'),
  status: document.getElementById('status'),
  previewFrame: document.getElementById('preview-frame'),
  previewCaption: document.getElementById('preview-caption'),
};

const MONTH_YEAR = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date());
const EXAMPLE_PAGE = {
  text: 'For Sam,\nwho read the first draft\nand asked for more.\n\nWith thanks,\nAlex',
  date: `Lisbon, ${MONTH_YEAR}`,
};

const state = {
  bookFile: null,
  bookFormat: null,
  bookMeta: null,
  imageSource: 'none',
  imageFile: null,
  imageObjectUrl: null,
  drawnHref: null,
  busy: false,
};

let previewTimer = null;
let lastPreviewDoc = null;

const drawpad = createDrawpad(els.drawpadCanvas);

initDropzone();
initTextarea();
initTabs();
initImageDropzone();
initDrawpad();
initDate();
els.submit.addEventListener('click', onSubmit);
updateState();

function initDropzone() {
  els.dropzone.addEventListener('click', (e) => {
    if (e.target.closest('.link')) return;
    els.epubInput.click();
  });

  els.epubInput.addEventListener('change', () => {
    const file = els.epubInput.files?.[0];
    if (file) handleBookFile(file);
  });

  els.fileClear.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    setBookFile(null, null, null);
    els.epubInput.value = '';
  });

  attachDropHandlers(els.dropzone, (file) => handleBookFile(file));
}

async function handleBookFile(file) {
  const format = detectFormat(file);
  trackEvent('Upload Book Started', { format: format || 'unknown' });
  if (!format) {
    setBookFile(null, null, null);
    els.epubInput.value = '';
    setError('Only .epub, .fb2 and .fb2.zip files are supported.');
    return;
  }
  setBookFile(file, format, null);
  setStatus('Reading metadata…');
  try {
    const adapter = getAdapter(format);
    const loaded = await adapter.load(file);
    setBookFile(file, format, {
      title: loaded.meta.title,
      authors: loaded.meta.authors,
      alreadySigned: loaded.alreadySigned,
    });
    clearMessages();
  } catch (err) {
    console.error(err);
    setBookFile(null, null, null);
    els.epubInput.value = '';
    setError(err.message || 'Could not read the book.');
  }
}

function setBookFile(file, format, meta) {
  state.bookFile = file;
  state.bookFormat = format;
  state.bookMeta = meta;

  if (file) {
    els.emptyView.hidden = true;
    els.filledView.hidden = false;
    els.fileName.textContent = file.name;
    els.fileSize.textContent = formatBytes(file.size);
  } else {
    els.emptyView.hidden = false;
    els.filledView.hidden = true;
  }

  if (meta) {
    els.metaTitle.textContent = meta.title || '—';
    if (meta.authors && meta.authors.length > 0) {
      els.metaAuthor.textContent = meta.authors.join(', ');
      els.metaAuthorRow.hidden = false;
    } else {
      els.metaAuthorRow.hidden = true;
    }
    els.meta.hidden = false;
    els.alreadySigned.hidden = !meta.alreadySigned;
  } else {
    els.meta.hidden = true;
    els.alreadySigned.hidden = true;
  }

  updateState();
}

function initTextarea() {
  els.textInput.addEventListener('input', updateState);
}

function initDate() {
  els.dateInput.placeholder = EXAMPLE_PAGE.date;
  els.dateInput.addEventListener('input', updateState);
}

function initTabs() {
  els.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const source = tab.dataset.source;
      els.tabs.forEach((t) => t.classList.toggle('active', t === tab));
      els.tabPanels.forEach((panel) => {
        panel.hidden = panel.dataset.panel !== source;
      });
      state.imageSource = source;
      updateState();
    });
  });
}

function initImageDropzone() {
  els.imageDropzone.addEventListener('click', (e) => {
    if (e.target.closest('.link')) return;
    els.imageInput.click();
  });

  els.imageInput.addEventListener('change', () => {
    const file = els.imageInput.files?.[0];
    setImageFile(file || null);
  });

  els.imageClear.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    setImageFile(null);
    els.imageInput.value = '';
  });

  attachDropHandlers(els.imageDropzone, (file) => {
    if (!file.type.startsWith('image/')) {
      setError('Not an image file.');
      return;
    }
    setImageFile(file);
  });
}

function setImageFile(file) {
  if (state.imageObjectUrl) {
    URL.revokeObjectURL(state.imageObjectUrl);
    state.imageObjectUrl = null;
  }
  state.imageFile = file;

  if (file) {
    state.imageObjectUrl = URL.createObjectURL(file);
    els.imagePreviewImg.src = state.imageObjectUrl;
    els.imageName.textContent = file.name;
    els.imageEmpty.hidden = true;
    els.imageFilled.hidden = false;
  } else {
    els.imagePreviewImg.removeAttribute('src');
    els.imageEmpty.hidden = false;
    els.imageFilled.hidden = true;
  }
  updateState();
}

function initDrawpad() {
  els.drawpadThickness.addEventListener('input', () => {
    drawpad.setThickness(Number(els.drawpadThickness.value));
  });
  drawpad.setThickness(Number(els.drawpadThickness.value));
  const onDrawingChanged = () => {
    state.drawnHref = null;
    updateState();
  };
  els.drawpadUndo.addEventListener('click', () => {
    drawpad.undo();
    onDrawingChanged();
  });
  els.drawpadClear.addEventListener('click', () => {
    drawpad.clear();
    onDrawingChanged();
  });
  els.drawpadCanvas.addEventListener('pointerup', onDrawingChanged);
  els.drawpadCanvas.addEventListener('pointercancel', onDrawingChanged);
}

function attachDropHandlers(zone, onDrop) {
  ['dragenter', 'dragover'].forEach((ev) => {
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
    });
  });
  zone.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) onDrop(file);
  });
}

function hasImage() {
  if (state.imageSource === 'file') return !!state.imageFile;
  if (state.imageSource === 'draw') return !drawpad.isEmpty();
  return false;
}

function hasText() {
  return els.textInput.value.trim().length > 0;
}

function hasSignatureContent() {
  return hasText() || hasImage();
}

function updateButtons() {
  const ready = !!state.bookFile && !!state.bookMeta && hasSignatureContent() && !state.busy;
  els.submit.disabled = !ready;
}

function updateHint() {
  if (!state.bookFile) {
    setHint('Choose a book, then add a dedication or a signature.');
  } else if (!state.bookMeta) {
    setHint('Reading the book…');
  } else if (!hasSignatureContent()) {
    setHint('Now add a dedication or a signature.');
  } else {
    setHint('Ready when you are.');
  }
}

function updateState() {
  updateButtons();
  updateHint();
  schedulePreview();
}

// ---- Live preview -------------------------------------------------------
// Renders the exact XHTML that gets inserted into the book. Until the user
// adds anything, it shows an example page instead of an empty one.

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 120);
}

function currentImageHref() {
  if (state.imageSource === 'file' && state.imageObjectUrl) return state.imageObjectUrl;
  if (state.imageSource === 'draw' && !drawpad.isEmpty()) {
    if (!state.drawnHref) state.drawnHref = drawpad.toDataUrl();
    return state.drawnHref;
  }
  return null;
}

function renderPreview() {
  const text = els.textInput.value;
  const date = els.dateInput.value;
  const imageHref = currentImageHref();
  const isEmpty = !text.trim() && !date.trim() && !imageHref;

  const doc = buildSignatureXhtml(isEmpty
    ? { text: EXAMPLE_PAGE.text, imageHref: null, date: EXAMPLE_PAGE.date }
    : { text, imageHref, date });

  if (doc !== lastPreviewDoc) {
    els.previewFrame.srcdoc = doc;
    lastPreviewDoc = doc;
  }
  els.previewCaption.textContent = isEmpty
    ? 'An example. Start typing and this becomes your page.'
    : 'This page goes right after the cover.';
}

function setHint(msg) {
  els.hint.textContent = msg;
  els.hint.hidden = false;
  els.error.hidden = true;
  els.status.hidden = true;
}

function setError(msg) {
  els.error.textContent = msg;
  els.error.hidden = false;
  els.hint.hidden = true;
  els.status.hidden = true;
}

function setStatus(msg) {
  els.status.textContent = msg;
  els.status.hidden = false;
  els.hint.hidden = true;
  els.error.hidden = true;
}

function clearMessages() {
  els.error.hidden = true;
  els.status.hidden = true;
}

async function buildImageData() {
  if (state.imageSource === 'file' && state.imageFile) {
    return await processImageFile(state.imageFile);
  }
  if (state.imageSource === 'draw' && !drawpad.isEmpty()) {
    return await processCanvasDataUrl(drawpad.toDataUrl());
  }
  return null;
}

async function onSubmit() {
  if (state.busy) return;
  state.busy = true;
  trackEvent('Sign and Download', { format: state.bookFormat });
  updateState();
  setStatus('Processing the book…');

  try {
    const adapter = getAdapter(state.bookFormat);
    if (!adapter) throw new Error('Unsupported format.');

    let imageData = null;
    if (state.imageSource !== 'none') {
      setStatus('Preparing the image…');
      imageData = await buildImageData();
    }

    setStatus('Reading the book…');
    const loaded = await adapter.load(state.bookFile);

    setStatus('Inserting the signature…');
    const blob = await adapter.sign(loaded, {
      text: els.textInput.value,
      image: imageData,
      date: els.dateInput.value,
    });

    const outName = makeOutputName(state.bookFile.name);
    triggerDownload(blob, outName);
    state.busy = false;
    updateButtons();
    setStatus(`Saved as ${outName}. Change anything and download again if you like.`);
    return;
  } catch (err) {
    console.error(err);
    setError(err.message || 'Something went wrong.');
  }
  state.busy = false;
  updateButtons();
}

function makeOutputName(original) {
  const lower = original.toLowerCase();
  if (lower.endsWith('.fb2.zip')) {
    return original.slice(0, -8) + '-signed.fb2.zip';
  }
  if (lower.endsWith('.fb2')) {
    return original.slice(0, -4) + '-signed.fb2';
  }
  if (lower.endsWith('.epub')) {
    return original.slice(0, -5) + '-signed.epub';
  }
  return original + '-signed';
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
