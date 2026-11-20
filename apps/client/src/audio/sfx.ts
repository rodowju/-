/**
 * 합성 효과음 (WebAudio, 에셋 없음). 소리는 보조 수단이며 모든 정보는 시각으로도 제공된다 (접근성).
 * 브라우저 자동재생 정책 때문에 첫 사용자 입력에서 unlock() 해야 한다.
 */
export type SfxName = 'beat' | 'turn' | 'watch' | 'perfect' | 'great' | 'good' | 'caught' | 'clear';

type Wave = OscillatorType;

class Sfx {
  private ctx?: AudioContext;
  private muted = false;

  setMuted(m: boolean): void {
    this.muted = m;
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** 사용자 제스처 안에서 호출 */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      /* 오디오 불가 환경: 무음으로 동작 */
    }
  }

  private tone(freq: number, dur: number, type: Wave, gain: number, slideTo?: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  play(name: SfxName): void {
    if (this.muted || !this.ctx) return;
    try {
      switch (name) {
        case 'beat':
          this.tone(660, 0.05, 'triangle', 0.05);
          break;
        case 'turn':
          this.tone(420, 0.16, 'sawtooth', 0.04, 160);
          break;
        case 'watch':
          this.tone(300, 0.12, 'square', 0.045);
          this.tone(225, 0.16, 'square', 0.045, undefined, 0.13);
          break;
        case 'perfect':
          this.tone(880, 0.09, 'sine', 0.07);
          this.tone(1320, 0.14, 'sine', 0.07, undefined, 0.08);
          break;
        case 'great':
          this.tone(740, 0.1, 'sine', 0.06);
          break;
        case 'good':
          this.tone(560, 0.08, 'sine', 0.05);
          break;
        case 'caught':
          this.tone(180, 0.28, 'sawtooth', 0.08, 50);
          break;
        case 'clear':
          [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.06, undefined, i * 0.09));
          break;
      }
    } catch {
      /* 무시 */
    }
  }
}

export const sfx = new Sfx();
