import { LogRing, displayOptions, type DisplayOptions, type Release } from '../../electron/logic.mjs';
import { loadJson, saveJson } from '../core/storage';
import { displayState } from './display';

interface DesktopBridge {
  info(): Promise<{ version: string; os: string; activeVsync: boolean; windowMode: DisplayOptions['windowMode'] }>;
  configure(options: DisplayOptions, settings: unknown): Promise<{ restartRequired: boolean }>;
  checkUpdate(): Promise<Release | null>;
  openRelease(): Promise<void>;
  log(kind: string, message: string): void;
  exportLog(): Promise<'saved' | 'cancelled' | 'failed'>;
  windowAction(action: 'minimize' | 'maximize' | 'close'): Promise<void>;
  onWindowMode(callback: (mode: DisplayOptions['windowMode']) => void): () => void;
}
declare global { interface Window { desktop?: DesktopBridge; } }
export const desktop = typeof window === 'undefined' ? undefined : window.desktop;
const ring = new LogRing(loadJson('errors.v1', []));
let context: Record<string, unknown> = {};
let initialized = false;
let lastOptions = '';
export let updateRelease: Release | null = null;
export let restartRequired = false;
export const diagnostics = { version: typeof __APP_VERSION__ === 'undefined' ? 'dev' : __APP_VERSION__, os: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent };
const notify = () => window.dispatchEvent(new Event('desktop-state'));
export function recordError(kind: string, error: unknown): void {
  ring.add(kind, error);
  const entry = ring.entries[ring.entries.length - 1];
  if (desktop) desktop.log(entry.kind, entry.message);
  else saveJson('errors.v1', ring.entries);
}
// Installed during module evaluation, before renderer/game construction.
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => recordError('error', event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => recordError('rejection', event.reason));
  if (!desktop) {
    const original = console.error.bind(console);
    console.error = (...args: unknown[]) => { original(...args); recordError('console', args.map(v => v instanceof Error ? v.stack : String(v)).join(' ')); };
  }
}
export function applyDesktopSettings(raw: DisplayOptions & object): void {
  const options = displayOptions(raw);
  displayState.cap = options.frameCap === 'unlimited' ? 0 : Number(options.frameCap);
  context = {};
  for (const [key, value] of Object.entries(raw)) {
    if (/name|loadout|look|skin|pet|hero|token|password|credential|relay|authorization/i.test(key)) continue;
    if (typeof value === 'boolean' || typeof value === 'number' || (typeof value === 'string' && value.length <= 24 && /^[a-z0-9-]+$/i.test(value))) context[key] = value;
  }
  if (!options.autoUpdate) updateRelease = null;
  if (!desktop) return;
  const serialized = JSON.stringify({ options, context });
  if (serialized === lastOptions) return;
  lastOptions = serialized;
  void desktop.configure(options, context).then(async (result) => {
    restartRequired = result.restartRequired;
    if (!initialized) {
      initialized = true;
      const info = await desktop.info(); Object.assign(diagnostics, { version: info.version, os: info.os });
    }
    notify();
    if (options.autoUpdate) {
      const release = await desktop.checkUpdate();
      // A switch turned off while the request was pending must suppress the banner.
      if (JSON.parse(lastOptions).options.autoUpdate) { updateRelease = release; notify(); }
    }
  }).catch(error => recordError('desktop', error));
}
export async function exportErrorLog(): Promise<'saved' | 'cancelled' | 'failed'> {
  try {
    if (desktop) return await desktop.exportLog();
    const url = URL.createObjectURL(new Blob([ring.text({ ...diagnostics, settings: context })], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'InfiniShoot-error-log.txt'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return 'saved';
  } catch (error) { recordError('export', error); return 'failed'; }
}
