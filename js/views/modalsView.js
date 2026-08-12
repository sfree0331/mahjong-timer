/**
 * ModalsView — 設定 / 対局履歴（保存ログ）
 */
import { TIME_PRESETS_MIN, RESULT_LABELS } from '../core/store.js';
import { formatMs, formatSec, recordsToCsv, recordsToJson, summarize } from '../core/exporter.js';
import { downloadText } from '../services/storage.js';

export class ModalsView {
  /**
   * @param {import('../core/store.js').GameStore} store
   * @param {{onNewGame:()=>void}} handlers
   */
  constructor(store, handlers) {
    this.store = store;
    this.handlers = handlers;
    this.buildSettings();
    this.bindStatic();
  }

  bindStatic() {
    // 閉じるボタン共通
    for (const btn of document.querySelectorAll('[data-close]')) {
      btn.addEventListener('click', () => this.close(btn.dataset.close));
    }
    document.getElementById('btn-settings').addEventListener('click', () => this.openSettings());
    document.getElementById('btn-history').addEventListener('click', () => this.openHistory());
    document.getElementById('btn-guide').addEventListener('click', () => this.open('guide'));
    // 使い方ガイドは初回起動時に自動表示（一度閉じたら出さない）
    const GUIDE_KEY = 'mahjong-timer-guide-seen';
    try {
      if (!localStorage.getItem(GUIDE_KEY)) this.open('guide');
    } catch { /* localStorage 不可でも動作は継続 */ }
    for (const btn of document.querySelectorAll('[data-close="guide"]')) {
      btn.addEventListener('click', () => {
        try { localStorage.setItem(GUIDE_KEY, '1'); } catch { /* noop */ }
      });
    }
    document.getElementById('btn-export-csv').addEventListener('click', () => {
      downloadText('mahjong-records.csv', recordsToCsv(this.store.state.records), 'text/csv;charset=utf-8');
    });
    document.getElementById('btn-export-json').addEventListener('click', () => {
      downloadText(
        'mahjong-records.json',
        recordsToJson(this.store.state.records, { exportedAt: new Date().toISOString() }),
        'application/json',
      );
    });
    // 新しい対局（記録は残したままタイマーを初期化）
    document.getElementById('btn-new-game').addEventListener('click', () => {
      if (confirm('新しい対局を始めますか？（タイマーを初期化。保存済みの記録は残ります）')) {
        this.handlers.onNewGame();
        this.close('settings');
      }
    });
    // 記録の全削除は履歴画面から明示的に
    document.getElementById('btn-clear-records').addEventListener('click', () => {
      if (confirm('保存済みの記録をすべて削除しますか？（元に戻せません）')) {
        this.store.clearRecords();
        this.openHistory(); // 再描画
      }
    });
  }

  open(id) { document.getElementById(`modal-${id}`).classList.add('show'); }
  close(id) { document.getElementById(`modal-${id}`).classList.remove('show'); }

  // ---------- 設定 ----------

  buildSettings() {
    this.buildPlayerRows();

    // 人数切替（タイマー初期化・記録は残る）
    for (const b of document.querySelectorAll('#player-count-row [data-count]')) {
      b.addEventListener('click', () => {
        const n = Number(b.dataset.count);
        if (n === this.store.playerCount) return;
        const label = n === 3 ? '3人打ち' : '4人打ち';
        if (!confirm(`${label}に切り替えますか？（タイマーを初期化。記録は残ります）`)) return;
        this.store.setPlayerCount(n);
        this.openSettings(); // 行数・選択状態を反映し直す
      });
    }

    // 持ち時間プリセット
    const timeWrap = document.getElementById('time-presets');
    for (const min of TIME_PRESETS_MIN) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset-btn';
      b.textContent = `${min}分`;
      b.dataset.min = String(min);
      b.addEventListener('click', () => this.applyTime(min));
      timeWrap.appendChild(b);
    }
    document.getElementById('btn-time-custom').addEventListener('click', () => {
      const v = document.getElementById('time-custom').value;
      const min = Number(v);
      if (Number.isFinite(min) && min >= 1 && min <= 180) this.applyTime(min);
    });

    // 延長時間（時間切れ後に1回付与）
    document.getElementById('select-overtime').addEventListener('change', (e) => {
      this.store.updateSettings({ overtimeMs: Number(e.target.value) });
    });

    // トグル類
    this.bindToggle('toggle-sound', 'sound');
    this.bindToggle('toggle-vibration', 'vibration');
    document.getElementById('select-theme').addEventListener('change', (e) => {
      this.store.updateSettings({ theme: e.target.value });
    });
    document.getElementById('select-fontscale').addEventListener('change', (e) => {
      this.store.updateSettings({ fontScale: e.target.value });
    });
  }

  /** プレイヤー設定は名前のみ（人数に応じて行を作り直す） */
  buildPlayerRows() {
    const wrap = document.getElementById('player-settings');
    wrap.innerHTML = '';
    this.store.state.players.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'setting-row player-row';
      row.innerHTML = `
        <span class="seat-mark" style="--player-color:${p.color}">${['東', '南', '西', '北'][i]}</span>
        <input type="text" class="name-input" value="${p.name}" maxlength="12" aria-label="プレイヤー${i + 1}の名前">`;
      row.querySelector('.name-input').addEventListener('change', (e) => {
        this.store.setPlayerName(i, e.target.value.trim());
      });
      wrap.appendChild(row);
    });
  }

  applyTime(min) {
    const s = this.store.state;
    const busy = s.phase === 'running' || s.phase === 'paused';
    if (busy && !confirm(`持ち時間を${min}分に変更すると全員の残り時間がリセットされます。よろしいですか？`)) return;
    this.store.setTimeMs(min * 60 * 1000);
  }

  bindToggle(elId, key) {
    document.getElementById(elId).addEventListener('change', (e) => {
      this.store.updateSettings({ [key]: e.target.checked });
    });
  }

  openSettings() {
    const s = this.store.state;
    document.getElementById('toggle-sound').checked = s.settings.sound;
    document.getElementById('toggle-vibration').checked = s.settings.vibration;
    document.getElementById('select-overtime').value = String(s.settings.overtimeMs ?? 0);
    document.getElementById('select-theme').value = s.settings.theme;
    document.getElementById('select-fontscale').value = s.settings.fontScale;
    this.buildPlayerRows();
    for (const b of document.querySelectorAll('#player-count-row [data-count]')) {
      b.classList.toggle('selected', Number(b.dataset.count) === this.store.playerCount);
    }
    for (const b of document.querySelectorAll('#time-presets .preset-btn')) {
      b.classList.toggle('selected', Number(b.dataset.min) * 60000 === s.settings.timeMs);
    }
    this.open('settings');
  }

  // ---------- 対局履歴（保存ログ） ----------

  openHistory() {
    const s = this.store.state;
    const list = document.getElementById('history-list');
    document.getElementById('history-count').textContent = s.records.length > 0
      ? `${s.records.length}局分の記録が保存されています（自動保存）`
      : '';
    if (s.records.length === 0) {
      list.innerHTML = '<p class="empty-note">まだ記録がありません。ロン/ツモ/流局を押すと自動保存されます。</p>';
    } else {
      const totals = summarize(s.records);
      const totalRows = Object.entries(totals).map(([name, t]) => `
        <tr><td>${escapeHtml(name)}</td><td>${formatMs(t.thinkMs)}</td>
        <td>${formatMs(t.avgThinkMs)}</td>
        <td>${t.turns ? formatSec(t.avgTurnMs) : '—'}</td></tr>`).join('');
      const items = [...s.records].reverse().map((r) => `
        <div class="history-item">
          <div class="history-head">
            <strong>#${r.index ?? ''}</strong>
            <span class="result-chip result-${r.result}">${RESULT_LABELS[r.result] ?? r.result}</span>
            <span class="history-time">${fmtClock(r.startedAt)}〜${fmtClock(r.endedAt)}</span>
          </div>
          <div class="history-players">${r.players.map((p) => `
            <span>${escapeHtml(p.name)} ${formatMs(p.thinkMs)}${p.turns ? `（1打 ${formatSec(p.avgTurnMs)}）` : ''}</span>`).join('')}
          </div>
        </div>`).join('');
      list.innerHTML = `
        <table class="summary-table">
          <thead><tr><th>名前</th><th>思考合計</th><th>局平均</th><th>1打平均</th></tr></thead>
          <tbody>${totalRows}</tbody>
        </table>
        ${items}`;
    }
    this.open('history');
  }
}

function fmtClock(ts) {
  if (!ts) return '--:--';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
