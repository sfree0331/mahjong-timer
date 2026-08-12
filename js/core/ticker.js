/**
 * Ticker — 実時間ベースの刻み供給器。
 * setInterval のブレに影響されないよう、毎回 now() との差分を渡す。
 * クロックは注入可能（テスト用）。
 */
export class Ticker {
  constructor(onDelta, { intervalMs = 100, now = () => performance.now() } = {}) {
    this.onDelta = onDelta;
    this.intervalMs = intervalMs;
    this.now = now;
    this.id = null;
    this.last = 0;
  }

  get active() {
    return this.id !== null;
  }

  start() {
    if (this.id !== null) return;
    this.last = this.now();
    this.id = setInterval(() => {
      const t = this.now();
      const delta = t - this.last;
      this.last = t;
      // バックグラウンド復帰などで極端に大きい差分が来ても素通しする
      // （持ち時間制なので実経過時間をそのまま引くのが正しい）
      this.onDelta(delta);
    }, this.intervalMs);
  }

  stop() {
    if (this.id === null) return;
    clearInterval(this.id);
    this.id = null;
  }
}
