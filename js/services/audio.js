/**
 * AudioService — Web Audio で効果音を合成（音源ファイル不要・オフライン対応）
 */
export class AudioService {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  ensureCtx() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  /** [freq, durMs, delayMs, type][] のシーケンスを再生 */
  play(notes, volume = 0.25) {
    if (!this.enabled) return;
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    for (const [freq, durMs, delayMs = 0, type = 'sine'] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      const start = t0 + delayMs / 1000;
      const end = start + durMs / 1000;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, end);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.05);
    }
  }

  turn()    { this.play([[880, 60]], 0.12); }
  pon()     { this.play([[523, 90], [659, 120, 90]]); }
  chi()     { this.play([[587, 90], [740, 120, 90]]); }
  kan()     { this.play([[440, 90], [554, 90, 90], [659, 140, 180]]); }
  riichi()  { this.play([[988, 80], [1319, 160, 80]]); }
  ron()     { this.play([[659, 120], [523, 120, 120], [392, 240, 240]]); }
  tsumo()   { this.play([[523, 100], [659, 100, 100], [784, 200, 200]]); }
  ryukyoku(){ this.play([[494, 150], [440, 250, 150]], 0.18); }
  warn()    { this.play([[1047, 70], [1047, 70, 140]], 0.2); }
  timeup()  { this.play([[784, 150], [784, 150, 200], [784, 400, 400]], 0.3); }
}

/** HapticsService — バイブレーション（対応端末のみ） */
export class HapticsService {
  constructor() {
    this.enabled = true;
  }

  vibrate(pattern) {
    if (!this.enabled) return;
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  call()    { this.vibrate(40); }
  warn()    { this.vibrate([60, 60, 60]); }
  timeup()  { this.vibrate([200, 100, 200, 100, 400]); }
}
