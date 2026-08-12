import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatMs, formatSec, recordsToCsv, recordsToJson, summarize } from '../js/core/exporter.js';

const sampleRecords = [
  {
    index: 1,
    result: 'ron',
    startedAt: 1700000000000,
    endedAt: 1700000300000,
    avgThinkMs: 45000,
    players: [
      { name: 'A', thinkMs: 60000, turns: 10, avgTurnMs: 6000, remainingMs: 540000 },
      { name: 'B', thinkMs: 30000, turns: 10, avgTurnMs: 3000, remainingMs: 570000 },
      { name: 'C', thinkMs: 50000, turns: 10, avgTurnMs: 5000, remainingMs: 550000 },
      { name: 'D', thinkMs: 40000, turns: 10, avgTurnMs: 4000, remainingMs: 560000 },
    ],
  },
  {
    index: 2,
    result: 'tsumo',
    startedAt: 1700000300000,
    endedAt: 1700000600000,
    avgThinkMs: 30000,
    players: [
      { name: 'A', thinkMs: 20000, turns: 5, avgTurnMs: 4000, remainingMs: 520000 },
      { name: 'B', thinkMs: 40000, turns: 5, avgTurnMs: 8000, remainingMs: 530000 },
      { name: 'C', thinkMs: 30000, turns: 5, avgTurnMs: 6000, remainingMs: 520000 },
      { name: 'D', thinkMs: 30000, turns: 5, avgTurnMs: 6000, remainingMs: 530000 },
    ],
  },
];

describe('formatMs', () => {
  test('分:秒で表示、端数秒は切り上げ', () => {
    assert.equal(formatMs(600000), '10:00');
    assert.equal(formatMs(61000), '1:01');
    assert.equal(formatMs(900), '0:01');
    assert.equal(formatMs(0), '0:00');
    assert.equal(formatMs(-100), '0:00');
  });
});

describe('CSV出力', () => {
  test('ヘッダ + 局×4人の行、BOM付き', () => {
    const csv = recordsToCsv(sampleRecords);
    assert.ok(csv.startsWith('﻿'));
    const lines = csv.slice(1).split('\r\n');
    assert.equal(lines.length, 9); // ヘッダ + 2局×4人
    assert.ok(lines[0].startsWith('No,結果,開始,終了,プレイヤー'));
    assert.ok(lines[1].startsWith('1,ロン'));
    assert.ok(lines[1].includes(',A,60,'));
    assert.ok(lines[5].startsWith('2,ツモ'));
  });

  test('カンマ・引用符を含む名前をエスケープ', () => {
    const recs = JSON.parse(JSON.stringify(sampleRecords));
    recs[0].players[0].name = 'A,"X"';
    const csv = recordsToCsv(recs);
    assert.ok(csv.includes('"A,""X"""'));
  });
});

describe('JSON出力', () => {
  test('メタ情報付きでパース可能', () => {
    const json = recordsToJson(sampleRecords, { exportedAt: '2026-08-05T00:00:00Z' });
    const data = JSON.parse(json);
    assert.equal(data.app, 'mahjong-timer');
    assert.equal(data.records.length, 2);
    assert.equal(data.records[0].players[1].thinkMs, 30000);
  });
});

describe('集計', () => {
  test('プレイヤー別合計と局平均・1打平均', () => {
    const t = summarize(sampleRecords);
    assert.equal(t.A.thinkMs, 80000);
    assert.equal(t.A.kyoku, 2);
    assert.equal(t.A.avgThinkMs, 40000);
    assert.equal(t.A.turns, 15);
    assert.equal(t.A.avgTurnMs, Math.round(80000 / 15));
    assert.equal(t.B.thinkMs, 70000);
  });

  test('旧記録（turns なし）でも集計が壊れない', () => {
    const recs = JSON.parse(JSON.stringify(sampleRecords));
    for (const r of recs) for (const p of r.players) { delete p.turns; delete p.avgTurnMs; }
    const t = summarize(recs);
    assert.equal(t.A.turns, 0);
    assert.equal(t.A.avgTurnMs, 0);
  });
});

describe('formatSec', () => {
  test('整数秒と小数1桁', () => {
    assert.equal(formatSec(6000), '6秒');
    assert.equal(formatSec(12540), '12.5秒');
    assert.equal(formatSec(0), '0秒');
  });
});
