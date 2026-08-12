/**
 * BoardView — 縦一列のプレイヤーリストの描画・タップ処理
 */
import { WARN_YELLOW_MS, WARN_RED_MS } from '../core/store.js';
import { formatMs, formatSec } from '../core/exporter.js';

const SEAT_MARKS = ['東', '南', '西', '北'];

export class BoardView {
  /**
   * @param {import('../core/store.js').GameStore} store
   * @param {{onTileTap:(i:number)=>void}} handlers
   */
  constructor(store, handlers) {
    this.store = store;
    this.handlers = handlers;
    this.tiles = [];
    this.el = {
      list: document.getElementById('player-list'),
      hint: document.getElementById('center-hint'),
      count: document.getElementById('center-count'),
    };
    this.buildTiles();
  }

  /** 人数変更・復元時に呼び直せるよう、リストを空にしてから作り直す */
  buildTiles() {
    this.el.list.innerHTML = '';
    this.tiles = [];
    this.store.state.players.forEach((p, i) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'player-tile';
      tile.dataset.index = String(i);
      tile.innerHTML = `
        <span class="tile-head">
          <span class="seat-mark">${SEAT_MARKS[i]}</span>
          <span class="tile-name"></span>
          <span class="overtime-badge">延長</span>
        </span>
        <span class="tile-right">
          <span class="tile-time">0:00</span>
          <span class="tile-avg"></span>
        </span>`;
      tile.addEventListener('click', () => this.handlers.onTileTap(i));
      this.el.list.appendChild(tile);
      this.tiles.push({
        root: tile,
        name: tile.querySelector('.tile-name'),
        time: tile.querySelector('.tile-time'),
        avg: tile.querySelector('.tile-avg'),
      });
    });
  }

  render() {
    const s = this.store.state;
    s.players.forEach((p, i) => {
      const t = this.tiles[i];
      const active = i === s.activeIndex;
      t.name.textContent = p.name;
      t.time.textContent = formatMs(p.remainingMs);
      // この局の1打あたり平均思考時間（手番が来るまでは非表示）
      t.avg.textContent = p.handTurns > 0
        ? `1打平均 ${formatSec(p.handThinkMs / p.handTurns)}`
        : '';
      t.root.style.setProperty('--player-color', p.color);
      t.root.classList.toggle('active', active && s.phase !== 'idle');
      t.root.classList.toggle('running', active && s.phase === 'running');
      t.root.classList.toggle('overtime', p.overtimeUsed && p.remainingMs > 0);
      t.root.classList.toggle('warn-yellow', p.remainingMs <= WARN_YELLOW_MS && p.remainingMs > WARN_RED_MS);
      t.root.classList.toggle('warn-red', p.remainingMs <= WARN_RED_MS && p.remainingMs > 0);
      t.root.classList.toggle('timeup', p.remainingMs <= 0);
    });

    const hints = {
      idle: '最初に考える人をタップ',
      running: '次に考える人をタップ',
      paused: s.timeoutIndex !== null
        ? `${s.players[s.timeoutIndex].name} 時間切れ — 続ける人をタップ`
        : '一時停止中 — 続ける人をタップ',
    };
    this.el.hint.textContent = hints[s.phase] ?? '';
    // 保存済みログ件数の常時表示（保存されていることが一目で分かる）
    this.el.count.textContent = s.records.length > 0 ? `記録 ${s.records.length}局` : '';
  }
}
