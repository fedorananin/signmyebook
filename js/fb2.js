const FB2_NS = 'http://www.gribuser.ru/xml/fictionbook/2.0';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const SIG_MARKER = 'signmyebook-signature';
const SIG_BINARY_PREFIX = 'signmyebook-signature.';
const LEGACY_MARKERS = ['ebookix-signature'];
const LEGACY_BINARY_PREFIXES = ['ebookix-signature.'];

function isMarkerComment(node) {
  if (node.nodeType !== 8 || !node.data) return false;
  if (node.data.includes(SIG_MARKER)) return true;
  return LEGACY_MARKERS.some((m) => node.data.includes(m));
}

function isOurBinaryId(id) {
  if (!id) return false;
  if (id.startsWith(SIG_BINARY_PREFIX)) return true;
  return LEGACY_BINARY_PREFIXES.some((p) => id.startsWith(p));
}

export async function loadFb2(file) {
  const container = await readFb2Container(file);
  const doc = parseFb2Xml(container.xmlText);
  return {
    doc,
    container,
    meta: extractMetadata(doc),
    alreadySigned: isSigned(doc),
  };
}

export async function signFb2(loaded, signature) {
  const { doc, container } = loaded;
  removeExistingSignature(doc);

  const body = doc.getElementsByTagNameNS(FB2_NS, 'body')[0];
  if (!body) throw new Error('FB2 is missing <body>.');

  const epigraph = doc.createElementNS(FB2_NS, 'epigraph');

  if (signature.text && signature.text.trim().length > 0) {
    const blocks = signature.text.replace(/\r\n/g, '\n').split(/\n{2,}/);
    for (const block of blocks) {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        const p = doc.createElementNS(FB2_NS, 'p');
        p.textContent = line;
        epigraph.appendChild(p);
      }
    }
  }

  let imageBinary = null;
  if (signature.image) {
    const imageId = SIG_BINARY_PREFIX + signature.image.ext;
    const p = doc.createElementNS(FB2_NS, 'p');
    const img = doc.createElementNS(FB2_NS, 'image');
    img.setAttributeNS(XLINK_NS, 'l:href', '#' + imageId);
    p.appendChild(img);
    epigraph.appendChild(p);
    imageBinary = { id: imageId, mime: signature.image.mime, bytes: signature.image.bytes };
  }

  if (signature.date && signature.date.trim().length > 0) {
    const ta = doc.createElementNS(FB2_NS, 'text-author');
    ta.textContent = signature.date.trim();
    epigraph.appendChild(ta);
  }

  const insertionPoint = findEpigraphInsertionPoint(body);
  const marker = doc.createComment(' ' + SIG_MARKER + ' ');
  if (insertionPoint) {
    insertionPoint.parentNode.insertBefore(marker, insertionPoint.nextSibling);
    insertionPoint.parentNode.insertBefore(epigraph, marker.nextSibling);
  } else {
    body.insertBefore(marker, body.firstChild);
    body.insertBefore(epigraph, marker.nextSibling);
  }

  if (imageBinary) {
    const binary = doc.createElementNS(FB2_NS, 'binary');
    binary.setAttribute('id', imageBinary.id);
    binary.setAttribute('content-type', imageBinary.mime);
    binary.textContent = bytesToBase64(imageBinary.bytes);
    doc.documentElement.appendChild(binary);
  }

  let xml = new XMLSerializer().serializeToString(doc);
  xml = forceUtf8Declaration(xml);

  if (container.type === 'zip') {
    const zip = new JSZip();
    zip.file(container.innerName, xml);
    return await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/zip',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
  }
  return new Blob([xml], { type: 'application/x-fictionbook+xml' });
}

async function readFb2Container(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (isZip(buf)) {
    const zip = await JSZip.loadAsync(buf);
    const entries = Object.values(zip.files).filter((e) => !e.dir && /\.fb2$/i.test(e.name));
    if (entries.length === 0) {
      throw new Error('No .fb2 file found in the archive.');
    }
    const entry = entries[0];
    const innerBytes = await entry.async('uint8array');
    return {
      type: 'zip',
      innerName: entry.name,
      xmlText: decodeXml(innerBytes),
    };
  }
  return {
    type: 'plain',
    xmlText: decodeXml(buf),
  };
}

function isZip(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function decodeXml(bytes) {
  let head = '';
  for (let i = 0; i < Math.min(2048, bytes.length); i++) {
    head += String.fromCharCode(bytes[i]);
  }
  const m = head.match(/encoding\s*=\s*["']([^"']+)["']/i);
  const encoding = (m ? m[1] : 'utf-8').toLowerCase();
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

function parseFb2Xml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Could not parse FB2 (broken XML).');
  }
  if (doc.documentElement.localName !== 'FictionBook') {
    throw new Error('Not an FB2: root element must be FictionBook.');
  }
  return doc;
}

function extractMetadata(doc) {
  const titleInfo = doc.getElementsByTagNameNS(FB2_NS, 'title-info')[0];
  if (!titleInfo) return { title: null, authors: [] };

  const title = textOf(titleInfo.getElementsByTagNameNS(FB2_NS, 'book-title')[0]);
  const authors = Array.from(titleInfo.getElementsByTagNameNS(FB2_NS, 'author'))
    .map((author) => {
      const fn = textOf(author.getElementsByTagNameNS(FB2_NS, 'first-name')[0]);
      const mn = textOf(author.getElementsByTagNameNS(FB2_NS, 'middle-name')[0]);
      const ln = textOf(author.getElementsByTagNameNS(FB2_NS, 'last-name')[0]);
      const nick = textOf(author.getElementsByTagNameNS(FB2_NS, 'nickname')[0]);
      const composed = [fn, mn, ln].filter(Boolean).join(' ').trim();
      return composed || nick || null;
    })
    .filter(Boolean);

  return { title, authors };
}

function isSigned(doc) {
  const body = doc.getElementsByTagNameNS(FB2_NS, 'body')[0];
  if (body) {
    for (const child of Array.from(body.childNodes)) {
      if (isMarkerComment(child)) return true;
    }
  }
  const binaries = Array.from(doc.getElementsByTagNameNS(FB2_NS, 'binary'));
  return binaries.some((b) => isOurBinaryId(b.getAttribute('id')));
}

function removeExistingSignature(doc) {
  const body = doc.getElementsByTagNameNS(FB2_NS, 'body')[0];
  if (body) {
    const toRemove = [];
    const children = Array.from(body.childNodes);
    for (let i = 0; i < children.length; i++) {
      const node = children[i];
      if (isMarkerComment(node)) {
        toRemove.push(node);
        for (let j = i + 1; j < children.length; j++) {
          if (children[j].nodeType === 1) {
            toRemove.push(children[j]);
            break;
          }
        }
      }
    }
    toRemove.forEach((n) => n.remove());
  }

  const binaries = Array.from(doc.getElementsByTagNameNS(FB2_NS, 'binary'));
  for (const b of binaries) {
    if (isOurBinaryId(b.getAttribute('id'))) b.remove();
  }
}

function findEpigraphInsertionPoint(body) {
  let last = null;
  for (const child of Array.from(body.childNodes)) {
    if (child.nodeType !== 1) continue;
    const tag = child.localName;
    if (tag === 'image' || tag === 'title') {
      last = child;
    } else {
      break;
    }
  }
  return last;
}

function forceUtf8Declaration(xml) {
  if (xml.startsWith('<?xml')) {
    return xml.replace(/^<\?xml[^?]*\?>/i, '<?xml version="1.0" encoding="utf-8"?>');
  }
  return '<?xml version="1.0" encoding="utf-8"?>\n' + xml;
}

function textOf(el) {
  return el?.textContent?.trim() || null;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}
