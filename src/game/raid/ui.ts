import type { Game } from '../game';
import type { RaidState } from './encounter';
import { raidTuning } from './encounter';
import { t } from '../../i18n';
import { promptText } from '../../ui/prompts';
import { loadJson, saveJson } from '../../core/storage';
import { grantAchievement, persist, save, saveLock } from '../save';
import { fetchTop, leaderboardEnabled } from '../../net/leaderboard';

export interface RaidRecord {
  time: number;
  players: number;
  difficulty: string;
  score: number;
  date: string;
}
export function raidRecords(): RaidRecord[] {
  const raw = loadJson<unknown>('raid.records.v1', []);
  return Array.isArray(raw)
    ? raw
        .filter(
          (x): x is RaidRecord =>
            !!x &&
            Number.isFinite(x.time) &&
            x.time > 0 &&
            x.time <= raidTuning.wipe &&
            Number.isFinite(x.players) &&
            x.players >= 1 &&
            x.players <= 8 &&
            typeof x.difficulty === 'string' &&
            typeof x.date === 'string',
        )
        .slice(0, 10)
    : [];
}
export function raidReward(time: number, players: number, difficulty: string, score: number): void {
  if (saveLock.on) return;
  grantAchievement('hydra_engine');
  for (const id of ['raid_skin', 'raid_ember'])
    if (!save.meta.rewards.includes(id)) save.meta.rewards.push(id);
  persist();
  const rows = raidRecords();
  rows.push({ time, players, difficulty, score, date: new Date().toISOString().slice(0, 10) });
  rows.sort((a, b) => a.time - b.time);
  saveJson('raid.records.v1', rows.slice(0, 10));
}
export class RaidHud {
  private panel: HTMLElement;
  private at = -1;
  constructor(private g: Game) {
    if (!document.getElementById('raid-css')) {
      const css = document.createElement('style');
      css.id = 'raid-css';
      css.textContent = `
.raid-hud {max-width:calc(120 * var(--p));padding:calc(3 * var(--p));background:var(--night);color:var(--white);font:calc(6 * var(--p)) var(--font);white-space:pre-line;--hi:var(--blue);--lo:var(--ink);--ring:var(--ink);box-shadow:inset var(--p) var(--p) 0 var(--hi),inset calc(-1 * var(--p)) calc(-1 * var(--p)) 0 var(--lo),0 0 0 var(--p) var(--ring);}
.raid-hud b {color:var(--yellow)}
.raid-hud small {font-size:calc(5 * var(--p));color:var(--cyan)}
.raid-records {max-height:60vh;overflow:auto;white-space:pre-line;text-align:start;color:var(--cyan);font:calc(7 * var(--p)) var(--font)}
body[data-raid='true'] #timer {visibility:hidden}
body[data-raid='true'] #objective {display:none}
#scr-modes.screen {overflow-y:auto;justify-content:flex-start;}
#scr-modes.screen .mode-grid {grid-template-columns:repeat(4,minmax(0,1fr));}
@media(max-width:900px){#scr-modes.screen .mode-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}
`;
      document.head.append(css);
    }
    this.panel = document.createElement('div');
    this.panel.className = 'raid-hud';
    this.panel.hidden = true;
    document.getElementById('goals')?.prepend(this.panel);
    const button = document.createElement('button');
    button.dataset.nav = '';
    button.textContent = t('raid.records');
    button.addEventListener('click', () => this.showRecords());
    document.querySelector('#scr-modes > .menu.row:last-child')?.append(button);
  }
  render(s: RaidState | null): void {
    const active = String(!!s);
    if (document.body.dataset.raid !== active) document.body.dataset.raid = active;
    if (this.panel.hidden === !!s) this.panel.hidden = !s;
    if (!s) return;
    const tick = Math.floor(s.time * 5);
    if (tick === this.at) return;
    this.at = tick;
    const phase = t(`raid.${s.phase === 'heads' ? 'roles' : s.phase}`);
    let heads = '';
    for (let i = 0; i < 3; i++) {
      const h = s.heads[i];
      heads += `${t((['raid.fire', 'raid.shield', 'raid.parry'] as const)[i])}: ${h.sealed ? '✓' : h.stump > 0 ? `${t('raid.burn')} ${Math.ceil(h.stump)}s` : `${Math.ceil((h.hp / h.max) * 100)}%${h.copies > 1 ? ` ×${h.copies}` : ''}`}\n`;
    }
    const a = s.actors[this.g.hero.index];
    this.panel.textContent = `${t('raid.title')}\n${clock(s.time)} · ${t(s.time >= raidTuning.enrage ? 'raid.enraged' : 'raid.enrage')} ${clock(Math.max(0, raidTuning.enrage - s.time))}\n${phase}\n${s.phase === 'core' ? `${s.delivered}/${raidTuning.cells} · ${t('raid.carry')}` : heads}${s.phase === 'core' ? '' : '\n' + t('raid.help', { parry: promptText('parry') })}\n${a?.cell ? t('raid.cell') : s.phase === 'core' ? t('raid.fetch') : a?.torch ? t('raid.torch') : t('raid.brazier')}`;
  }
  private showRecords(): void {
    const screens = this.g.screens;
    let el = document.getElementById('scr-raid');
    if (!el) {
      el = document.createElement('div');
      el.id = 'scr-raid';
      el.className = 'screen dim';
      el.hidden = true;
      const title = document.createElement('h1');
      title.textContent = t('raid.records');
      el.append(title);
      const board = document.createElement('div');
      board.className = 'raid-records';
      el.append(board);
      const back = document.createElement('button');
      back.dataset.nav = '';
      back.textContent = t('raid.back');
      back.addEventListener('click', () => screens.show('modes'));
      el.append(back);
      if (leaderboardEnabled) {
        const online = document.createElement('button');
        online.dataset.nav = '';
        online.textContent = t('raid.online');
        online.addEventListener('click', () => {
          void fetchTop(`raid-${this.g.difficulty.id}`).then((rows) => {
            board.textContent = rows
              ? rows.map((r, i) => `${i + 1}. ${r.name} · ${clock(r.time)}`).join('\n')
              : t('raid.offline');
          });
        });
        el.append(online);
      }
      document.getElementById('hud')!.append(el);
      screens.addScreen('raid', el, { onBack: () => screens.show('modes') });
    }
    el.querySelector('.raid-records')!.textContent =
      raidRecords()
        .map(
          (r, i) =>
            `${i + 1}. ${clock(r.time)} · ${r.players} · ${r.difficulty.toUpperCase()} · ${r.date}`,
        )
        .join('\n') || t('raid.empty');
    screens.show('raid');
  }
}
function clock(time: number): string {
  return `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
}
