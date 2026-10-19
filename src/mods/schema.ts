import { WEAPONS } from '../data/weapons';
import { ENEMIES } from '../data/enemies';
import { RELIC_BY_ID } from '../data/relics';
import { MOD_BY_ID } from '../data/mods';
import { BIOME_BY_ID } from '../data/biomes';
import { STAGE_EVENTS } from '../data/stageEvents';
import { baseStats } from '../game/stats';

export const MOD_LIMITS = { bytes: 512 * 1024, totalBytes: 4 * 1024 * 1024, files: 32, entries: 64, enemies: 256 };
export const CATEGORIES = ['weapons', 'enemies', 'relics', 'mods', 'biomes', 'events'] as const;
export type Category = typeof CATEGORIES[number];
export type Fields = Record<string, unknown>;
export interface ContentPatch { id: string; base: string; override?: boolean; set: Fields; stages?: number[] }
export interface ModManifest {
  schemaVersion: 1; id: string; name: string; version: string; description?: string;
  content: Partial<Record<Category, ContentPatch[]>>;
}
export type Validation = { ok: true; mod: ModManifest } | { ok: false; errors: string[] };
// Capture shipped templates, before any packs are installed. Dependencies between packs are deliberately unnecessary.
export const templates: Record<Category, Record<string, Fields>> = {
  weapons: WEAPONS as unknown as Record<string, Fields>, enemies: ENEMIES as unknown as Record<string, Fields>,
  relics: RELIC_BY_ID as unknown as Record<string, Fields>, mods: MOD_BY_ID as unknown as Record<string, Fields>,
  biomes: BIOME_BY_ID as unknown as Record<string, Fields>, events: STAGE_EVENTS as unknown as Record<string, Fields>,
};
export const shipped: typeof templates = Object.fromEntries(CATEGORIES.map(k => [k, { ...templates[k] }])) as typeof templates;
const fields: Record<Category, string[]> = {
  weapons: ['name', 'desc', 'color', 'rarity', 'params'],
  enemies: ['name', 'hp', 'speed', 'radius', 'bodyColor', 'accentColor', 'contactDamage', 'knockbackResist', 'xp', 'score', 'minMinute', 'minStage', 'weight', 'pack', 'maxAlive', 'lunge', 'shoot', 'charge', 'fuse', 'guard', 'leap', 'heal', 'mortar'],
  relics: ['name', 'desc', 'color', 'rarity', 'add'],
  mods: ['name', 'desc', 'color', 'rarity', 'price', 'maxLevel', 'flags'],
  biomes: ['name', 'groundTint', 'pathTint', 'wallTint', 'capColor', 'pillarTint', 'leafTint', 'trunk', 'fog', 'dust', 'prints', 'rockColors', 'tileColors', 'blockColors', 'tufts', 'tree', 'rock', 'clusters', 'light', 'edge'],
  events: ['name', 'sub', 'seconds'],
};
const ID = /^[a-z][a-z0-9_-]{1,47}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
const colorKeys = new Set(['color', 'bodyColor', 'accentColor', 'groundTint', 'pathTint', 'wallTint', 'capColor', 'pillarTint', 'leafTint', 'trunk', 'fog', 'dust', 'prints']);
export const weaponTemplates = ['drones', 'aura', 'nova'] as const;
export const eventTemplates = ['meteors', 'goldrush', 'fog', 'parade', 'stampede'] as const;
function object(x: unknown): x is Fields { return !!x && typeof x === 'object' && !Array.isArray(x); }
function fail(path: string, message: string): never { throw new Error(`${path}: ${message}`); }
function keys(x: Fields, allowed: readonly string[], path: string): void {
  for (const k of Object.keys(x)) if (unsafe.has(k) || !allowed.includes(k)) fail(`${path}.${k}`, 'unknown field');
}
function str(x: unknown, p: string, max = 160): asserts x is string {
  if (typeof x !== 'string' || !x.trim() || x.length > max || /[<>&"'\u0000-\u001f\u007f]/.test(x)) fail(p, `expected plain text (1–${max} characters, no HTML metacharacters/control characters)`);
}
function num(x: unknown, p: string, lo: number, hi: number, integer = false): asserts x is number {
  if (typeof x !== 'number' || !Number.isFinite(x) || x < lo || x > hi || (integer && !Number.isInteger(x))) fail(p, `expected ${integer ? 'integer' : 'number'} ${lo}–${hi}`);
}
function color(x: unknown, p: string): void { if (typeof x !== 'string' || !COLOR.test(x)) fail(p, 'expected #rrggbb colour'); }
function numericPatch(x: unknown, base: Fields, path: string, stats = false): void {
  if (!object(x) || !Object.keys(x).length) fail(path, 'expected a nonempty parameter object');
  keys(x, Object.keys(base).filter(k => typeof base[k] === 'number'), path);
  for (const [k, v] of Object.entries(x)) {
    let lo = stats ? -0.5 : 0, hi = stats ? 100 : 1000;
    if (/cd|tick|interval|recover|windup|duration/.test(k)) { lo = 0.05; hi = 120; }
    if (/count|bullets|shells/.test(k)) { hi = 8; lo = 1; }
    if (/radius|range|Distance/.test(k)) hi = 30;
    if (k === 'size') { lo = 0.1; hi = 5; }
    if (k === 'spin') hi = 30;
    if (/slow|frac|Chance|Resist/.test(k)) hi = 1;
    num(v, `${path}.${k}`, lo, hi, /count|bullets|shells/.test(k));
  }
}
function checkSet(category: Category, patch: ContentPatch, base: Fields, path: string): void {
  const s = patch.set;
  if (!object(s)) fail(path, 'expected object');
  keys(s, fields[category], path);
  for (const [k, v] of Object.entries(s)) {
    const p = `${path}.${k}`;
    if (colorKeys.has(k)) { color(v, p); continue; }
    if (['name', 'desc', 'sub'].includes(k)) { str(v, p, k === 'desc' ? 400 : 100); continue; }
    if (k === 'rarity') { if (!['common', 'uncommon', 'rare', 'legendary'].includes(String(v))) fail(p, 'unknown rarity'); continue; }
    if (k === 'params') { numericPatch(v, (base.levels as { p: Fields }[])[0].p, p); continue; }
    if (k === 'add') { numericPatch(v, baseStats() as unknown as Fields, p, true); continue; }
    if (k === 'flags') {
      if (!object(base.flags)) fail(p, 'this hook template has no configurable numeric flags');
      numericPatch(v, base.flags, p); continue;
    }
    if (['tree', 'rock'].includes(k)) {
      const opts = k === 'tree' ? ['round', 'cactus', 'pine', 'dead', 'toy', 'lamp'] : ['stone', 'block', 'column', 'basalt', 'pumpkin', 'crystal'];
      if (!opts.includes(String(v))) fail(p, 'unknown prop style'); continue;
    }
    if (['rockColors', 'tileColors', 'blockColors', 'tufts'].includes(k)) {
      if (!Array.isArray(v) || v.length < 1 || v.length > 8) fail(p, 'expected 1–8 colours');
      v.forEach((c, i) => color(c, `${p}[${i}]`)); continue;
    }
    if (k === 'light') {
      if (!object(v)) fail(p, 'expected light palette');
      keys(v, ['sun', 'sky', 'ground'], p);
      for (const [key, a] of Object.entries(v)) {
        if (!Array.isArray(a) || a.length !== 3) fail(`${p}.${key}`, 'expected [r,g,b]');
        a.forEach((n, i) => num(n, `${p}.${key}[${i}]`, 0, 1));
      }
      continue;
    }
    if (k === 'edge') {
      if (!object(v)) fail(p, 'expected edge palette');
      keys(v, ['colors', 'shape'], p);
      if (v.shape !== undefined && !['bush', 'ball', 'block'].includes(String(v.shape))) fail(p, 'unknown edge shape');
      if (v.colors !== undefined) {
        if (!Array.isArray(v.colors) || !v.colors.length || v.colors.length > 8) fail(p, 'expected 1–8 colours');
        v.colors.forEach((c, i) => color(c, `${p}.colors[${i}]`));
      }
      continue;
    }
    if (k === 'clusters' || k === 'pack') {
      if (!Array.isArray(v) || v.length !== (k === 'pack' ? 2 : 4)) fail(p, 'incorrect array length');
      v.forEach((n, i) => num(n, `${p}[${i}]`, k === 'pack' ? 1 : 0, k === 'pack' ? 12 : 1, k === 'pack'));
      if (k === 'pack' && v[0] > v[1]) fail(p, 'minimum exceeds maximum');
      if (k === 'clusters' && v.reduce((a, b) => a + b, 0) <= 0) fail(p, 'at least one prop weight must be positive');
      continue;
    }
    if (object(base[k])) { numericPatch(v, base[k] as Fields, p); continue; }
    const ranges: Record<string, [number, number, boolean?]> = {
      hp: [1, 100000], speed: [0.1, 40], radius: [0.1, 3], contactDamage: [0, 1000], knockbackResist: [0, 1],
      xp: [0, 1000], score: [0, 10000], minMinute: [0, 10], minStage: [1, 1000, true], weight: [0, 100],
      maxAlive: [1, 100, true], price: [0, 100, true], maxLevel: [1, 5, true], seconds: [3, 90],
    };
    if (!ranges[k]) fail(p, 'parameter unavailable on this template');
    num(v, p, ...ranges[k]);
  }
}

export function validateMod(value: unknown): Validation {
  try {
    if (!object(value)) fail('$', 'expected a JSON object');
    keys(value, ['schemaVersion', 'id', 'name', 'version', 'description', 'content'], '$');
    if (value.schemaVersion !== 1) fail('schemaVersion', 'expected 1');
    if (typeof value.id !== 'string' || !ID.test(value.id)) fail('id', 'use 2–48 lowercase letters, numbers, _ or -; start with a letter');
    str(value.name, 'name', 80); str(value.version, 'version', 32);
    if (value.description !== undefined) str(value.description, 'description', 400);
    if (!object(value.content)) fail('content', 'expected an object');
    keys(value.content, CATEGORIES, 'content');
    let count = 0;
    for (const [kind, list] of Object.entries(value.content)) {
      const category = kind as Category;
      if (!Array.isArray(list)) fail(`content.${kind}`, 'expected an array');
      const ids = new Set<string>();
      for (const [i, entry] of list.entries()) {
        const p = `content.${kind}[${i}]`;
        if (!object(entry)) fail(p, 'expected an object');
        keys(entry, category === 'biomes' ? ['id', 'base', 'override', 'set', 'stages'] : ['id', 'base', 'override', 'set'], p);
        if (typeof entry.id !== 'string' || !ID.test(entry.id) || unsafe.has(entry.id)) fail(`${p}.id`, 'invalid content id');
        if (ids.has(entry.id)) fail(`${p}.id`, 'duplicate id in this pack'); ids.add(entry.id);
        if (entry.override !== undefined && typeof entry.override !== 'boolean') fail(`${p}.override`, 'expected boolean');
        if (typeof entry.base !== 'string' || !Object.hasOwn(shipped[category], entry.base)) fail(`${p}.base`, 'unknown shipped template');
        const base = shipped[category][entry.base];
        const existing = Object.hasOwn(shipped[category], entry.id);
        if (existing !== (entry.override === true)) fail(`${p}.override`, existing ? 'set true to override shipped content' : 'only shipped ids can be overridden');
        if (existing && entry.id !== entry.base) fail(`${p}.base`, 'an override must retain its original behaviour/template');
        if (!existing && !entry.id.startsWith(value.id + '_')) fail(`${p}.id`, `new ids must start with ${value.id}_`);
        if (category === 'weapons' && !(weaponTemplates as readonly string[]).includes(entry.base)) fail(`${p}.base`, 'supported weapon templates: drones, aura, nova');
        if (category === 'enemies' && (base.boss || base.miniboss || base.hidden || base.special || (base.minMinute as number) < 0)) fail(`${p}.base`, 'use a regular director enemy, not a boss or scripted encounter');
        if (category === 'relics' && !base.add) fail(`${p}.base`, 'use a stat relic; scripted rule relics cannot be cloned');
        if (category === 'events' && !(eventTemplates as readonly string[]).includes(entry.base)) fail(`${p}.base`, 'supported events: meteors, goldrush, fog, parade, stampede');
        checkSet(category, entry as unknown as ContentPatch, base, `${p}.set`);
        if (entry.stages !== undefined) {
          if (!Array.isArray(entry.stages) || !entry.stages.length || entry.stages.length > 32) fail(`${p}.stages`, 'expected 1–32 stage numbers');
          entry.stages.forEach((s, n) => num(s, `${p}.stages[${n}]`, 1, 1000, true));
        }
        count++;
      }
    }
    if (count < 1 || count > MOD_LIMITS.entries) fail('content', `expected 1–${MOD_LIMITS.entries} entries`);
    return { ok: true, mod: value as unknown as ModManifest };
  } catch (e) { return { ok: false, errors: [(e as Error).message] }; }
}
export function parseMod(raw: string): Validation {
  if (new TextEncoder().encode(raw).length > MOD_LIMITS.bytes) return { ok: false, errors: ['File exceeds 512 KiB'] };
  try { return validateMod(JSON.parse(raw)); } catch (e) { return { ok: false, errors: [`JSON: ${(e as Error).message}`] }; }
}
