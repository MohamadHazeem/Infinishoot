import { onlineServer } from '../net/onlineServer';

export interface WorldGoal {
  total: number;
  target: number;
  ends: number;
  unlocked: boolean;
}

export function readWorldGoal(raw: unknown, now = Date.now()): WorldGoal | null {
  if (!raw || typeof raw !== 'object') return null;
  const { total, target, ends, unlocked } = raw as WorldGoal;
  if (
    !Number.isSafeInteger(total) ||
    !Number.isSafeInteger(target) ||
    target <= 0 ||
    total < 0 ||
    total > target ||
    !Number.isSafeInteger(ends) ||
    ends <= now ||
    ends > now + 7 * 86400000 ||
    unlocked !== (total === target)
  )
    return null;
  return { total, target, ends, unlocked };
}

/** Only titles poll the optional service. The cosmetic also expires during long runs. */
export class WorldGoals {
  private goal: WorldGoal | null = null;
  private untilCheck = 0;
  private nextRead = 0;
  private pending = false;
  constructor(
    private changed: (goal: WorldGoal | null) => void,
    private base = onlineServer,
  ) {}
  tick(title: boolean, dt: number): void {
    if (!this.base || (this.untilCheck -= dt) > 0) return;
    this.untilCheck = 1;
    const now = Date.now();
    if (this.goal && this.goal.ends <= now) {
      this.goal = null;
      this.nextRead = 0;
      this.changed(null);
    }
    if (title && !this.pending && now >= this.nextRead) {
      this.nextRead = now + 60000;
      void this.refresh();
    }
  }
  private async refresh(): Promise<void> {
    this.pending = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      const r = await fetch(this.base + '/goals', {
        credentials: 'omit',
        signal: controller.signal,
      });
      this.goal = r.ok ? readWorldGoal(await r.json()) : null;
    } catch {
      this.goal = null;
    } finally {
      clearTimeout(timer);
      this.pending = false;
      this.changed(this.goal);
    }
  }
}
