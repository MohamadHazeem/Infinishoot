/**
 * Placeholder SFX synthesized with WebAudio, so there are no asset files.
 * Chunky, arcade-y blips. Replace with sampled sounds later; keep the API.
 */
export const audioSettings = { volume: 0.5, muted: false };

type Wave = OscillatorType;

class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private lastPlay = new Map<string, number>();

  constructor() {
    const unlock = () => {
      this.ensure();
      if (this.ctx?.state === 'suspended') void this.ctx.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new AudioContext();
    } catch {
      return null;
    }
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    // 1 s of white noise, reused by every noisy sound.
    this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return this.ctx;
  }

  /** Returns a ready context, or null if muted / locked / rate-limited. */
  private begin(name: string, minGap: number): AudioContext | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || audioSettings.muted) return null;
    const now = ctx.currentTime;
    if (now - (this.lastPlay.get(name) ?? -1) < minGap) return null;
    this.lastPlay.set(name, now);
    this.master.gain.value = audioSettings.volume;
    return ctx;
  }

  private tone(ctx: AudioContext, wave: Wave, f0: number, f1: number, dur: number, vol: number, delay = 0) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = wave;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(ctx: AudioContext, dur: number, vol: number, filterHz: number, filterEnd = filterHz, q = 1) {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(filterHz, t);
    f.frequency.exponentialRampToValueAtTime(filterEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  shoot(): void {
    const ctx = this.begin('shoot', 0.03);
    if (!ctx) return;
    const p = 1 + (Math.random() - 0.5) * 0.12;
    this.tone(ctx, 'square', 880 * p, 220 * p, 0.08, 0.12);
    this.noise(ctx, 0.04, 0.15, 3000);
  }

  /** `pitch` rises with the combo so long chains sound increasingly frantic. */
  hit(pitch = 1): void {
    const ctx = this.begin('hit', 0.025);
    if (!ctx) return;
    this.noise(ctx, 0.07, 0.35, 1800 * pitch, 600, 2);
    this.tone(ctx, 'triangle', 320 * pitch, 160 * pitch, 0.06, 0.2);
  }

  crit(): void {
    const ctx = this.begin('crit', 0.04);
    if (!ctx) return;
    this.tone(ctx, 'square', 1400, 2400, 0.07, 0.1);
    this.noise(ctx, 0.1, 0.3, 4000, 1500, 3);
  }

  enemyDie(pitch = 1): void {
    const ctx = this.begin('die', 0.03);
    if (!ctx) return;
    this.tone(ctx, 'square', 300 * pitch, 1200 * pitch, 0.1, 0.15);
    this.tone(ctx, 'square', 1200 * pitch, 600 * pitch, 0.08, 0.1, 0.08);
    this.noise(ctx, 0.25, 0.4, 900, 200, 0.8);
  }

  /** An elite's shield shatters: glassy crack plus a falling chime. */
  shieldBreak(): void {
    const ctx = this.begin('shieldBreak', 0.08);
    if (!ctx) return;
    this.noise(ctx, 0.3, 0.45, 6000, 1200, 2);
    this.tone(ctx, 'triangle', 1800, 600, 0.25, 0.18);
    this.tone(ctx, 'square', 900, 300, 0.2, 0.08, 0.05);
  }

  explode(): void {
    const ctx = this.begin('explode', 0.05);
    if (!ctx) return;
    this.noise(ctx, 0.35, 0.5, 500, 80, 0.7);
    this.tone(ctx, 'sine', 160, 40, 0.3, 0.3);
  }

  bomb(): void {
    const ctx = this.begin('bomb', 0.3);
    if (!ctx) return;
    this.tone(ctx, 'sawtooth', 90, 30, 0.7, 0.35);
    this.tone(ctx, 'sine', 220, 40, 0.6, 0.4);
    this.noise(ctx, 0.8, 0.6, 1200, 60, 0.5);
  }

  heal(): void {
    const ctx = this.begin('heal', 0.15);
    if (!ctx) return;
    this.tone(ctx, 'triangle', 660, 990, 0.12, 0.08);
  }

  /** Short UI blips. */
  menuMove(): void {
    const ctx = this.begin('menuMove', 0.04);
    if (!ctx) return;
    this.tone(ctx, 'square', 660, 660, 0.04, 0.06);
  }

  menuSelect(): void {
    const ctx = this.begin('menuSelect', 0.08);
    if (!ctx) return;
    this.tone(ctx, 'square', 523, 523, 0.06, 0.1);
    this.tone(ctx, 'square', 784, 784, 0.1, 0.1, 0.06);
  }

  powerUp(): void {
    const ctx = this.begin('powerUp', 0.2);
    if (!ctx) return;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(ctx, 'square', f, f, 0.09, 0.1, i * 0.06));
  }

  stageClear(): void {
    const ctx = this.begin('clear', 0.5);
    if (!ctx) return;
    [392, 523, 659, 784, 659, 1047].forEach((f, i) =>
      this.tone(ctx, i === 5 ? 'triangle' : 'square', f, f, i === 5 ? 0.4 : 0.1, 0.12, i * 0.09),
    );
  }

  wave(): void {
    const ctx = this.begin('wave', 0.3);
    if (!ctx) return;
    this.tone(ctx, 'sawtooth', 220, 440, 0.25, 0.12);
    this.tone(ctx, 'sawtooth', 330, 660, 0.25, 0.08, 0.05);
  }

  /** Weapon sounds, routed by name from the weapon context. */
  weapon(name: string): void {
    const ctx = this.begin('w:' + name, name === 'shoot' ? 0.03 : 0.06);
    if (!ctx) return;
    const p = 1 + (Math.random() - 0.5) * 0.1;
    switch (name) {
      case 'shoot':
        this.tone(ctx, 'square', 880 * p, 220 * p, 0.08, 0.1);
        this.noise(ctx, 0.04, 0.12, 3000);
        break;
      case 'zap':
        this.noise(ctx, 0.12, 0.25, 5000, 2000, 4);
        this.tone(ctx, 'sawtooth', 1200 * p, 300, 0.08, 0.06);
        break;
      case 'disc':
        this.tone(ctx, 'triangle', 300 * p, 900 * p, 0.15, 0.08);
        break;
      case 'missile':
        this.noise(ctx, 0.25, 0.2, 400, 2400, 2);
        break;
      case 'mine':
        this.tone(ctx, 'square', 200, 160, 0.05, 0.06);
        break;
      case 'freeze':
        this.tone(ctx, 'sine', 1800, 600, 0.35, 0.1);
        this.noise(ctx, 0.35, 0.2, 6000, 3000, 6);
        break;
      case 'explode':
        this.explode();
        break;
      case 'charge':
        this.tone(ctx, 'triangle', 500 * p, 900 * p, 0.06, 0.04);
        break;
      case 'chargeFull':
        this.tone(ctx, 'square', 1320, 1320, 0.08, 0.07);
        this.tone(ctx, 'square', 1760, 1760, 0.12, 0.06, 0.07);
        break;
      case 'chargeShot':
        this.tone(ctx, 'sawtooth', 220 * p, 60, 0.3, 0.16);
        this.noise(ctx, 0.25, 0.25, 900, 3000, 2);
        break;
    }
  }

  enemyShoot(): void {
    const ctx = this.begin('eshoot', 0.06);
    if (!ctx) return;
    this.tone(ctx, 'sine', 700, 350, 0.1, 0.07);
  }

  private gemStreak = 0;
  private lastGem = 0;
  /** Gem pickup chime that climbs in pitch while you hoover up a trail. */
  gem(): void {
    const ctx = this.begin('gem', 0.025);
    if (!ctx) return;
    this.gemStreak = ctx.currentTime - this.lastGem < 0.4 ? Math.min(this.gemStreak + 1, 24) : 0;
    this.lastGem = ctx.currentTime;
    const f = 880 * Math.pow(2, this.gemStreak / 24);
    this.tone(ctx, 'triangle', f, f * 1.5, 0.06, 0.06);
  }

  coin(): void {
    const ctx = this.begin('coin', 0.05);
    if (!ctx) return;
    this.tone(ctx, 'square', 988, 988, 0.05, 0.07);
    this.tone(ctx, 'square', 1319, 1319, 0.12, 0.07, 0.05);
  }

  chest(): void {
    const ctx = this.begin('chest', 0.3);
    if (!ctx) return;
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(ctx, 'triangle', f, f, 0.12, 0.1, i * 0.05));
  }

  levelUp(): void {
    const ctx = this.begin('lvl', 0.2);
    if (!ctx) return;
    [392, 523, 659, 784].forEach((f, i) => this.tone(ctx, 'square', f, f * 1.01, 0.08, 0.09, i * 0.05));
    this.tone(ctx, 'triangle', 1047, 1047, 0.3, 0.1, 0.2);
  }

  elite(): void {
    const ctx = this.begin('elite', 0.5);
    if (!ctx) return;
    this.tone(ctx, 'sawtooth', 160, 120, 0.4, 0.15);
    this.tone(ctx, 'sawtooth', 240, 180, 0.4, 0.1, 0.1);
  }

  boss(): void {
    const ctx = this.begin('boss', 1);
    if (!ctx) return;
    [0, 0.35, 0.7].forEach((d) => this.tone(ctx, 'sawtooth', 110, 70, 0.3, 0.2, d));
    this.noise(ctx, 1.2, 0.3, 200, 80, 0.7);
  }

  bossWindup(): void {
    const ctx = this.begin('bwind', 0.3);
    if (!ctx) return;
    this.tone(ctx, 'sawtooth', 120, 260, 0.4, 0.12);
  }

  portal(): void {
    const ctx = this.begin('portal', 0.5);
    if (!ctx) return;
    this.tone(ctx, 'sine', 200, 1600, 0.5, 0.15);
    this.noise(ctx, 0.5, 0.25, 300, 4000, 2);
  }

  telegraph(): void {
    const ctx = this.begin('tele', 0.08);
    if (!ctx) return;
    this.tone(ctx, 'sine', 500, 1100, 0.15, 0.08);
  }

  playerHurt(): void {
    const ctx = this.begin('hurt', 0.1);
    if (!ctx) return;
    this.tone(ctx, 'sawtooth', 420, 90, 0.3, 0.25);
    this.noise(ctx, 0.2, 0.3, 700, 200, 1);
  }

  dash(): void {
    const ctx = this.begin('dash', 0.05);
    if (!ctx) return;
    this.noise(ctx, 0.18, 0.35, 600, 3500, 3);
  }

  spawn(): void {
    const ctx = this.begin('spawn', 0.1);
    if (!ctx) return;
    this.tone(ctx, 'triangle', 200, 400, 0.12, 0.06);
  }

  playerDie(): void {
    const ctx = this.begin('pdie', 0.5);
    if (!ctx) return;
    [523, 392, 330, 262].forEach((f, i) => this.tone(ctx, 'square', f, f * 0.97, 0.18, 0.15, i * 0.16));
  }
}

export const sfx = new Sfx();
