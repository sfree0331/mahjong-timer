/**
 * pdfReport.js — 対局記録を Canvas に描画して PDF 化する（A4 縦・複数ページ対応）
 * 時間の単位はログ画面と同じ「3分24秒 / 45秒 / 4.1秒」形式で統一する。
 */
import { jpegPagesToPdf, dataUrlToBytes } from '../core/pdf.js';
import { formatDuration, formatSec, summarize } from '../core/exporter.js';
import { RESULT_LABELS } from '../core/store.js';

const PAGE_W = 595;   // A4 (pt)
const PAGE_H = 842;
const SCALE = 2;      // 高解像度描画
const M = 48;         // 余白
const FONT = '"Yu Gothic UI", "Hiragino Sans", "Segoe UI", sans-serif';

/** @returns {Uint8Array} PDF バイト列 */
export function buildRecordsPdfBytes(records, { exportedAt = new Date() } = {}) {
  const pages = [];
  let canvas = null;
  let ctx = null;
  let y = 0;
  let pageNo = 0;

  const text = (str, x, ty, { size = 11, bold = false, color = '#1C1C1E', align = 'left' } = {}) => {
    ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(str, x, ty);
  };

  const line = (x1, y1, x2, y2, color = '#D8D8DC') => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };

  const flushPage = () => {
    if (!canvas) return;
    text(`${pageNo}`, PAGE_W / 2, PAGE_H - 24, { size: 9, color: '#8E8E93', align: 'center' });
    pages.push({
      jpeg: dataUrlToBytes(canvas.toDataURL('image/jpeg', 0.92)),
      width: canvas.width,
      height: canvas.height,
    });
  };

  const newPage = () => {
    flushPage();
    pageNo += 1;
    canvas = document.createElement('canvas');
    canvas.width = PAGE_W * SCALE;
    canvas.height = PAGE_H * SCALE;
    ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    ctx.textBaseline = 'alphabetic';
    y = M;
    if (pageNo > 1) {
      text('麻雀対局タイマー 対局記録（続き）', M, y, { size: 10, color: '#8E8E93' });
      y += 24;
    }
  };

  /** 残り高さが足りなければ改ページ */
  const ensure = (needed) => {
    if (y + needed > PAGE_H - 48) newPage();
  };

  const fmtClock = (ts) => {
    if (!ts) return '--:--';
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const fmtDate = (d) => `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} `
    + `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  // ---------- 1ページ目ヘッダー ----------
  newPage();
  text('麻雀対局タイマー 対局記録', M, y + 8, { size: 20, bold: true });
  y += 30;
  text(`出力日時: ${fmtDate(exportedAt)}　　記録数: ${records.length}局`, M, y, { size: 10, color: '#8E8E93' });
  y += 26;

  // ---------- 集計（プレイヤー別） ----------
  text('プレイヤー別 集計', M, y, { size: 13, bold: true });
  y += 18;
  const cols = [M, M + 140, M + 260, M + 380];
  text('名前', cols[0], y, { size: 10, bold: true, color: '#8E8E93' });
  text('思考合計', cols[1], y, { size: 10, bold: true, color: '#8E8E93' });
  text('局平均', cols[2], y, { size: 10, bold: true, color: '#8E8E93' });
  text('1打平均', cols[3], y, { size: 10, bold: true, color: '#8E8E93' });
  y += 6;
  line(M, y, PAGE_W - M, y);
  y += 16;
  const totals = summarize(records);
  for (const [name, t] of Object.entries(totals)) {
    ensure(20);
    text(name, cols[0], y, { size: 11, bold: true });
    text(formatDuration(t.thinkMs), cols[1], y, { size: 11 });
    text(formatDuration(t.avgThinkMs), cols[2], y, { size: 11 });
    text(t.turns ? formatSec(t.avgTurnMs) : '—', cols[3], y, { size: 11 });
    y += 6;
    line(M, y, PAGE_W - M, y, '#EDEDF0');
    y += 14;
  }
  y += 12;

  // ---------- 局別の記録 ----------
  ensure(40);
  text('局別の記録', M, y, { size: 13, bold: true });
  y += 20;

  for (const r of records) {
    const playerLines = r.players.length;
    ensure(22 + playerLines * 16 + 12);
    // 局ヘッダー行
    text(`#${r.index ?? ''}`, M, y, { size: 12, bold: true });
    text(RESULT_LABELS[r.result] ?? r.result, M + 36, y, { size: 11, bold: true, color: '#B25000' });
    text(`${fmtClock(r.startedAt)}〜${fmtClock(r.endedAt)}　局平均 ${formatDuration(r.avgThinkMs)}`,
      PAGE_W - M, y, { size: 10, color: '#8E8E93', align: 'right' });
    y += 16;
    for (const p of r.players) {
      const turnsPart = p.turns
        ? `　手番 ${p.turns}回　1打平均 ${formatSec(p.avgTurnMs)}`
        : '';
      text(`${p.name}：思考 ${formatDuration(p.thinkMs)}${turnsPart}　残り ${formatDuration(p.remainingMs)}`,
        M + 12, y, { size: 10.5 });
      y += 16;
    }
    y += 4;
    line(M, y, PAGE_W - M, y, '#EDEDF0');
    y += 14;
  }

  flushPage();
  return jpegPagesToPdf(pages, { pageW: PAGE_W, pageH: PAGE_H });
}
