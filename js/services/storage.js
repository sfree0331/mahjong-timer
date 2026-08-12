/**
 * StorageService — localStorage への自動保存（スロットル付き）
 */
const KEY = 'mahjong-timer-v1';

export class StorageService {
  constructor(store, { throttleMs = 500 } = {}) {
    this.store = store;
    this.throttleMs = throttleMs;
    this.timer = null;
  }

  /** 起動時の復元。成功時 true */
  restore() {
    try {
      const json = localStorage.getItem(KEY);
      if (!json) return false;
      return this.store.hydrate(json);
    } catch {
      return false;
    }
  }

  /** 変更監視を開始（tick は保存対象だが高頻度なのでスロットル） */
  attach() {
    this.store.subscribe(() => this.scheduleSave());
    window.addEventListener('pagehide', () => this.saveNow());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.saveNow();
    });
  }

  scheduleSave() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.saveNow();
    }, this.throttleMs);
  }

  saveNow() {
    try {
      localStorage.setItem(KEY, this.store.serialize());
    } catch {
      /* 容量超過などは黙殺（タイマー動作を優先） */
    }
  }

  clear() {
    localStorage.removeItem(KEY);
  }
}

/** ファイルダウンロード（CSV/JSON/PDF エクスポート用） */
export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(filename, text, mime) {
  downloadBlob(filename, new Blob([text], { type: mime }));
}
