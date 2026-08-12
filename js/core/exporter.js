/**
 * exporter — 対局記録の CSV / JSON 変換（純粋関数・DOM 非依存）
 */
import { RESULT_LABELS } from './store.js';

/** ms → "m:ss" 表示 */
export function formatMs(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** ms → 秒（小数1桁） */
export function msToSec(ms) {
  return Math.round(ms / 100) / 10;
}

function isoOrEmpty(ts) {
  return ts ? new Date(ts).toISOString() : '';
}

/** 記録配列 → JSON 文字列（メタ情報付き） */
export function recordsToJson(records, meta = {}) {
  return JSON.stringify(
    {
      app: 'mahjong-timer',
      version: 1,
      exportedAt: meta.exportedAt ?? null,
      records,
    },
    null,
    2,
  );
}

/** 記録配列 → CSV 文字列（局×プレイヤーの行形式、Excel 向け BOM 付き） */
export function recordsToCsv(records) {
  const header = [
    'No', '結果', '開始', '終了',
    'プレイヤー', '思考時間(秒)', '残り時間(秒)', '平均思考(秒)',
  ];
  const rows = [header];
  for (const r of records) {
    for (const p of r.players) {
      rows.push([
        r.index ?? r.label ?? '',
        RESULT_LABELS[r.result] ?? r.result,
        isoOrEmpty(r.startedAt),
        isoOrEmpty(r.endedAt),
        p.name,
        msToSec(p.thinkMs),
        msToSec(p.remainingMs),
        msToSec(r.avgThinkMs),
      ]);
    }
  }
  const body = rows
    .map((row) => row.map((cell) => {
      const s = String(cell);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','))
    .join('\r\n');
  return `﻿${body}`;
}

/** 記録から集計（プレイヤー別の合計・平均思考時間） */
export function summarize(records) {
  const totals = {};
  for (const r of records) {
    for (const p of r.players) {
      const t = (totals[p.name] ??= { thinkMs: 0, kyoku: 0 });
      t.thinkMs += p.thinkMs;
      t.kyoku += 1;
    }
  }
  for (const t of Object.values(totals)) {
    t.avgThinkMs = t.kyoku ? Math.round(t.thinkMs / t.kyoku) : 0;
  }
  return totals;
}
