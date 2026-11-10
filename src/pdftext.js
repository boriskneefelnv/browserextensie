/*
 * PDF → tekstregels (met pdf.js). Tekst op dezelfde hoogte wordt één regel;
 * grote horizontale gaten worden 3+ spaties, zodat kolommen te scheiden zijn.
 */
// eslint-disable-next-line no-unused-vars
var BAPdf = (() => {
  let lib = null;

  async function load(baseUrl) {
    if (lib) return lib;
    lib = await import(baseUrl + 'pdf.min.mjs');
    if (lib.GlobalWorkerOptions) lib.GlobalWorkerOptions.workerSrc = baseUrl + 'pdf.worker.min.mjs';
    return lib;
  }

  function itemsToLines(items) {
    const rows = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4];
      const y = it.transform[5];
      const h = Math.abs(it.transform[3]) || 8;
      let row = rows.find((r) => Math.abs(r.y - y) < Math.max(2, h * 0.4));
      if (!row) rows.push((row = { y, items: [] }));
      row.items.push({ x, w: it.width || it.str.length * h * 0.5, s: it.str, h });
    }
    rows.sort((a, b) => b.y - a.y);
    return rows.map((r) => {
      r.items.sort((a, b) => a.x - b.x);
      let line = '';
      let end = null;
      for (const it of r.items) {
        if (end !== null) {
          const gap = it.x - end;
          line += gap > it.h * 1.5 ? '    ' : gap > it.h * 0.15 ? ' ' : '';
        }
        line += it.s;
        end = it.x + it.w;
      }
      return line.replace(/[ \t]+$/, '');
    });
  }

  /** Geeft { text, lines } terug voor alle pagina's. */
  async function extract(data, baseUrl) {
    const pdfjs = await load(baseUrl);
    const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
    const lines = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      lines.push(...itemsToLines(content.items));
    }
    return { text: lines.join('\n'), lines };
  }

  return { extract, itemsToLines };
})();
if (typeof module !== 'undefined') module.exports = BAPdf;
