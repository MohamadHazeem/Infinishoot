/**
 * SFX synthesized with WebAudio, so there are no asset files. Chunky,
 * arcade-y blips routed through three buses (effects, music, menus) into a
 * master gain. Effects and music pass through a shared low-pass "muffle"
 * filter that big hit-stops close for a moment. Positioned sounds are panned
 * left/right and quieter with distance (see `at()`).
 */
export const audioSettings = { volume: 0.5, sfx: 1, music: 0.7, ui: 0.8, muted: false };

type Wave = OscillatorType;
export type Bus = 'sfx' | 'music' | 'ui';

class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses!: Record<Bus, GainNode>;
  private muffler!: BiquadFilterNode;
  private noiseBuf!: AudioBuffer;
  private lastPlay = new Map<string, number>();
  /** Where the next sound plays from: stereo pan (-1..1) and distance gain. Set by `at()`. */
  private pan = 0;
  private posGain = 1;
  /** Input node for the sound being built (set by `begin`). */
  private route!: AudioNode;
  // Combo hum: two detuned saws through a low-pass, faded with the combo.
  private hum: { gain: GainNode; filter: BiquadFilterNode; a: OscillatorNode; b: OscillatorNode } | null = null;

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
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.muffler = ctx.createBiquadFilter();
    this.muffler.type = 'lowpass';
    this.muffler.frequency.value = 20000;
    this.muffler.connect(this.master);
    this.buses = { sfx: ctx.createGain(), music: ctx.createGain(), ui: ctx.createGain() };
    this.buses.sfx.connect(this.muffler);
    this.buses.music.connect(this.muffler);
    this.buses.ui.connect(this.master);
    this.applyVolumes();
    // 1 s of white noise, reused by every noisy sound.
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  /** Push audioSettings into the bus gains. */
  applyVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = audioSettings.muted ? 0 : audioSettings.volume;
    this.buses.sfx.gain.value = audioSettings.sfx;
    this.buses.music.gain.value = audioSettings.music;
    this.buses.ui.gain.value = audioSettings.ui;
  }

  /** The running context and a bus input, for the music player. */
  output(bus: Bus): { ctx: AudioContext; node: AudioNode } | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return null;
    return { ctx, node: this.buses[bus] };
  }

  /** Position the next sound: pan -1 (left) .. 1 (right), gain 0..1 for distance. Reset with at(0, 1). */
  at(pan: number, gain: number): void {
    this.pan = Math.max(-1, Math.min(1, pan));
    this.posGain = gain;
  }

  /** Returns a ready context, or null if muted / locked / rate-limited. */
  private begin(name: string, minGap: number, bus: Bus = 'sfx'): AudioContext | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || audioSettings.muted) return null;
    const now = ctx.currentTime;
    if (now - (this.lastPlay.get(name) ?? -1) < minGap) return null;
    this.lastPlay.set(name, now);
    this.applyVolumes();
    let node: AudioNode = this.buses[bus];
    if (bus === 'sfx' && this.pan !== 0) {
      const p = ctx.createStereoPanner();
      p.pan.value = this.pan;
      p.connect(node);
      node = p;
    }
    if (this.posGain !== 1) {
      const g = ctx.createGain();
      g.gain.value = this.posGain;
      g.connect(node);
      node = g;
    }
    this.route = node;
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
    o.connect(g).connect(this.route);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(ctx: AudioContext, dur: number, vol: number, filterHz: number, filterEnd = filterHz, q = 1, delay = 0) {
    const t = ctx.currentTime + delay;
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
    src.connect(f).connect(g).connect(this.route);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  /** Hit-stop: close the low-pass on effects and music, then open it again. */
  muffle(seconds: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const f = this.muffler.frequency;
    const t = ctx.currentTime;
    f.cancelScheduledValues(t);
    f.setValueAtTime(650, t);
    f.setValueAtTime(650, t + seconds);
    f.exponentialRampToValueAtTime(20000, t + seconds + 0.25);
  }

  /** Combo hum: 0 = silent, 1 = a loud, bright buzz. Call every frame. */
  setHum(level: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (!this.hum) {
      if (level <= 0) return;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 4;
      const a = ctx.createOscillator();
      const b = ctx.createOscillator();
      a.type = b.type = 'sawtooth';
      a.frequency.value = 55;
      b.frequency.value = 55.6;
      a.connect(filter);
      b.connect(filter);
      filter.connect(gain).connect(this.buses.sfx);
      a.start();
      b.start();
      this.hum = { gain, filter, a, b };
    }
    const h = this.hum;
    const t = ctx.currentTime;
    const k = Math.max(0, Math.min(1, level));
    h.gain.gain.setTargetAtTime(k * k * 0.06, t, 0.15);
    h.filter.frequency.setTargetAtTime(160 + k * 1400, t, 0.15);
    h.a.frequency.setTargetAtTime(55 * (1 + k * 0.5), t, 0.3);
    h.b.frequency.setTargetAtTime(55.6 * (1 + k * 0.5), t, 0.3);
  }

  // ---------------------------------------------------------------- new cues

  /** Low thump layered under big hits; `weight` 1..3 deepens and lengthens it. */
  impact(weight = 1): void {
    const ctx = this.begin('impact', 0.05);
    if (!ctx) return;
    const w = Math.max(1, Math.min(3, weight));
    this.tone(ctx, 'sine', 120 / Math.sqrt(w), 32, 0.12 + 0.06 * w, 0.18 + 0.08 * w);
    this.noise(ctx, 0.08 + 0.03 * w, 0.18 * w, 300, 80, 0.8);
  }

  /** Rising whine while a charger lines up its charge. */
  chargerWindup(): void {
    const ctx = this.begin('cwind', 0.15);
    if (!ctx) return;
    this.tone(ctx, 'sawtooth', 180, 900, 0.5, 0.07);
    this.tone(ctx, 'square', 360, 1800, 0.5, 0.03);
  }

  /** Fuse tick; `pitch` climbs as the fuse burns down. */
  fuseTick(pitch = 1): void {
    const ctx = this.begin('fuse', 0.04);
    if (!ctx) return;
    this.tone(ctx, 'square', 1500 * pitch, 1500 * pitch, 0.025, 0.06);
  }

  evolve(): void {
    const ctx = this.begin('evolve', 0.6);
    if (!ctx) return;
    [262, 330, 392, 523, 659, 784, 1047].forEach((f, i) => this.tone(ctx, 'square', f, f, 0.1, 0.09, i * 0.055));
    this.tone(ctx, 'triangle', 1047, 1047, 0.6, 0.12, 0.4);
    this.tone(ctx, 'triangle', 1319, 1319, 0.6, 0.08, 0.4);
    this.noise(ctx, 0.5, 0.15, 3000, 8000, 2, 0.35);
  }

  /** Every 50 combo. */
  comboUp(): void {
    const ctx = this.begin('combo', 0.3);
    if (!ctx) return;
    [784, 988, 1175, 1568].forEach((f, i) => this.tone(ctx, 'square', f, f, 0.07, 0.08, i * 0.045));
  }

  /** Low-life heartbeat (local player only). */
  heartbeat(): void {
    const ctx = this.begin('heart', 0.3);
    if (!ctx) return;
    this.tone(ctx, 'sine', 70, 40, 0.12, 0.35);
    this.tone(ctx, 'sine', 60, 35, 0.14, 0.28, 0.18);
  }

  /** A chest-style jingle for big moments (stage events, challenges). */
  jingle(): void {
    const ctx = this.begin('jingle', 0.4);
    if (!ctx) return;
    [659, 784, 1047, 784, 1319].forEach((f, i) => this.tone(ctx, 'triangle', f, f, 0.1, 0.1, i * 0.07));
  }

  /** Something bad starts (curse, event). */
  ominous(): void {
    const ctx = this.begin('ominous', 0.5);
    if (!ctx) return;
    this.tone(ctx, 'sawtooth', 220, 110, 0.6, 0.12);
    this.tone(ctx, 'sawtooth', 233, 116, 0.6, 0.08);
    this.noise(ctx, 0.6, 0.15, 400, 100, 1);
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
    const ctx = this.begin('menuMove', 0.04, 'ui');
    if (!ctx) return;
    this.tone(ctx, 'square', 660, 660, 0.04, 0.06);
  }

  menuSelect(): void {
    const ctx = this.begin('menuSelect', 0.08, 'ui');
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
