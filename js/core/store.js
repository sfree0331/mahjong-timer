/**
 * GameStore — 対局状態の単一ソース（Model + ViewModel）
 * DOM 非依存の純粋モジュール。View は subscribe() で変更通知を受けて描画する。
 */

export const SEAT_NAMES = ['東', '南', '西', '北'];
export const RESULT_LABELS = {
  ron: 'ロン', tsumo: 'ツモ', ryukyoku: '流局',
};

export const TIME_PRESETS_MIN = [5, 10, 15, 20, 30, 60];
export const DEFAULT_TIME_MS = 10 * 60 * 1000;
export const DEFAULT_OVERTIME_MS = 3 * 60 * 1000;
export const WARN_YELLOW_MS = 30 * 1000;
export const WARN_RED_MS = 10 * 1000;
export const UNDO_LIMIT = 20;

export const DEFAULT_COLORS = ['#0A84FF', '#30D158', '#FF9F0A', '#BF5AF2'];

function createPlayer(seatIndex, timeMs) {
  return {
    id: seatIndex,
    name: SEAT_NAMES[seatIndex],
    color: DEFAULT_COLORS[seatIndex],
    remainingMs: timeMs,
    handThinkMs: 0,        // 現在の局で使った思考時間
    handTurns: 0,          // 現在の局の手番回数（1打平均の分母）
    overtimeUsed: false,   // 持ち時間切れ後の延長（1回）を使ったか
    warnStage: 0,          // 0:通常 1:30秒警告済 2:10秒警告済 3:切れ
  };
}

export function defaultSettings() {
  return {
    timeMs: DEFAULT_TIME_MS,
    overtimeMs: DEFAULT_OVERTIME_MS, // 切れ後の延長時間（0 = 延長なし・切れ負け）
    sound: true,
    vibration: true,
    theme: 'auto',      // 'auto' | 'light' | 'dark'
    fontScale: 'md',    // 'sm' | 'md' | 'lg'
  };
}

/**
 * phase:
 *  idle    … 局開始前（タイルタップでその人から計測開始）
 *  running … 計測中
 *  paused  … 一時停止（時間切れ含む）
 *
 * 局の概念（東1局など）は持たない。ロン/ツモ/流局で即記録して idle に戻り、
 * そのまま次の局を始められる（高速対局向け）。記録は通し番号で保存。
 */
export class GameStore {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.listeners = new Set();
    this.undoStack = [];
    this.state = {
      players: [0, 1, 2, 3].map((i) => createPlayer(i, DEFAULT_TIME_MS)),
      activeIndex: 0,
      phase: 'idle',
      timeoutIndex: null,
      handStartedAt: null,
      records: [],
      settings: defaultSettings(),
    };
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** プレイヤー人数（4人打ち / 3人打ち） */
  get playerCount() {
    return this.state.players.length;
  }

  /** @param {string} event 変更種別（View/効果音のフック用） */
  emit(event, payload = null) {
    for (const fn of this.listeners) fn(event, this.state, payload);
  }

  // ---------- Undo ----------

  pushUndo() {
    this.undoStack.push({
      activeIndex: this.state.activeIndex,
      phase: this.state.phase,
      timeoutIndex: this.state.timeoutIndex,
      handStartedAt: this.state.handStartedAt,
      recordsLen: this.state.records.length,
      players: this.state.players.map((p) => ({
        remainingMs: p.remainingMs,
        handThinkMs: p.handThinkMs,
        handTurns: p.handTurns,
        overtimeUsed: p.overtimeUsed,
        warnStage: p.warnStage,
      })),
    });
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
  }

  undo() {
    const snap = this.undoStack.pop();
    if (!snap) return false;
    const s = this.state;
    s.activeIndex = snap.activeIndex;
    s.timeoutIndex = snap.timeoutIndex;
    s.handStartedAt = snap.handStartedAt;
    // 局終了（記録確定）の取り消し → 記録も巻き戻す
    if (s.records.length > snap.recordsLen) s.records.length = snap.recordsLen;
    s.phase = snap.phase === 'idle' ? 'idle' : 'paused'; // 巻き戻し後は停止状態で再開待ち
    snap.players.forEach((ps, i) => {
      const p = s.players[i];
      p.remainingMs = ps.remainingMs;
      p.handThinkMs = ps.handThinkMs;
      p.handTurns = ps.handTurns;
      p.overtimeUsed = ps.overtimeUsed;
      p.warnStage = ps.warnStage;
    });
    this.emit('undo');
    return true;
  }

  // ---------- 進行 ----------

  /** 局を開始（idle → running） */
  start() {
    const s = this.state;
    if (s.phase !== 'idle') return;
    s.phase = 'running';
    s.handStartedAt = this.now();
    s.players[s.activeIndex].handTurns += 1; // 最初の手番
    this.emit('start');
  }

  /** 通常の手番送り（4人: 東→南→西→北→東、3人: 東→南→西→東） */
  passTurn() {
    const s = this.state;
    if (s.phase !== 'running') return;
    this.pushUndo();
    s.activeIndex = (s.activeIndex + 1) % this.playerCount;
    s.players[s.activeIndex].handTurns += 1;
    this.emit('turn');
  }

  /** 指定プレイヤーへタイマーを直接移動（running 中）。鳴きもこれで表現する */
  jumpTo(index) {
    const s = this.state;
    if (s.phase !== 'running') return;
    if (index < 0 || index >= this.playerCount || index === s.activeIndex) return;
    this.pushUndo();
    s.activeIndex = index;
    s.players[index].handTurns += 1;
    this.emit('turn');
  }

  /**
   * タイルタップの統一入口。どの状態からでも
   * 「タップした人へタイマーが飛んで計測が進む」。
   *  idle   → 開始してその人から計測
   *  paused → 再開してその人から計測
   *  running→ その人へ移動（手番の人自身のタップは何もしない）
   */
  tapPlayer(index) {
    const s = this.state;
    if (index < 0 || index >= this.playerCount) return;
    if (s.phase === 'idle') {
      this.start();
      if (index !== s.activeIndex) this.jumpTo(index);
    } else if (s.phase === 'paused') {
      this.resume();
      if (index !== s.activeIndex) this.jumpTo(index);
    } else if (s.phase === 'running') {
      this.jumpTo(index);
    }
  }

  /**
   * 局終了（ロン/ツモ/流局）。ワンタップで即記録して idle に戻る。
   * 確認モーダルは挟まない（高速対局向け）。間違えたら Undo で記録ごと戻せる。
   */
  endHand(result) {
    const s = this.state;
    if (s.phase !== 'running' && s.phase !== 'paused') return;
    this.pushUndo();
    const thinkTotal = s.players.reduce((a, p) => a + p.handThinkMs, 0);
    s.records.push({
      index: s.records.length + 1,
      result,
      startedAt: s.handStartedAt,
      endedAt: this.now(),
      avgThinkMs: Math.round(thinkTotal / this.playerCount),
      players: s.players.map((p) => ({
        name: p.name,
        thinkMs: p.handThinkMs,
        turns: p.handTurns,
        avgTurnMs: p.handTurns ? Math.round(p.handThinkMs / p.handTurns) : 0,
        remainingMs: p.remainingMs,
      })),
    });
    // 局内カウンタをリセットして即・次局待ちへ（Undo スタックは残す）
    for (const p of s.players) {
      p.handThinkMs = 0;
      p.handTurns = 0;
    }
    s.activeIndex = 0;
    s.timeoutIndex = null;
    s.handStartedAt = null;
    s.phase = 'idle';
    this.emit('handEnd', { result, count: s.records.length });
  }

  pause() {
    const s = this.state;
    if (s.phase !== 'running') return;
    s.phase = 'paused';
    this.emit('pause');
  }

  resume() {
    const s = this.state;
    if (s.phase !== 'paused') return;
    s.phase = 'running';
    s.timeoutIndex = null;
    this.emit('resume');
  }

  /**
   * タイマー刻み。running 中のみ手番プレイヤーの残り時間を減らす。
   * 30秒/10秒の閾値通過で警告イベント。
   * 持ち時間を使い切ったら overtimeMs の延長を 1 回付与（例: 10分切れ → 3分）。
   * 延長も使い切ったら timeout で自動停止。
   */
  tick(deltaMs) {
    const s = this.state;
    if (s.phase !== 'running' || deltaMs <= 0) return;
    const p = s.players[s.activeIndex];
    if (p.remainingMs <= 0) return; // 切れた人の時間は減らない
    p.remainingMs = Math.max(0, p.remainingMs - deltaMs);
    p.handThinkMs += deltaMs;
    if (p.remainingMs <= 0) {
      if (!p.overtimeUsed && s.settings.overtimeMs > 0) {
        // 延長付与（1回のみ）
        p.overtimeUsed = true;
        p.remainingMs = s.settings.overtimeMs;
        p.warnStage = 0;
        this.emit('overtime', { index: s.activeIndex });
      } else if (p.warnStage < 3) {
        p.warnStage = 3;
        s.timeoutIndex = s.activeIndex;
        s.phase = 'paused';
        this.emit('timeout', { index: s.activeIndex });
      }
    } else if (p.remainingMs <= WARN_RED_MS && p.warnStage < 2) {
      p.warnStage = 2;
      this.emit('warn10', { index: s.activeIndex });
    } else if (p.remainingMs <= WARN_YELLOW_MS && p.warnStage < 1) {
      p.warnStage = 1;
      this.emit('warn30', { index: s.activeIndex });
    } else {
      this.emit('tick');
    }
  }

  // ---------- 設定 ----------

  setPlayerName(index, name) {
    this.state.players[index].name = String(name).slice(0, 12) || SEAT_NAMES[index];
    this.emit('settings');
  }

  /** 持ち時間変更。全員の残り時間・延長をリセットする（記録は残る） */
  setTimeMs(ms) {
    const s = this.state;
    s.settings.timeMs = ms;
    for (const p of s.players) {
      p.remainingMs = ms;
      p.overtimeUsed = false;
      p.warnStage = 0;
    }
    this.undoStack = [];
    this.emit('settings');
  }

  updateSettings(patch) {
    Object.assign(this.state.settings, patch);
    this.emit('settings');
  }

  /**
   * 人数切替（4人打ち ⇔ 3人打ち）。タイマーはリセットするが記録は残す。
   */
  setPlayerCount(n) {
    if (n !== 3 && n !== 4) return;
    const s = this.state;
    if (n === this.playerCount) return;
    if (n === 3) s.players = s.players.slice(0, 3);
    else s.players.push(createPlayer(3, s.settings.timeMs));
    this.newGame();
    this.emit('playerCount');
  }

  /**
   * 新しい対局を開始。タイマー・延長・手番を初期化する。
   * 保存済みの記録（ログ）はそのまま残る。
   */
  newGame() {
    const s = this.state;
    for (const p of s.players) {
      p.remainingMs = s.settings.timeMs;
      p.handThinkMs = 0;
      p.handTurns = 0;
      p.overtimeUsed = false;
      p.warnStage = 0;
    }
    s.activeIndex = 0;
    s.phase = 'idle';
    s.timeoutIndex = null;
    s.handStartedAt = null;
    this.undoStack = [];
    this.emit('reset');
  }

  /** 保存済み記録の全削除（履歴画面から明示的に行う） */
  clearRecords() {
    this.state.records = [];
    this.emit('records');
  }

  // ---------- 永続化 ----------

  serialize() {
    return JSON.stringify({ v: 1, state: this.state });
  }

  hydrate(json) {
    try {
      const data = JSON.parse(json);
      if (!data || data.v !== 1 || !data.state) return false;
      const st = data.state;
      if (!Array.isArray(st.players) || ![3, 4].includes(st.players.length)) return false;
      // 旧バージョンの保存データ互換
      st.settings = { ...defaultSettings(), ...st.settings };
      if (!Array.isArray(st.records)) st.records = [];
      st.records.forEach((r, i) => { if (typeof r.index !== 'number') r.index = i + 1; });
      for (const p of st.players) {
        if (typeof p.overtimeUsed !== 'boolean') p.overtimeUsed = false;
        if (typeof p.handThinkMs !== 'number') p.handThinkMs = p.kyokuThinkMs ?? 0;
        if (typeof p.handTurns !== 'number') p.handTurns = 0;
      }
      if (typeof st.handStartedAt === 'undefined') st.handStartedAt = st.kyokuStartedAt ?? null;
      this.state = st;
      // 復元後は必ず停止状態から。旧 phase（kyokuEnd 等）は idle に落とす
      if (this.state.phase === 'running' || this.state.phase === 'selectCaller') {
        this.state.phase = 'paused';
      } else if (!['idle', 'paused'].includes(this.state.phase)) {
        this.state.phase = 'idle';
      }
      this.undoStack = [];
      this.emit('hydrate');
      return true;
    } catch {
      return false;
    }
  }
}
