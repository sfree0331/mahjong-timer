import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  GameStore, DEFAULT_TIME_MS, DEFAULT_OVERTIME_MS, UNDO_LIMIT,
} from '../js/core/store.js';

function newStore() {
  let t = 1_000_000;
  const store = new GameStore({ now: () => (t += 1000) });
  return store;
}

function startedStore() {
  const s = newStore();
  s.start();
  return s;
}

describe('手番送り', () => {
  test('東→南→西→北→東の順に回る', () => {
    const s = startedStore();
    assert.equal(s.state.activeIndex, 0);
    s.passTurn();
    assert.equal(s.state.activeIndex, 1);
    s.passTurn();
    s.passTurn();
    s.passTurn();
    assert.equal(s.state.activeIndex, 0);
  });

  test('idle 中は手番送り不可・start で開始', () => {
    const s = newStore();
    s.passTurn();
    assert.equal(s.state.activeIndex, 0);
    s.start();
    assert.equal(s.state.phase, 'running');
  });
});

describe('tapPlayer（タップ＝その人に飛んで計測開始）', () => {
  test('idle からタップ → その人から計測開始', () => {
    const s = newStore();
    s.tapPlayer(2);
    assert.equal(s.state.phase, 'running');
    assert.equal(s.state.activeIndex, 2);
    s.tick(1000);
    assert.equal(s.state.players[2].remainingMs, DEFAULT_TIME_MS - 1000);
  });

  test('paused からタップ → 再開してその人へ', () => {
    const s = startedStore();
    s.pause();
    s.tapPlayer(1);
    assert.equal(s.state.phase, 'running');
    assert.equal(s.state.activeIndex, 1);
  });

  test('running 中のタップ → その人へ移動、本人タップは無視', () => {
    const s = startedStore();
    s.tapPlayer(3);
    assert.equal(s.state.activeIndex, 3);
    s.tapPlayer(3);
    assert.equal(s.state.phase, 'running');
    assert.equal(s.state.activeIndex, 3);
    s.tapPlayer(1); // 逆方向もOK（ポンで戻る等）
    assert.equal(s.state.activeIndex, 1);
  });

  test('範囲外は無視・Undo履歴も汚さない', () => {
    const s = startedStore();
    const undoLen = s.undoStack.length;
    s.tapPlayer(4);
    s.tapPlayer(-1);
    assert.equal(s.state.activeIndex, 0);
    assert.equal(s.undoStack.length, undoLen);
  });

  test('時間切れ停止後も別の人をタップすれば続行できる', () => {
    const s = startedStore();
    s.updateSettings({ overtimeMs: 0 });
    s.tick(DEFAULT_TIME_MS + 100); // 東が切れて自動停止
    assert.equal(s.state.phase, 'paused');
    s.tapPlayer(1);
    assert.equal(s.state.phase, 'running');
    assert.equal(s.state.activeIndex, 1);
    assert.equal(s.state.timeoutIndex, null);
    s.tick(2000);
    assert.equal(s.state.players[1].remainingMs, DEFAULT_TIME_MS - 2000);
  });
});

describe('タイマー', () => {
  test('tick は手番プレイヤーの時間だけを減らす', () => {
    const s = startedStore();
    s.tick(5000);
    assert.equal(s.state.players[0].remainingMs, DEFAULT_TIME_MS - 5000);
    assert.equal(s.state.players[0].handThinkMs, 5000);
    assert.equal(s.state.players[1].remainingMs, DEFAULT_TIME_MS);
  });

  test('paused 中は減らない', () => {
    const s = startedStore();
    s.pause();
    s.tick(5000);
    assert.equal(s.state.players[0].remainingMs, DEFAULT_TIME_MS);
  });

  test('30秒/10秒でイベント発火', () => {
    const s = startedStore();
    const events = [];
    s.subscribe((e) => events.push(e));
    s.tick(DEFAULT_TIME_MS - 31_000); // 残31秒
    s.tick(2000);  // 残29秒 → warn30
    s.tick(20_000); // 残9秒 → warn10
    assert.ok(events.includes('warn30'));
    assert.ok(events.includes('warn10'));
  });
});

describe('延長（持ち時間切れ→3分）', () => {
  test('持ち時間を使い切ると延長時間が1回付与される', () => {
    const s = startedStore();
    const events = [];
    s.subscribe((e) => events.push(e));
    s.tick(DEFAULT_TIME_MS + 500);
    assert.ok(events.includes('overtime'));
    assert.equal(s.state.players[0].remainingMs, DEFAULT_OVERTIME_MS);
    assert.equal(s.state.players[0].overtimeUsed, true);
    assert.equal(s.state.phase, 'running'); // 止まらず続行
  });

  test('延長も使い切ると timeout で自動停止', () => {
    const s = startedStore();
    s.tick(DEFAULT_TIME_MS + 100);
    const events = [];
    s.subscribe((e) => events.push(e));
    s.tick(DEFAULT_OVERTIME_MS + 100);
    assert.ok(events.includes('timeout'));
    assert.equal(s.state.players[0].remainingMs, 0);
    assert.equal(s.state.phase, 'paused');
    // 再開してもその人の時間はもう減らない
    s.resume();
    s.tick(5000);
    assert.equal(s.state.players[0].remainingMs, 0);
  });

  test('延長なし設定（0）なら即切れ', () => {
    const s = startedStore();
    s.updateSettings({ overtimeMs: 0 });
    const events = [];
    s.subscribe((e) => events.push(e));
    s.tick(DEFAULT_TIME_MS + 100);
    assert.ok(events.includes('timeout'));
    assert.ok(!events.includes('overtime'));
  });

  test('延長状態は局をまたいで持ち越し・持ち時間変更でリセット', () => {
    const s = startedStore();
    s.tick(DEFAULT_TIME_MS + 100);
    s.endHand('ryukyoku');
    assert.equal(s.state.players[0].overtimeUsed, true); // 持ち越し
    s.setTimeMs(5 * 60 * 1000);
    assert.equal(s.state.players[0].overtimeUsed, false); // リセット
  });
});

describe('局終了（ワンタップ記録 → 即次局）', () => {
  test('endHand で通し番号付きの記録が保存され idle に戻る', () => {
    const s = startedStore();
    s.tick(4000);
    s.endHand('tsumo');
    const rec = s.state.records[0];
    assert.equal(rec.index, 1);
    assert.equal(rec.result, 'tsumo');
    assert.equal(rec.players[0].thinkMs, 4000);
    assert.equal(rec.avgThinkMs, 1000);
    assert.ok(rec.startedAt < rec.endedAt);
    // 即・次局待ち（モーダルなし）
    assert.equal(s.state.phase, 'idle');
    assert.equal(s.state.players[0].handThinkMs, 0);
    // 持ち時間は持ち越し
    assert.equal(s.state.players[0].remainingMs, DEFAULT_TIME_MS - 4000);
    // そのままタップで次局を開始できる
    s.tapPlayer(1);
    assert.equal(s.state.phase, 'running');
    assert.equal(s.state.activeIndex, 1);
  });

  test('連続で局を回すと通し番号が増える', () => {
    const s = newStore();
    for (let i = 0; i < 3; i += 1) {
      s.tapPlayer(0);
      s.tick(1000);
      s.endHand('ron');
    }
    assert.equal(s.state.records.length, 3);
    assert.deepEqual(s.state.records.map((r) => r.index), [1, 2, 3]);
  });

  test('間違えて押しても Undo で記録ごと元に戻る', () => {
    const s = startedStore();
    s.tick(3000);
    s.endHand('ron');
    assert.equal(s.state.records.length, 1);
    s.undo();
    assert.equal(s.state.records.length, 0);
    assert.equal(s.state.phase, 'paused'); // 局の途中に戻る（停止状態で再開待ち）
    assert.equal(s.state.players[0].handThinkMs, 3000);
  });
});

describe('1打平均（手番回数カウント）', () => {
  test('start/passTurn/jumpTo で手番回数が増える', () => {
    const s = startedStore(); // start で東の手番1
    assert.equal(s.state.players[0].handTurns, 1);
    s.passTurn(); // 南1
    assert.equal(s.state.players[1].handTurns, 1);
    s.jumpTo(0);  // 東2
    assert.equal(s.state.players[0].handTurns, 2);
    s.jumpTo(3);  // 北1
    assert.equal(s.state.players[3].handTurns, 1);
  });

  test('pause/resume では手番回数は増えない', () => {
    const s = startedStore();
    s.pause();
    s.resume();
    assert.equal(s.state.players[0].handTurns, 1);
  });

  test('endHand の記録に手番数と1打平均が入る', () => {
    const s = startedStore(); // 東1手番目
    s.tick(3000);
    s.passTurn();  // 南
    s.tick(2000);
    s.jumpTo(0);   // 東2手番目
    s.tick(1000);
    s.endHand('ron');
    const rec = s.state.records[0];
    assert.equal(rec.players[0].turns, 2);
    assert.equal(rec.players[0].thinkMs, 4000);
    assert.equal(rec.players[0].avgTurnMs, 2000); // 4000ms ÷ 2手番
    assert.equal(rec.players[1].turns, 1);
    assert.equal(rec.players[1].avgTurnMs, 2000);
    // 局終了で手番カウンタもリセット
    assert.equal(s.state.players[0].handTurns, 0);
  });

  test('Undo で手番回数も戻る', () => {
    const s = startedStore();
    s.passTurn(); // 南1
    s.undo();
    assert.equal(s.state.players[1].handTurns, 0);
    assert.equal(s.state.players[0].handTurns, 1);
  });
});

describe('Undo', () => {
  test('手番と時間が1手戻る', () => {
    const s = startedStore();
    s.tick(3000);
    s.passTurn();
    s.tick(2000);
    s.undo();
    assert.equal(s.state.activeIndex, 0);
    assert.equal(s.state.players[0].remainingMs, DEFAULT_TIME_MS - 3000);
    assert.equal(s.state.players[1].remainingMs, DEFAULT_TIME_MS);
    assert.equal(s.state.phase, 'paused');
  });

  test('jumpTo も Undo できる', () => {
    const s = startedStore();
    s.jumpTo(3);
    s.undo();
    assert.equal(s.state.activeIndex, 0);
  });

  test('履歴は20件まで', () => {
    const s = startedStore();
    for (let i = 0; i < 30; i += 1) s.passTurn();
    assert.equal(s.undoStack.length, UNDO_LIMIT);
    let count = 0;
    while (s.undo()) count += 1;
    assert.equal(count, UNDO_LIMIT);
  });
});

describe('新しい対局（記録は残す）', () => {
  test('newGame はタイマーを初期化し記録を残す', () => {
    const s = startedStore();
    s.tick(5000);
    s.endHand('ron');
    s.tapPlayer(0);
    s.tick(DEFAULT_TIME_MS); // 延長突入
    s.newGame();
    assert.equal(s.state.records.length, 1); // ★記録は消えない
    assert.equal(s.state.phase, 'idle');
    assert.equal(s.state.players[0].remainingMs, DEFAULT_TIME_MS);
    assert.equal(s.state.players[0].overtimeUsed, false);
    // 新しい対局の記録は通し番号が続く
    s.tapPlayer(0);
    s.tick(1000);
    s.endHand('tsumo');
    assert.equal(s.state.records[1].index, 2);
  });

  test('clearRecords で記録だけ全削除', () => {
    const s = startedStore();
    s.endHand('ron');
    s.clearRecords();
    assert.equal(s.state.records.length, 0);
  });
});

describe('三人麻雀', () => {
  function sanmaStore() {
    const s = newStore();
    s.setPlayerCount(3);
    return s;
  }

  test('切替で3人・タイマー初期化・記録は残る', () => {
    const s = startedStore();
    s.tick(5000);
    s.endHand('ron');
    s.setPlayerCount(3);
    assert.equal(s.state.players.length, 3);
    assert.equal(s.state.records.length, 1); // ★記録は残る
    assert.equal(s.state.phase, 'idle');
    assert.equal(s.state.players[0].remainingMs, DEFAULT_TIME_MS);
  });

  test('手番は東→南→西→東で回る', () => {
    const s = sanmaStore();
    s.start();
    s.passTurn();
    s.passTurn();
    assert.equal(s.state.activeIndex, 2);
    s.passTurn();
    assert.equal(s.state.activeIndex, 0);
  });

  test('tapPlayer は3人の範囲内のみ', () => {
    const s = sanmaStore();
    s.tapPlayer(3); // 存在しない北家
    assert.equal(s.state.phase, 'idle');
    s.tapPlayer(2);
    assert.equal(s.state.phase, 'running');
    assert.equal(s.state.activeIndex, 2);
  });

  test('平均思考時間は3人で割る', () => {
    const s = sanmaStore();
    s.start();
    s.tick(3000);
    s.endHand('tsumo');
    assert.equal(s.state.records[0].avgThinkMs, 1000);
    assert.equal(s.state.records[0].players.length, 3);
  });

  test('4人に戻すと北家が復活する', () => {
    const s = sanmaStore();
    s.setPlayerCount(4);
    assert.equal(s.state.players.length, 4);
    assert.equal(s.state.players[3].name, '北');
  });
});

describe('設定・永続化', () => {
  test('持ち時間変更で全員リセット（記録は残る）', () => {
    const s = startedStore();
    s.endHand('ron');
    s.tapPlayer(0);
    s.tick(5000);
    s.setTimeMs(5 * 60 * 1000);
    for (const p of s.state.players) assert.equal(p.remainingMs, 300_000);
    assert.equal(s.state.records.length, 1);
  });

  test('serialize→hydrate で状態復元（runningはpausedに）', () => {
    const s = startedStore();
    s.tick(7000);
    s.passTurn();
    s.endHand('ron');
    const json = s.serialize();
    const s2 = new GameStore();
    assert.ok(s2.hydrate(json));
    assert.equal(s2.state.players[0].remainingMs, DEFAULT_TIME_MS - 7000);
    assert.equal(s2.state.records.length, 1);
    assert.ok(['idle', 'paused'].includes(s2.state.phase));
  });

  test('旧バージョンの保存データ（局・鳴き形式）も復元できる', () => {
    const s = startedStore();
    const data = JSON.parse(s.serialize());
    // 旧形式を模擬
    data.state.phase = 'kyokuEnd';
    data.state.kyokuIndex = 5;
    data.state.records = [{
      label: '東1局', result: 'ron', startedAt: 1, endedAt: 2, avgThinkMs: 0,
      players: [{ name: '東', thinkMs: 0, remainingMs: 0 }],
    }];
    for (const p of data.state.players) {
      delete p.overtimeUsed;
      delete p.handThinkMs;
      p.kyokuThinkMs = 1234;
    }
    delete data.state.settings.overtimeMs;
    const s2 = new GameStore();
    assert.ok(s2.hydrate(JSON.stringify(data)));
    assert.equal(s2.state.phase, 'idle'); // 旧 phase は idle に落ちる
    assert.equal(s2.state.players[0].overtimeUsed, false);
    assert.equal(s2.state.players[0].handThinkMs, 1234);
    assert.equal(s2.state.records[0].index, 1); // 通し番号を補完
    assert.equal(s2.state.settings.overtimeMs, DEFAULT_OVERTIME_MS);
  });

  test('壊れたJSONは復元失敗を返す', () => {
    const s = new GameStore();
    assert.equal(s.hydrate('{"broken":'), false);
    assert.equal(s.hydrate('{"v":2}'), false);
  });
});
