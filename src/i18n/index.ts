import { en } from './en';
import { ar } from './ar';

export type Language = 'en' | 'ar';
export type TranslationKey = keyof typeof en;
export type Params = Readonly<Record<string, string | number>>;
export function browserLanguage(languages: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]): Language {
  return languages[0]?.toLowerCase().split(/[-_]/)[0] === 'ar' ? 'ar' : 'en';
}
let language: Language = browserLanguage();
export const getLanguage = (): Language => language;
export const isRtl = (): boolean => language === 'ar';
const listeners = new Set<() => void>();
export function onLanguageChange(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }
export function setLanguage(next: Language): void {
  const changed = language !== next;
  language = next === 'ar' ? 'ar' : 'en';
  if (changed) cache.clear();
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language;
    document.documentElement.dir = isRtl() ? 'rtl' : 'ltr';
  }
  if (changed) for (const fn of listeners) fn();
}
/** Plain text only. Escape user values before inserting the result into HTML. */
export function t(key: TranslationKey | (string & {}), params: Params = {}): string {
  const base = (en as Record<string, string>)[key] ?? key;
  const text = language === 'ar' ? (ar as Partial<Record<string, string>>)[key] ?? base : base;
  return interpolate(text, params);
}
const interpolate = (s: string, p: Params) => s.replace(/⟪(\w+)⟫/g, (m, key: string) => String(p[key] ?? m));
const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
interface Template { parts: string[]; slots: string[]; key: TranslationKey; weight: number; }
function template(s: string, key: TranslationKey): Template {
  return { parts: s.split(/⟪\w+⟫/), slots: [...s.matchAll(/⟪(\w+)⟫/g)].map(m => m[1]), key, weight: s.replace(/⟪.*?⟫/g, '').length };
}
/** Deterministic template matching. No wildcard regex/backtracking on long descriptions. */
function matchTemplate(s: string, p: Template): string[] | null {
  const folded = s.toUpperCase();
  if (!folded.startsWith(p.parts[0].toUpperCase())) return null;
  let pos = p.parts[0].length;
  const out: string[] = [];
  for (let i = 0; i < p.slots.length; i++) {
    const next = p.parts[i + 1];
    const last = i === p.slots.length - 1;
    let end: number;
    if (last) {
      if (!folded.endsWith(next.toUpperCase())) return null;
      end = s.length - next.length;
    } else end = next ? folded.indexOf(next.toUpperCase(), pos) : pos;
    if (end < pos) return null;
    out.push(s.slice(pos, end));
    pos = end + next.length;
  }
  return pos === s.length ? out : null;
}
interface Trie { children: Map<string, Trie>; value?: string; }
const trie = (): Trie => ({ children: new Map() });
const forward = trie(), backward = trie();
function insert(root: Trie, source: string, value: string): void {
  let node = root;
  for (const c of source.toUpperCase()) {
    let next = node.children.get(c);
    if (!next) { next = trie(); node.children.set(c, next); }
    node = next;
  }
  node.value = value;
}
const word = /[\p{L}\p{N}_]/u;
/** Longest phrase wins; matching never enters a word. Bounded by the input and catalog phrase length. */
function replacePhrases(s: string, root: Trie, translate: boolean): string {
  const folded = s.toUpperCase();
  let out = '', cursor = 0;
  for (let start = 0; start < s.length; start++) {
    if (start && word.test(s[start - 1])) continue;
    let node = root, value: string | undefined, end = start;
    for (let i = start; i < s.length; i++) {
      const next = node.children.get(folded[i]);
      if (!next) break;
      node = next;
      if (node.value !== undefined && (!s[i + 1] || !word.test(s[i + 1]))) { value = node.value; end = i + 1; }
    }
    if (value === undefined) continue;
    out += s.slice(cursor, start) + (translate ? t(value) : value);
    cursor = end;
    start = end - 1;
  }
  return out + s.slice(cursor);
}
const exact = new Map<string, TranslationKey>();
const reverse = new Map<string, string>();
const patterns: Template[] = [], inversePatterns: Template[] = [];
for (const key of Object.keys(en) as TranslationKey[]) {
  const english = normalize(en[key]), arabic = normalize(ar[key] ?? english);
  exact.set(english.toUpperCase(), key);
  if (english.includes('⟪')) {
    patterns.push(template(english, key));
    inversePatterns.push(template(arabic, key));
  } else {
    reverse.set(arabic, english);
    if (english !== arabic && english.length > 1) insert(forward, english, key);
    if (/[\u0600-\u06ff]/.test(arabic)) insert(backward, arabic, english);
  }
}
patterns.sort((a, b) => b.weight - a.weight);
inversePatterns.sort((a, b) => b.weight - a.weight);
const cache = new Map<string, string>();
/** Display adapter for canonical data and host messages. New UI should prefer t(key).
 * IDs, gameplay stats, saves and network payloads are never modified. English is a zero-work fast path.
 */
export function localize(value: string | number | null | undefined): string {
  const input = String(value ?? '');
  if (language === 'en' || !/[A-Za-z]/.test(input)) return input;
  const hit = cache.get(input);
  if (hit !== undefined) return hit;
  const plain = normalize(input), key = exact.get(plain.toUpperCase());
  let result: string | undefined = key ? t(key) : undefined;
  if (result === undefined) {
    for (const p of patterns) {
      const match = matchTemplate(plain, p);
      if (!match) continue;
      const params: Record<string, string> = {};
      for (let i = 0; i < p.slots.length; i++) params[p.slots[i]] = match[i] === 's' ? '' : localize(match[i]);
      result = t(p.key, params);
      break;
    }
  }
  result ??= replacePhrases(plain, forward, true);
  result = input.slice(0, input.length - input.trimStart().length) + result + input.slice(input.trimEnd().length);
  if (cache.size >= 2048) cache.clear();
  cache.set(input, result);
  return result;
}
const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', '#39': "'" };
const decode = (s: string) => s.replace(/&([a-z]+|#\d+);/gi, (m, id: string) => entities[id] ?? (id[0] === '#' ? String.fromCodePoint(Number(id.slice(1))) : m));
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** Text and accessible labels only. Wrap player names/codes in <bdi> to preserve them verbatim. */
export function localizeHtml(html: string): string {
  if (language === 'en') return html;
  let skip = 0;
  return html.split(/(<[^>]*>)/g).map(part => {
    if (part.startsWith('<')) {
      if (/^<\/(?:bdi|kbd|script|style)\b/i.test(part)) skip = Math.max(0, skip - 1);
      if (/^<(?:bdi|kbd|script|style)\b/i.test(part)) skip++;
      return part.replace(/\b(title|aria-label|placeholder)="([^"]*)"/g, (_, attr: string, text: string) => `${attr}="${escapeHtml(localize(decode(text)))}"`);
    }
    return skip ? part : escapeHtml(isolateNumbers(localize(decode(part))));
  }).join('');
}
export function isolateNumbers(s: string): string {
  if (language !== 'ar') return s;
  return s.replace(/\u2066[^\u2069]*\u2069|(?<![\d⟪])[-+×x]?\d+(?:[.,:]\d+)*(?:\s*\/\s*\d+(?:[.,:]\d+)*)?%?/g, part => part.startsWith('\u2066') ? part : '\u2066' + part + '\u2069');
}
/** In-place switching preserves focus, event listeners and the current run. Never runs per frame. */
export function relocalizeDom(root: HTMLElement, previous: Language): void {
  if (previous === language && language === 'en') return;
  const visit = (el: Element) => {
    if (el.matches('script,style,bdi,kbd,[translate="no"],textarea,canvas')) return;
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 3) {
        const value = node.textContent ?? '';
        node.textContent = isolateNumbers(localize(previous === 'ar' ? toEnglish(value) : value));
      } else if (node.nodeType === 1) visit(node as Element);
    }
    for (const attr of ['title', 'aria-label', 'placeholder']) {
      const value = el.getAttribute(attr);
      if (value) el.setAttribute(attr, localize(previous === 'ar' ? toEnglish(value) : value));
    }
  };
  visit(root);
}
function toEnglish(s: string): string {
  s = s.replace(/[\u2066-\u2069]/g, '');
  const whole = reverse.get(normalize(s));
  if (whole) return s.replace(s.trim(), whole);
  for (const p of inversePatterns) {
    const match = matchTemplate(normalize(s), p);
    if (!match) continue;
    const params: Record<string, string> = {};
    p.slots.forEach((slot, i) => { params[slot] = replacePhrases(match[i], backward, false); });
    return interpolate(en[p.key], params);
  }
  return replacePhrases(s, backward, false);
}
