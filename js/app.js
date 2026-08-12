/**
 * app.js — エントリポイント。Store / Ticker / Services / Views の配線のみを行う。
 */
import { GameStore, RESULT_LABELS } from './core/store.js';
import { Ticker } from './core/ticker.js';
import { AudioService, HapticsService } from './services/audio.js';
import { StorageService } from './services/storage.js';
import { BoardView } from './views/boardView.js';
import { ControlsView } from './views/controlsView.js';
import { ModalsView } from './views/modalsView.js';

// JS が正常起動したら file:// 用の案内を消す
document.getElementById('boot-error')?.remove();

const store = new GameStore();
const storage = new StorageService(store);
const audio = new AudioService();
const haptics = new HapticsService();

storage.restore();
storage.attach();

const ticker = new Ticker((delta) => store.tick(delta));

// ---------- 操作ハンドラ ----------

const board = new BoardView(store, {
  // タイルタップ = どの状態からでも「タップした人に飛んで計測が進む」
  onTileTap: (i) => store.tapPlayer(i),
});

const controls = new ControlsView(store, {
  onResult: (result) => store.endHand(result),
  onUndo: () => store.undo(),
  onPauseToggle: () => {
    const s = store.state;
    if (s.phase === 'running') store.pause();
    else if (s.phase === 'paused') store.resume();
  },
});

const modals = new ModalsView(store, {
  onNewGame: () => store.newGame(),
});

// ---------- トースト（記録保存の確認表示） ----------

const toastEl = document.getElementById('toast');
let toastTimer = null;
function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

// ---------- 描画・効果音・バイブの購読 ----------

function applySettings() {
  const { theme, fontScale, sound, vibration } = store.state.settings;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.fontscale = fontScale;
  audio.enabled = sound;
  haptics.enabled = vibration;
}

function renderAll() {
  // 3人打ちでは北家スロットを CSS で非表示にする
  document.body.dataset.players = String(store.playerCount);
  board.render();
  controls.render();
  ticker[store.state.phase === 'running' ? 'start' : 'stop']();
}

const soundMap = {
  overtime: () => { audio.warn(); haptics.warn(); },
  handEnd: (payload) => {
    if (payload.result === 'ron') audio.ron();
    else if (payload.result === 'tsumo') audio.tsumo();
    else audio.ryukyoku();
    showToast(`✓ ${RESULT_LABELS[payload.result]}で記録しました（${payload.count}局目）`);
  },
  turn: () => audio.turn(),
  warn30: () => audio.warn(),
  warn10: () => { audio.warn(); haptics.warn(); },
  timeout: () => { audio.timeup(); haptics.timeup(); },
};

store.subscribe((event, _state, payload) => {
  if (event === 'settings' || event === 'hydrate') applySettings();
  if (event === 'playerCount' || event === 'hydrate') board.buildTiles();
  soundMap[event]?.(payload);
  renderAll();
});

applySettings();
renderAll();

// iOS の Web Audio は初回タッチで解錠が必要
document.addEventListener('touchstart', () => audio.ensureCtx(), { once: true, passive: true });

// Service Worker 登録（PWA / オフライン）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
