import { en } from './en';

/** Native names stay readable even before their catalog has loaded. */
export const LANGUAGES = { en: 'English', ar: 'العربية', es: 'Español', fr: 'Français', 'pt-BR': 'Português (Brasil)', de: 'Deutsch', tr: 'Türkçe' } as const;
export type Language = keyof typeof LANGUAGES;
export type TranslationKey = keyof typeof en;
export type Params = Readonly<Record<string, string | number>>;
type Catalog = Partial<Record<TranslationKey, string>>;
export const isLanguage = (value: unknown): value is Language => typeof value === 'string' && Object.hasOwn(LANGUAGES, value);
export function browserLanguage(languages: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]): Language {
  for (const locale of languages) {
    const base = locale.toLowerCase().split(/[-_]/)[0];
    if (base === 'pt') return 'pt-BR';
    if (isLanguage(base)) return base;
  }
  return 'en';
}
const loaders = {
  ar: () => import('./ar').then(m => m.ar),
  es: () => import('./es').then(m => m.es),
  fr: () => import('./fr').then(m => m.fr),
  'pt-BR': () => import('./pt-BR').then(m => m.ptBR),
  de: () => import('./de').then(m => m.de),
  tr: () => import('./tr').then(m => m.tr),
};
const catalogs = new Map<Language, Catalog>([['en', en]]);
const pending = new Map<Language, Promise<void>>();
const warned = new Set<string>();
let language: Language = 'en', requested: Language = 'en';
export const getLanguage = (): Language => language;
export const isRtl = (): boolean => language === 'ar';
const listeners = new Set<() => void>();
export function onLanguageChange(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }
/** Loads once. English never requests a translation chunk. */
export function loadLanguage(next: Language): Promise<void> {
  if (catalogs.has(next)) return Promise.resolve();
  let work = pending.get(next);
  if (!work) {
    work = loaders[next as Exclude<Language, 'en'>]().then(catalog => {
      // One diagnostic per loaded catalog also exposes deliberate English fallbacks.
      // Names and technical terms may legitimately be identical across languages.
      const retained = (Object.keys(en) as TranslationKey[]).filter(key => (catalog as Partial<Record<TranslationKey, string>>)[key] === en[key]);
      if (retained.length) console.warn(`[i18n] ${next}: ${retained.length} English strings retained (names, technical terms, or untranslated copy).`);
      catalogs.set(next, catalog);
      reverseCatalogs.set(next, makeReverse(catalog));
    }).finally(() => { pending.delete(next); });
    pending.set(next, work);
  }
  return work;
}
/** Commit only a fully loaded locale. Last request wins when players cycle quickly. */
export async function setLanguage(next: Language): Promise<void> {
  requested = isLanguage(next) ? next : 'en';
  next = requested;
  if (!catalogs.has(next)) {
    try { await loadLanguage(next); }
    catch (error) { console.warn(`[i18n] Could not load ${next}; keeping ${language}. Reload to retry the download.`, error); return; }
  }
  if (requested !== next) return;
  const previous = language;
  language = next;
  if (previous !== next) cache.clear();
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language;
    document.documentElement.dir = isRtl() ? 'rtl' : 'ltr';
    if (previous !== next && document.body) relocalizeDom(document.body, previous);
  }
  if (previous !== next) for (const fn of listeners) fn();
}
/** Plain text only. Escape user values before inserting the result into HTML. */
export function t(key: TranslationKey | (string & {}), params: Params = {}): string {
  const base = (en as Record<string, string>)[key] ?? key;
  const translated = (catalogs.get(language) as Record<string, string> | undefined)?.[key];
  if (language !== 'en' && key in en && !translated && !warned.has(language + ':' + key)) {
    warned.add(language + ':' + key);
    console.warn(`[i18n] Missing ${language}:${key}; using English.`);
  }
  return interpolate(translated || base, params);
}
const interpolate = (s: string, p: Params) => s.replace(/⟪(\w+)⟫/g, (m, key: string) => String(p[key] ?? m));
// Unlike uppercasing ß to SS, this keeps string offsets stable in German reverse matching.
const fold = (s: string) => s.replace(/ß/g, 'ẞ').toUpperCase();
const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
interface Template { parts: string[]; slots: string[]; key: TranslationKey; weight: number; }
function template(s: string, key: TranslationKey): Template {
  return { parts: s.split(/⟪\w+⟫/), slots: [...s.matchAll(/⟪(\w+)⟫/g)].map(m => m[1]), key, weight: s.replace(/⟪.*?⟫/g, '').length };
}
/** Deterministic template matching. No wildcard regex/backtracking on long descriptions. */
function matchTemplate(s: string, p: Template): string[] | null {
  const folded = fold(s);
  if (!folded.startsWith(fold(p.parts[0]))) return null;
  let pos = p.parts[0].length;
  const out: string[] = [];
  for (let i = 0; i < p.slots.length; i++) {
    const next = p.parts[i + 1];
    const last = i === p.slots.length - 1;
    let end: number;
    if (last) {
      if (!folded.endsWith(fold(next))) return null;
      end = s.length - next.length;
    } else end = next ? folded.indexOf(fold(next), pos) : pos;
    if (end < pos) return null;
    out.push(s.slice(pos, end));
    pos = end + next.length;
  }
  return pos === s.length ? out : null;
}
interface Trie { children: Map<string, Trie>; value?: string; }
const trie = (): Trie => ({ children: new Map() });
const forward = trie();
function insert(root: Trie, source: string, value: string): void {
  let node = root;
  for (const c of fold(source)) {
    let next = node.children.get(c);
    if (!next) { next = trie(); node.children.set(c, next); }
    node = next;
  }
  node.value = value;
}
const word = /[\p{L}\p{N}_]/u;
/** Longest phrase wins; matching never enters a word. Bounded by the input and catalog phrase length. */
function replacePhrases(s: string, root: Trie, translate: boolean): string {
  const folded = fold(s);
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
const patterns: Template[] = [];
for (const key of Object.keys(en) as TranslationKey[]) {
  const english = normalize(en[key]);
  exact.set(english.toUpperCase(), key);
  if (english.includes('⟪')) patterns.push(template(english, key));
  else if (english.length > 1) insert(forward, english, key);
}
patterns.sort((a, b) => b.weight - a.weight);
function makeReverse(catalog: Catalog) {
  const reverse = new Map<string, string>(), backward = trie(), inversePatterns: Template[] = [];
  for (const key of Object.keys(en) as TranslationKey[]) {
    const english = normalize(en[key]), translated = normalize(catalog[key] ?? english);
    if (english.includes('⟪')) {
      const inverse = template(translated, key);
      if (inverse.weight > 0) inversePatterns.push(inverse); // A slot alone must never match arbitrary UI text.
    }
    else {
      reverse.set(translated, english);
      if (english !== translated && translated.length > 1) insert(backward, translated, english);
    }
  }
  inversePatterns.sort((a, b) => b.weight - a.weight);
  return { reverse, backward, inversePatterns };
}
const reverseCatalogs = new Map<Language, ReturnType<typeof makeReverse>>();
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
  // Mixed templates may already contain t() output. Preserve known translated
  // phrases before the substring adapter can translate their words a second time.
  if (!key && reverseCatalogs.get(language)?.reverse.has(plain)) return input;
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
const domText = new WeakMap<Node, { source: string; rendered: string }>();
const domAttrs = new WeakMap<Element, Map<string, { source: string; rendered: string }>>();
/** In-place switching preserves focus, event listeners and the current run. Never runs per frame. */
export function relocalizeDom(root: HTMLElement, previous: Language): void {
  if (previous === language && language === 'en') return;
  const visit = (el: Element) => {
    if (el.matches('script,style,bdi,kbd,[translate="no"],textarea,canvas')) return;
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 3) {
        const value = node.textContent ?? '';
        const saved = domText.get(node);
        const source = saved?.rendered === value ? saved.source : domSource(value, previous);
        const rendered = isolateNumbers(localize(source));
        if (value !== rendered) node.textContent = rendered;
        domText.set(node, { source, rendered });
      } else if (node.nodeType === 1) visit(node as Element);
    }
    for (const attr of ['title', 'aria-label', 'placeholder']) {
      const value = el.getAttribute(attr);
      if (value) {
        let attrs = domAttrs.get(el);
        if (!attrs) { attrs = new Map(); domAttrs.set(el, attrs); }
        const saved = attrs.get(attr);
        const source = saved?.rendered === value ? saved.source : domSource(value, previous);
        const rendered = localize(source);
        if (value !== rendered) el.setAttribute(attr, rendered);
        attrs.set(attr, { source, rendered });
      }
    }
  };
  visit(root);
}
function domSource(value: string, previous: Language): string {
  // Fresh screens mix canonical English with already-localized fragments. Prefer a
  // known English phrase before trying inverse templates such as the seconds suffix.
  if (previous === 'en' && exact.has(normalize(value).toUpperCase())) return value;
  return toEnglish(value, previous === 'en' ? language : previous);
}
function toEnglish(s: string, previous: Language): string {
  const inverse = reverseCatalogs.get(previous);
  if (!inverse) return s;
  const { reverse, backward, inversePatterns } = inverse;
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
