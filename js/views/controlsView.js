/**
 * ControlsView — 和了/進行ボタンバーの状態管理
 */
export class ControlsView {
  /**
   * @param {import('../core/store.js').GameStore} store
   * @param {{onResult:(r:string)=>void, onUndo:()=>void, onPauseToggle:()=>void}} handlers
   */
  constructor(store, handlers) {
    this.store = store;
    this.el = {
      resultButtons: [...document.querySelectorAll('[data-result]')],
      undo: document.getElementById('btn-undo'),
      pause: document.getElementById('btn-pause'),
    };
    for (const b of this.el.resultButtons) {
      b.addEventListener('click', () => handlers.onResult(b.dataset.result));
    }
    this.el.undo.addEventListener('click', () => handlers.onUndo());
    this.el.pause.addEventListener('click', () => handlers.onPauseToggle());
  }

  render() {
    const s = this.store.state;
    const running = s.phase === 'running';
    const canEnd = running || s.phase === 'paused';
    for (const b of this.el.resultButtons) b.disabled = !canEnd;
    this.el.undo.disabled = this.store.undoStack.length === 0;
    this.el.pause.textContent = s.phase === 'paused' ? '▶ 再開' : '⏸ 停止';
    this.el.pause.disabled = !(running || s.phase === 'paused');
  }
}
