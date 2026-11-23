/**
 * localStorage wrapper. Storage can be missing, full or blocked (private
 * windows, previews), so every access is guarded and falls back to defaults.
 */
const PREFIX = 'infinishoot.';

export function loadJson<T>(key: string, fallback: T): T {
  try {
    if (key === NEMESIS_HISTORY_KEY && islandHunts) return (islandHunts.read() ?? fallback) as T;
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw) as T;
    // Merge plain objects so newly added fields get their defaults.
    if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) {
      return { ...fallback, ...parsed };
    }
    return parsed;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    if (key === NEMESIS_HISTORY_KEY && islandHunts) return islandHunts.write(value);
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Ignore: saving is best-effort.
  }
}

/** Independent of the versioned main save. Older profiles start with no rivals. */
export const NEMESIS_HISTORY_KEY = 'nemesis.v1';

export const CAMPAIGN_KEY = 'campaign.v1';

/** While sailing, the existing hunt system reads the island log. Guests mirror it in memory. */
export let islandHunts: { read(): unknown; write(value: unknown): void } | null = null;
export function setIslandHunts(store: typeof islandHunts): void { islandHunts = store; }
