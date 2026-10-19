/** Shared, dependency-free desktop policy. Also exercised by the web diagnostics tests. */
export const RELEASES = 'https://github.com/MohamadHazeem/Infinishoot/releases';
export const LOG_LIMIT = 200;
const version = (s) => typeof s === 'string' && /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(s) ? s.replace(/^v/, '').split('.').map(Number) : null;
export function availableRelease(current, release) {
  const have = version(current);
  const next = version(release?.tag_name);
  if (!have || !next || release.draft || release.prerelease) return null;
  for (let i = 0; i < 3; i++) {
    if (next[i] < have[i]) return null;
    if (next[i] > have[i]) return { version: next.join('.'), url: `${RELEASES}/tag/${release.tag_name}` };
  }
  return null;
}
export function cleanText(value) {
  let s;
  try { s = value instanceof Error ? value.stack || value.message : typeof value === 'string' ? value : JSON.stringify(value); } catch { try { s = String(value); } catch { s = '[unserializable error]'; } }
  return String(s ?? '').slice(0, 8000)
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/g, '$1?[redacted]')
    .replace(/(token|password|credential|authorization)(["'\s:=]+)[^\s,;}]+/gi, '$1$2[redacted]');
}
export class LogRing {
  constructor(entries = []) {
    this.entries = [];
    if (Array.isArray(entries)) for (const e of entries.slice(-LOG_LIMIT)) {
      if (e && typeof e.time === 'string' && typeof e.kind === 'string' && typeof e.message === 'string') this.entries.push({ time: e.time.slice(0, 40), kind: e.kind.slice(0, 40), message: cleanText(e.message) });
    }
  }
  add(kind, message, time = new Date().toISOString()) {
    this.entries.push({ time, kind: String(kind).slice(0, 40), message: cleanText(message) });
    if (this.entries.length > LOG_LIMIT) this.entries.shift();
  }
  text(context) {
    return `InfiniShoot error log\n${cleanText(JSON.stringify(context, null, 2))}\n\n${this.entries.map(e => `${e.time} [${e.kind}] ${e.message}`).join('\n')}\n`;
  }
}
export function displayOptions(raw = {}) {
  if (!raw || typeof raw !== 'object') raw = {};
  return {
    windowMode: ['windowed', 'fullscreen', 'borderless'].includes(raw.windowMode) ? raw.windowMode : 'windowed',
    resolutionScale: [50, 75, 100, 125, 150, 175, 200].includes(raw.resolutionScale) ? raw.resolutionScale : 100,
    frameCap: ['30', '60', '120', 'unlimited'].includes(raw.frameCap) ? raw.frameCap : '60',
    vsync: raw.vsync !== false,
    autoUpdate: raw.autoUpdate !== false,
  };
}
