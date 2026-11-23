import { HEAT } from '../data/heat';
import { localize, t } from '../i18n';
import type { Game } from './game';
import type { Hero } from './hero';
import type { LoadoutItem } from '../ui/hud';
import type { RouteView } from '../ui/routeMap';

const heat = (id: 'dash' | 'shop') => HEAT.find((h) => h.id === id)!;
const boots = heat('dash'),
  shop = heat('shop');
export const pactTuning = { max: 3, goldPerHeat: 3, penalty: 0.5 };

export function pactHeat(h: Hero): number {
  return h.play.pactBoots * boots.points + h.play.pactShop * shop.points;
}

// Personal Heat never changes a teammate's mobility, enemies or shop.
function nextPact(stage: number, h: Hero) {
  return stage % 2 && h.mech.id !== 'duelist' ? boots : shop;
}

export function signPact(g: Game, h: Hero, stage: number): boolean {
  const r = g.route,
    p = h.play;
  if (
    g.role === 'client' ||
    g.mode !== 'shop' ||
    h.left ||
    !r.open ||
    r.phase !== 'map' ||
    r.decided >= 0 ||
    g.stage !== stage ||
    p.pactStage >= stage ||
    p.pactBoots + p.pactShop >= pactTuning.max
  )
    return false;
  if (nextPact(stage, h) === boots) p.pactBoots++;
  else p.pactShop++;
  p.pactStage = stage;
  h.loadoutDirty = true;
  if (g.localCoop) g.heroes[0].loadoutDirty = true;
  h.refreshLive();
  return true;
}

export function couchHeat(g: Game): string | undefined {
  if (!g.localCoop) return;
  return (
    g.heroes
      .filter((h) => !h.left && pactHeat(h) > 0)
      .map((h) => t('g5.seatHeat', { seat: h.index + 1, n: pactHeat(h) }))
      .join(' · ') || undefined
  );
}

export function payPacts(this: Game): void {
  for (const h of this.heroes) {
    const p = h.play,
      reward = pactHeat(h) * pactTuning.goldPerHeat;
    if (!h.left && reward && this.stage > p.pactStage && this.stage > p.pactPaid) {
      p.pactPaid = this.stage;
      h.gold += reward;
      this.goldFx(h, reward);
    }
  }
}

export function pactLoadout(h: Hero): LoadoutItem[] {
  const n = pactHeat(h);
  if (!n) return [];
  const p = h.play;
  return [
    {
      id: 'pact_heat',
      icon: '♨',
      name: 'Pact Heat',
      desc: `Dash cooldown +${50 * p.pactBoots}% · Mod prices +${50 * p.pactShop}% · ${n * pactTuning.goldPerHeat} gold per clear`,
      level: n,
      max: false,
      color: '#ef7d57',
      kind: 'passive',
      slot: 'bonus',
    },
  ];
}

/** Append after the route cards, leaving the ordinary route vote as the default focus. */
export function showPacts(g: Game, el: HTMLElement, v: RouteView): void {
  if (v.phase !== 'map') return;
  const row = document.createElement('div');
  row.className = 'pact-row';
  for (const h of g.localCoop ? g.heroes : [g.hero]) {
    if (h.left) continue;
    const p = h.play,
      def = nextPact(v.stage, h);
    const signed = p.pactStage === v.stage,
      full = p.pactBoots + p.pactShop >= pactTuning.max;
    const btn = document.createElement('button');
    btn.type = 'button';
    const label =
      signed || full
        ? t('g5.signed', { heat: pactHeat(h), gold: pactHeat(h) * pactTuning.goldPerHeat })
        : t(def === boots ? 'g5.boots' : 'g5.inflation', {
            gold: def.points * pactTuning.goldPerHeat,
          });
    if (g.localCoop) {
      const who = document.createElement('bdi');
      who.textContent = h.name;
      btn.append(who, ' · ');
    }
    btn.append(label);
    btn.disabled = signed || full || (g.role !== 'client' && g.route.decided >= 0);
    if (!btn.disabled) btn.dataset.nav = '';
    btn.title = localize(def.desc);
    btn.onclick = () => {
      if (g.localCoop) g.heroAction(h, 'pact', v.stage, 1);
      else g.ui('pact', v.stage);
    };
    row.append(btn);
  }
  el.querySelector('.pact-row')?.remove();
  el.append(row);
}
