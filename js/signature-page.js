export function buildSignatureXhtml({ text, imageHref, date }) {
  const parts = [];
  if (text && text.trim().length > 0) {
    parts.push(renderText(text));
  }
  if (imageHref) {
    parts.push(`      <div class="ebookix-image"><img src="${escapeAttr(imageHref)}" alt=""/></div>`);
  }
  if (date && date.trim().length > 0) {
    parts.push(`      <p class="ebookix-date">${escapeXml(date.trim())}</p>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
<head>
  <title>Autograph</title>
  <meta http-equiv="Content-Type" content="application/xhtml+xml; charset=utf-8"/>
  <style type="text/css">
    body { margin: 0; padding: 0; }
    .ebookix-page {
      box-sizing: border-box;
      min-height: 95vh;
      padding: 2em 1.5em;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
    }
    .ebookix-text {
      margin: 0 0 1.5em 0;
      font-size: 1.1em;
      line-height: 1.5;
      max-width: 28em;
      white-space: pre-wrap;
      color: #1e3a8a;
    }
    .ebookix-text p { margin: 0 0 0.5em 0; }
    .ebookix-text p:last-child { margin-bottom: 0; }
    .ebookix-image { margin: 0 0 1.5em 0; }
    .ebookix-image:last-child { margin-bottom: 0; }
    .ebookix-image img {
      max-width: 90%;
      max-height: 60vh;
      height: auto;
      width: auto;
    }
    .ebookix-date {
      margin: 0;
      font-size: 0.9em;
      font-style: italic;
      color: #1e3a8a;
      opacity: 0.8;
    }
  </style>
</head>
<body>
  <div class="ebookix-page">
${parts.join('\n')}
  </div>
</body>
</html>
`;
}

function renderText(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n\n');
  const paragraphs = lines
    .map((para) => {
      const inner = escapeXml(para).replace(/\n/g, '<br/>');
      return `      <p>${inner}</p>`;
    })
    .join('\n');
  return `      <div class="ebookix-text">\n${paragraphs}\n      </div>`;
}

function escapeXml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return escapeXml(s).replace(/"/g, '&quot;');
}
