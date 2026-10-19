import { WEAPONS, type WeaponDef } from '../data/weapons';
import { ENEMIES, type EnemyDef } from '../data/enemies';
import { RELICS, RELIC_BY_ID, type RelicDef } from '../data/relics';
import { MODS, MOD_BY_ID } from '../data/mods';
import type { ModDef } from '../game/modTypes';
import { BIOMES, BIOME_BY_ID, modBiomeStages, clearBiomeCache, type BiomeDef } from '../data/biomes';
import { STAGE_EVENTS, EVENT_IDS, type StageEventDef } from '../data/stageEvents';
import { refreshEnemyRegistry } from '../net/codec';
import { CATEGORIES, MOD_LIMITS, shipped, parseMod, type ModManifest, type Fields } from './schema';

export interface ModFile { key: string; name: string; raw: string; enabled: boolean; error?: string }
export interface ModResult { file: ModFile; mod?: ModManifest; errors: string[]; applied: boolean }
export interface ModPlan { results: ModResult[]; active: ModManifest[]; registries: typeof shipped; stages: Record<number, string> }
// Clone data but retain the shipped, audited hook functions. Never evaluate user text.
function clone<T>(x: T): T {
  if (Array.isArray(x)) return x.map(clone) as T;
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, clone(v)])) as T;
  return x;
}
function merge(base: Fields, patch: Fields): Fields {
  const out = clone(base);
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object'
      ? merge(out[k] as Fields, v as Fields) : clone(v);
  }
  return out;
}

/** Side-effect-free planning: an invalid pack never leaves half its content installed. Later overrides win. */
export function planMods(files: readonly ModFile[]): ModPlan {
  const registries = Object.fromEntries(CATEGORIES.map(k => [k, { ...shipped[k] }])) as typeof shipped;
  const stages: Record<number, string> = {};
  const results: ModResult[] = [], active: ModManifest[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const parsed = parseMod(file.raw);
    const result: ModResult = { file, errors: file.error ? [file.error] : parsed.ok ? [] : parsed.errors, applied: false };
    results.push(result);
    if (!parsed.ok || file.error) continue;
    const mod = result.mod = parsed.mod;
    if (!file.enabled) continue;
    if (seen.has(mod.id)) { result.errors.push(`Duplicate enabled pack id: ${mod.id}`); continue; }
    if (active.length >= MOD_LIMITS.files) { result.errors.push('At most 32 packs may be active'); continue; }
    const additions = (mod.content.enemies ?? []).filter(p => !registries.enemies[p.id]).length;
    if (Object.keys(registries.enemies).length + additions > MOD_LIMITS.enemies) {
      result.errors.push('Enemy registry exceeds the 256-type network limit'); continue;
    }
    for (const category of CATEGORIES) {
      for (const patch of mod.content[category] ?? []) {
        // Bases always refer to shipped templates. A later override is a complete, predictable replacement.
        const base = shipped[category][patch.base];
        const def = merge(base, patch.set);
        def.id = patch.id;
        if (category === 'weapons') {
          def.behavior = patch.base;
          def.modColor = patch.set.color ?? base.color;
          def.starter = true;
          if (patch.set.params) {
            const params = patch.set.params as Fields;
            def.levels = (base.levels as { text: string; p: Fields }[]).map(level => ({ ...level, p: merge(level.p, params) }));
            if (base.evolution) def.evolution = merge(base.evolution as Fields, { p: params });
          }
          if (patch.set.color && def.evolution) (def.evolution as Fields).color = patch.set.color;
          delete def.params;
        }
        if (category === 'events') def.behavior = patch.base;
        registries[category][patch.id] = def;
        if (category === 'biomes') for (const stage of patch.stages ?? []) stages[stage] = patch.id;
      }
    }
    seen.add(mod.id); active.push(mod); result.applied = true;
  }
  return { results, active, registries, stages };
}
function replace<T>(target: Record<string, T>, next: Record<string, Fields>): void {
  for (const k of Object.keys(target)) if (!Object.hasOwn(next, k)) delete target[k];
  Object.assign(target, next);
}
/** Called once before Game construction: pooled geometry and wire IDs are built from the final registry. */
export function installPlan(plan: ModPlan): void {
  replace<WeaponDef>(WEAPONS, plan.registries.weapons);
  replace<EnemyDef>(ENEMIES, plan.registries.enemies);
  replace<RelicDef>(RELIC_BY_ID, plan.registries.relics);
  replace<ModDef>(MOD_BY_ID, plan.registries.mods);
  replace<BiomeDef>(BIOME_BY_ID, plan.registries.biomes);
  replace<StageEventDef>(STAGE_EVENTS, plan.registries.events);
  RELICS.splice(0, RELICS.length, ...Object.values(RELIC_BY_ID));
  MODS.splice(0, MODS.length, ...Object.values(MOD_BY_ID));
  BIOMES.splice(0, BIOMES.length, ...Object.values(BIOME_BY_ID));
  EVENT_IDS.splice(0, EVENT_IDS.length, ...Object.keys(STAGE_EVENTS));
  for (const k of Object.keys(modBiomeStages)) delete modBiomeStages[Number(k)];
  Object.assign(modBiomeStages, plan.stages);
  clearBiomeCache(); refreshEnemyRegistry();
}
/** Stable object-key ordering; array order (including load order) is significant. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Fields)[k])).join(',') + '}';
  return JSON.stringify(value);
}
export async function hashMods(mods: readonly ModManifest[]): Promise<string> {
  if (!mods.length) return 'vanilla';
  const data = new TextEncoder().encode('infinishoot-mods-v1\n' + canonical(mods));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
}
export function matchingMods(local: string, remote: unknown): boolean {
  return (remote === undefined && local === 'vanilla') || (typeof remote === 'string' && remote === local);
}
