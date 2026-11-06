const NS = {
  CONTAINER: 'urn:oasis:names:tc:opendocument:xmlns:container',
  OPF: 'http://www.idpf.org/2007/opf',
  DC: 'http://purl.org/dc/elements/1.1/',
};

const XHTML_MIME = 'application/xhtml+xml';
const SIG_PAGE_ID = 'signmyebook-sig-page';
const SIG_IMAGE_ID = 'signmyebook-sig-image';
const LEGACY_PAGE_IDS = ['ebookix-sig-page'];
const LEGACY_IMAGE_IDS = ['ebookix-sig-image'];

function isOurPageId(id) {
  return id === SIG_PAGE_ID || LEGACY_PAGE_IDS.includes(id);
}
function isOurImageId(id) {
  return id === SIG_IMAGE_ID || LEGACY_IMAGE_IDS.includes(id);
}
function isOurAnyId(id) {
  return isOurPageId(id) || isOurImageId(id);
}

export async function loadEpub(file) {
  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error("The file doesn't look like an EPUB or is corrupted.");
  }

  const mimetypeFile = zip.file('mimetype');
  if (!mimetypeFile) {
    throw new Error("The archive has no mimetype file — this isn't an EPUB.");
  }
  const mimetype = (await mimetypeFile.async('string')).trim();
  if (mimetype !== 'application/epub+zip') {
    throw new Error('Invalid mimetype: ' + mimetype);
  }

  if (zip.file('META-INF/encryption.xml')) {
    throw new Error("This file is DRM-protected. DRM can't be removed in the browser.");
  }

  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) {
    throw new Error('EPUB is missing META-INF/container.xml.');
  }
  const containerXml = await containerFile.async('string');
  const opfPath = findOpfPath(containerXml);

  const opfFile = zip.file(opfPath);
  if (!opfFile) {
    throw new Error('Manifest not found at path ' + opfPath);
  }
  const opfText = await opfFile.async('string');
  const opfDoc = parseXml(opfText, 'EPUB manifest');

  return {
    zip,
    opfPath,
    opfDoc,
    meta: extractMetadata(opfDoc),
    alreadySigned: isSigned(opfDoc),
  };
}

export async function signEpub(loaded, signature) {
  const { zip, opfPath, opfDoc } = loaded;
  const opfDir = opfPath.includes('/') ? opfPath.replace(/\/[^/]+$/, '/') : '';

  const manifest = requireOne(opfDoc, NS.OPF, 'manifest');
  const spine = requireOne(opfDoc, NS.OPF, 'spine');

  removeExistingSignature(manifest, spine, zip, opfDir);

  const usedIds = new Set(
    Array.from(manifest.getElementsByTagNameNS(NS.OPF, 'item'))
      .map((el) => el.getAttribute('id'))
      .filter(Boolean),
  );
  const usedHrefs = new Set(
    Array.from(manifest.getElementsByTagNameNS(NS.OPF, 'item'))
      .map((el) => el.getAttribute('href'))
      .filter(Boolean),
  );

  let imageHref = null;
  let imageManifestEntry = null;

  if (signature.image) {
    const baseName = `signmyebook-signature.${signature.image.ext}`;
    imageHref = uniqueHref(baseName, usedHrefs);
    const imageId = uniqueId(SIG_IMAGE_ID, usedIds);
    imageManifestEntry = createManifestItem(opfDoc, {
      id: imageId,
      href: imageHref,
      mediaType: signature.image.mime,
    });
  }

  const pageHref = uniqueHref('signmyebook-signature.xhtml', usedHrefs);
  const pageId = uniqueId(SIG_PAGE_ID, usedIds);
  const pageEntry = createManifestItem(opfDoc, {
    id: pageId,
    href: pageHref,
    mediaType: XHTML_MIME,
  });

  manifest.appendChild(pageEntry);
  if (imageManifestEntry) manifest.appendChild(imageManifestEntry);

  const itemref = opfDoc.createElementNS(NS.OPF, 'itemref');
  itemref.setAttribute('idref', pageId);
  itemref.setAttribute('linear', 'yes');
  const cover = spine.firstElementChild;
  if (cover) {
    spine.insertBefore(itemref, cover.nextElementSibling);
  } else {
    spine.appendChild(itemref);
  }

  const xhtml = signature.buildXhtml({
    text: signature.text,
    imageHref,
    date: signature.date,
  });

  const out = new JSZip();
  out.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  for (const path of Object.keys(zip.files)) {
    if (path === 'mimetype') continue;
    const entry = zip.files[path];
    if (entry.dir) continue;
    if (path === opfPath) continue;
    const data = await entry.async('uint8array');
    out.file(path, data, { compression: 'DEFLATE' });
  }

  out.file(opfDir + pageHref, xhtml, { compression: 'DEFLATE' });
  if (signature.image) {
    out.file(opfDir + imageHref, signature.image.bytes, { compression: 'DEFLATE' });
  }
  out.file(opfPath, serializeXml(opfDoc), { compression: 'DEFLATE' });

  return await out.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

function extractMetadata(opfDoc) {
  const titleEl = opfDoc.getElementsByTagNameNS(NS.DC, 'title')[0];
  const creatorEls = Array.from(opfDoc.getElementsByTagNameNS(NS.DC, 'creator'));
  return {
    title: textOf(titleEl),
    authors: creatorEls.map(textOf).filter(Boolean),
  };
}

function isSigned(opfDoc) {
  const items = Array.from(opfDoc.getElementsByTagNameNS(NS.OPF, 'item'));
  return items.some((item) => isOurAnyId(item.getAttribute('id')));
}

function removeExistingSignature(manifest, spine, zip, opfDir) {
  const items = Array.from(manifest.getElementsByTagNameNS(NS.OPF, 'item'));
  const removedIds = new Set();
  for (const item of items) {
    const id = item.getAttribute('id');
    if (!isOurAnyId(id)) continue;
    const href = item.getAttribute('href');
    if (href) zip.remove(opfDir + href);
    item.remove();
    removedIds.add(id);
  }
  if (removedIds.size === 0) return;

  const itemrefs = Array.from(spine.getElementsByTagNameNS(NS.OPF, 'itemref'));
  for (const ref of itemrefs) {
    if (removedIds.has(ref.getAttribute('idref'))) ref.remove();
  }
}

function findOpfPath(containerXml) {
  const doc = parseXml(containerXml, 'container.xml');
  const rootfiles = doc.getElementsByTagNameNS(NS.CONTAINER, 'rootfile');
  if (rootfiles.length === 0) {
    throw new Error('container.xml has no rootfile.');
  }
  const path = rootfiles[0].getAttribute('full-path');
  if (!path) throw new Error('container.xml has no full-path.');
  return path;
}

function parseXml(text, what) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error(`Could not parse ${what}.`);
  }
  return doc;
}

function serializeXml(doc) {
  let xml = new XMLSerializer().serializeToString(doc);
  if (!xml.startsWith('<?xml')) {
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + xml;
  }
  return xml;
}

function requireOne(doc, ns, tag) {
  const el = doc.getElementsByTagNameNS(ns, tag)[0];
  if (!el) throw new Error(`Manifest is missing <${tag}>.`);
  return el;
}

function createManifestItem(doc, { id, href, mediaType }) {
  const item = doc.createElementNS(NS.OPF, 'item');
  item.setAttribute('id', id);
  item.setAttribute('href', href);
  item.setAttribute('media-type', mediaType);
  return item;
}

function textOf(el) {
  return el?.textContent?.trim() || null;
}

function uniqueId(base, used) {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let i = 2;
  while (used.has(`${base}-${i}`)) i++;
  const id = `${base}-${i}`;
  used.add(id);
  return id;
}

function uniqueHref(base, used) {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const dot = base.lastIndexOf('.');
  const stem = dot >= 0 ? base.slice(0, dot) : base;
  const ext = dot >= 0 ? base.slice(dot) : '';
  let i = 2;
  while (used.has(`${stem}-${i}${ext}`)) i++;
  const href = `${stem}-${i}${ext}`;
  used.add(href);
  return href;
}
