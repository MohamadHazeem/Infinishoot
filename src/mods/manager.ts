import { loadJson, saveJson } from '../core/storage';
import { MOD_LIMITS, parseMod } from './schema';
import { hashMods, installPlan, planMods, type ModFile, type ModPlan } from './registry';
import { readModArchive } from './archive';
interface DesktopFiles { path: string; files: { name: string; raw: string; error?: string }[]; error?: string }
declare global { interface Window { infiniMods?: { list(): Promise<DesktopFiles>; openFolder(): Promise<void> } } }
interface Preferences { version: 1; files: ModFile[]; order: string[]; enabled: string[] }
export const modSession = { hash: 'vanilla', count: 0 };
export class ModManager {
  files: ModFile[] = [];
  plan: ModPlan = planMods([]);
  folder = '';
  errors: string[] = [];
  pending = false;
  private prefs: Preferences;
  constructor() {
    const raw = loadJson<unknown>('contentMods', null);
    const p = raw && typeof raw === 'object' ? raw as Partial<Preferences> : {};
    this.prefs = { version: 1, files: [], order: [], enabled: [] };
    if (p.version === 1) {
      let bytes = 0;
      for (const file of Array.isArray(p.files) ? p.files.slice(0, MOD_LIMITS.files) : []) {
        if (!file || typeof file.name !== 'string' || typeof file.raw !== 'string' || typeof file.key !== 'string' || !file.key.startsWith('import/')) continue;
        bytes += new TextEncoder().encode(file.raw).length;
        if (bytes > MOD_LIMITS.totalBytes || file.raw.length > MOD_LIMITS.bytes) continue;
        this.prefs.files.push({ key: file.key.slice(0, 200), name: file.name.slice(0, 160), raw: file.raw, enabled: false });
      }
      this.prefs.order = Array.isArray(p.order) ? p.order.filter((x): x is string => typeof x === 'string').slice(0, 64) : [];
      this.prefs.enabled = Array.isArray(p.enabled) ? p.enabled.filter((x): x is string => typeof x === 'string').slice(0, 64) : [];
    }
  }
  async initialize(preview?: ModFile[]): Promise<void> {
    this.files = this.prefs.files.map(f => ({ ...f }));
    if (typeof window !== 'undefined' && window.infiniMods) {
      try {
        const desktop = await window.infiniMods.list(); this.folder = desktop.path;
        if (desktop.error) this.errors.push(desktop.error);
        this.files.push(...desktop.files.map(f => ({ ...f, key: 'desktop/' + f.name, enabled: false })));
      } catch (e) { this.errors.push(`Desktop mods: ${(e as Error).message}`); }
    }
    const order = this.prefs.order;
    this.files.sort((a, b) => {
      const ai = order.indexOf(a.key), bi = order.indexOf(b.key);
      return (ai < 0 ? 10000 : ai) - (bi < 0 ? 10000 : bi) || a.key.localeCompare(b.key, 'en');
    });
    this.files.forEach(f => f.enabled = this.prefs.enabled.includes(f.key));
    if (preview) this.files = preview; // test links: session-only; never write example packs to storage
    this.plan = planMods(this.files);
    try {
      const hash = await hashMods(this.plan.active);
      installPlan(this.plan);
      modSession.hash = hash; modSession.count = this.plan.active.length;
    } catch (e) { this.errors.push(`Mods disabled: ${(e as Error).message}`); installPlan(planMods([])); modSession.hash = 'vanilla'; modSession.count = 0; }
  }
  private save(): void {
    this.plan = planMods(this.files); this.pending = true;
    const prefs: Preferences = { version: 1, files: this.files.filter(f => f.key.startsWith('import/')).map(f => ({ ...f, enabled: false })), order: this.files.map(f => f.key), enabled: this.files.filter(f => f.enabled).map(f => f.key) };
    this.prefs = prefs;
    saveJson('contentMods', prefs);
    // storage.ts is intentionally best effort. Tell the player if this particular large write did not persist.
    const saved = loadJson<Preferences | null>('contentMods', null);
    if (JSON.stringify(saved) !== JSON.stringify(prefs)) this.errors.push('Could not save mod preferences. Browser storage may be full or blocked.');
  }
  toggle(key: string): void { const f = this.files.find(f => f.key === key); if (f) { f.enabled = !f.enabled; this.save(); } }
  move(key: string, delta: number): void {
    const at = this.files.findIndex(f => f.key === key), to = at + delta;
    if (at < 0 || to < 0 || to >= this.files.length) return;
    [this.files[at], this.files[to]] = [this.files[to], this.files[at]]; this.save();
  }
  remove(key: string): void { this.files = this.files.filter(f => f.key !== key); this.save(); }
  async importFile(name: string, data: Uint8Array): Promise<void> {
    const imported = await readModArchive(name, data);
    const next = [...this.files];
    const incoming = new Set<string>();
    for (const f of imported) {
      const parsed = parseMod(f.raw);
      const key = 'import/' + (parsed.ok ? parsed.mod.id : f.name);
      if (incoming.has(key)) throw new Error('Import contains duplicate pack IDs: ' + key.slice(7));
      incoming.add(key);
      const old = next.findIndex(x => x.key === key);
      const file = { ...f, key, enabled: old >= 0 ? next[old].enabled : false };
      if (old >= 0) next[old] = file; else next.push(file);
    }
    if (next.length > 64 || next.filter(f => f.key.startsWith('import/')).length > MOD_LIMITS.files || next.reduce((n, f) => n + new TextEncoder().encode(f.raw).length, 0) > MOD_LIMITS.totalBytes) throw new Error('Library limit: 32 imported packs / 4 MiB total');
    this.files = next; this.save();
  }
}
export const mods = new ModManager();
