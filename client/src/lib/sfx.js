/**
 * Synthesized Apple-style tactile Web Audio SFX engine.
 */
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  setEnabled(val) {
    this.enabled = Boolean(val);
  }

  ensureCtx() {
    if (!this.enabled || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  playTone({ freq = 440, endFreq = null, type = 'sine', duration = 0.08, gain = 0.055, delay = 0 }) {
    const c = this.ensureCtx();
    if (!c) return;
    const now = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq) {
      osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);
    }
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(gain, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  tick() {
    this.playTone({ freq: 920, endFreq: 680, type: 'triangle', duration: 0.032, gain: 0.032 });
  }

  tap() {
    this.playTone({ freq: 340, endFreq: 520, type: 'sine', duration: 0.055, gain: 0.05 });
  }

  reveal() {
    this.playTone({ freq: 523.25, endFreq: 587.33, type: 'sine', duration: 0.14, gain: 0.042, delay: 0 });
    this.playTone({ freq: 783.99, endFreq: 880, type: 'sine', duration: 0.18, gain: 0.038, delay: 0.055 });
  }

  start() {
    this.playTone({ freq: 260, endFreq: 520, type: 'sine', duration: 0.14, gain: 0.05 });
    this.playTone({ freq: 520, endFreq: 660, type: 'triangle', duration: 0.12, gain: 0.025, delay: 0.04 });
  }

  complete() {
    this.playTone({ freq: 659.25, type: 'sine', duration: 0.28, gain: 0.048, delay: 0 });
    this.playTone({ freq: 830.61, type: 'sine', duration: 0.32, gain: 0.045, delay: 0.075 });
    this.playTone({ freq: 987.77, type: 'sine', duration: 0.42, gain: 0.048, delay: 0.15 });
    this.playTone({ freq: 1318.51, type: 'sine', duration: 0.5, gain: 0.028, delay: 0.21 });
  }

  remove() {
    this.playTone({ freq: 320, endFreq: 160, type: 'sine', duration: 0.09, gain: 0.042 });
  }

  error() {
    this.playTone({ freq: 240, endFreq: 170, type: 'triangle', duration: 0.14, gain: 0.05 });
  }
}

export const SFX = new SoundEngine();
