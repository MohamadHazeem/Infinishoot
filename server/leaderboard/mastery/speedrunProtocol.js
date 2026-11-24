// Eight ordered checkpoints: the boss arrival and its defeat for each stage in loop one.
// FNV links simulation hashes to the seed, tick and clock. SHA-256 covers the entire uploaded tape.
export function speedSeed(week) {
  let h = 2166136261;
  for (const c of 'infinishoot-speed-v1-' + week) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
export function linkSplit(previous, index, ms, tick, state) {
  for (const n of [index, ms, tick, state]) previous = Math.imul(previous ^ n, 16777619);
  return previous >>> 0;
}
export function currentWeek(now = Date.now()) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return (
    d.getUTCFullYear() +
    '-W' +
    String(Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7)).padStart(
      2,
      '0',
    )
  );
}

// Walk the existing v1 event tape across arbitrary chunk boundaries. Only the boundary
// records and recorded state checksums are read; combat is never simulated on the Worker.
export class ReplayChain {
  constructor(seed, keyCount, stringCount) {
    this.chain = seed;
    this.steps = 0;
    this.left = 0;
    this.kind = -1;
    this.strings = stringCount;
    this.lastCheck = null;
    this.width = 51 + 2 * Math.ceil(keyCount / 26);
  }
  chunk(values) {
    if (!Array.isArray(values) || !values.length || values.length > 16384) throw Error('chunk');
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!Number.isFinite(v)) throw Error('number');
      if (!this.left) {
        if (!Number.isInteger(v) || v < 0 || v > 4) throw Error('event');
        this.kind = v;
        this.left = v === 0 ? this.width : v === 1 ? 2 : 1;
      } else {
        if (this.kind === 0) {
          if (this.left === this.width && Math.abs(v - 1 / 60) > 0.000001)
            throw Error('step duration');
          if (this.left === 36 && (!Number.isInteger(v) || v < 0 || v >= this.strings))
            throw Error('input index');
          if (this.left === 35 && v !== 0) throw Error('god');
          if (this.left === 1) {
            this.steps++;
            if (this.steps % 60 === 0) {
              if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw Error('checkpoint');
              this.lastCheck = v;
              this.chain = Math.imul(this.chain ^ this.steps, 16777619) >>> 0;
              this.chain = Math.imul(this.chain ^ v, 16777619) >>> 0;
            } else if (v !== -1) throw Error('unexpected checkpoint');
          }
        } else if (this.kind >= 2 && (!Number.isInteger(v) || v < 0 || v >= this.strings))
          throw Error('string index');
        this.left--;
      }
    }
  }
  finish(steps, terminal) {
    if (this.left || !steps || this.steps !== steps) throw Error('truncated');
    if (
      !Number.isInteger(terminal) ||
      terminal < 0 ||
      terminal > 0xffffffff ||
      (steps % 60 === 0 && this.lastCheck !== terminal)
    )
      throw Error('terminal hash');
    return Math.imul(this.chain ^ terminal, 16777619) >>> 0;
  }
}
