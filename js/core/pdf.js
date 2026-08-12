/**
 * pdf.js — 依存ゼロの最小 PDF ライター（DOM 非依存・テスト対象）
 *
 * JPEG 画像を 1 ページ 1 枚で貼り込む「画像 PDF」を生成する。
 * 日本語テキストは Canvas 側でシステムフォント描画済みのため、
 * フォント埋め込みが不要になり、完全オフライン・軽量で PDF 化できる。
 */

/**
 * @param {{jpeg: Uint8Array, width: number, height: number}[]} pages
 *   ページごとの JPEG バイナリとピクセルサイズ
 * @param {{pageW?: number, pageH?: number}} opts PDF ポイント単位のページサイズ（既定 A4 縦）
 * @returns {Uint8Array} PDF ファイルのバイト列
 */
export function jpegPagesToPdf(pages, { pageW = 595, pageH = 842 } = {}) {
  const enc = new TextEncoder(); // ASCII のみを書くので UTF-8 でも安全
  const chunks = [];
  let offset = 0;
  const offsets = [];

  const push = (bytes) => { chunks.push(bytes); offset += bytes.length; };
  const pushStr = (s) => push(enc.encode(s));
  const beginObj = (id) => { offsets[id] = offset; pushStr(`${id} 0 obj\n`); };

  pushStr('%PDF-1.4\n');

  // 1: カタログ / 2: ページツリー / 以降: ページ・画像・コンテンツ ×ページ数
  beginObj(1);
  pushStr('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  beginObj(2);
  pushStr(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach((pg, i) => {
    const pageId = 3 + i * 3;
    const imgId = pageId + 1;
    const contentId = pageId + 2;

    beginObj(pageId);
    pushStr(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] `
      + `/Resources << /XObject << /Im${i} ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`);

    beginObj(imgId);
    pushStr(`<< /Type /XObject /Subtype /Image /Width ${pg.width} /Height ${pg.height} `
      + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream\n`);
    push(pg.jpeg);
    pushStr('\nendstream\nendobj\n');

    const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im${i} Do Q`;
    beginObj(contentId);
    pushStr(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
  });

  const objCount = 2 + pages.length * 3;
  const xrefOffset = offset;
  pushStr(`xref\n0 ${objCount + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= objCount; id += 1) {
    pushStr(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  }
  pushStr(`trailer\n<< /Size ${objCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  const out = new Uint8Array(offset);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

/** data:image/jpeg;base64,... → Uint8Array（atob はブラウザ / Node 双方にある） */
export function dataUrlToBytes(dataUrl) {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
