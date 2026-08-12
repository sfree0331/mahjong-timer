import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { jpegPagesToPdf, dataUrlToBytes } from '../js/core/pdf.js';

const dec = new TextDecoder('latin1');

// JPEG マーカーだけ持つ最小ダミー（中身の妥当性は PDF 構造検証には不要）
function fakeJpeg(size = 64) {
  const b = new Uint8Array(size);
  b[0] = 0xFF; b[1] = 0xD8;               // SOI
  b[size - 2] = 0xFF; b[size - 1] = 0xD9; // EOI
  return b;
}

describe('jpegPagesToPdf', () => {
  test('PDF ヘッダ・フッタ・オブジェクト構造', () => {
    const pdf = jpegPagesToPdf([{ jpeg: fakeJpeg(), width: 1190, height: 1684 }]);
    const s = dec.decode(pdf);
    assert.ok(s.startsWith('%PDF-1.4'));
    assert.ok(s.endsWith('%%EOF'));
    assert.ok(s.includes('/Type /Catalog'));
    assert.ok(s.includes('/Count 1'));
    assert.ok(s.includes('/Filter /DCTDecode'));
    assert.ok(s.includes('/MediaBox [0 0 595 842]'));
    // 1ページ = catalog + pages + (page/image/content) = 5 オブジェクト
    assert.ok(s.includes('xref\n0 6\n'));
  });

  test('複数ページで Kids とオブジェクト数が増える', () => {
    const pgs = [1, 2, 3].map(() => ({ jpeg: fakeJpeg(), width: 100, height: 100 }));
    const s = dec.decode(jpegPagesToPdf(pgs));
    assert.ok(s.includes('/Count 3'));
    assert.ok(s.includes('/Kids [3 0 R 6 0 R 9 0 R]'));
    assert.ok(s.includes('xref\n0 12\n')); // 2 + 3*3 + 先頭free = 12 エントリ
  });

  test('xref のオフセットが実際のオブジェクト位置と一致する', () => {
    const pdf = jpegPagesToPdf([{ jpeg: fakeJpeg(), width: 10, height: 10 }]);
    const s = dec.decode(pdf);
    const xref = s.slice(s.indexOf('xref'));
    const entries = xref.split('\n').slice(3, 8); // 先頭のfreeエントリを飛ばしてオブジェクト1〜5
    entries.forEach((e, i) => {
      const off = parseInt(e.slice(0, 10), 10);
      assert.equal(s.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`);
    });
  });

  test('JPEG バイナリがそのままストリームに埋まる', () => {
    const jpeg = fakeJpeg(32);
    const pdf = jpegPagesToPdf([{ jpeg, width: 10, height: 10 }]);
    const s = dec.decode(pdf);
    assert.ok(s.includes(`/Length ${jpeg.length} >>`));
    // SOI マーカー（0xFF 0xD8）が本文に存在
    const idx = pdf.findIndex((b, i) => b === 0xFF && pdf[i + 1] === 0xD8);
    assert.ok(idx > 0);
  });
});

describe('dataUrlToBytes', () => {
  test('base64 データURLをバイト列に戻す', () => {
    const bytes = new Uint8Array([0xFF, 0xD8, 0x00, 0x41]);
    const b64 = Buffer.from(bytes).toString('base64');
    const out = dataUrlToBytes(`data:image/jpeg;base64,${b64}`);
    assert.deepEqual([...out], [...bytes]);
  });
});
