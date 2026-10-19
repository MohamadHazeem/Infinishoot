import { localizeHtml, localize } from '../i18n';
import { ACCESSORIES, decodeLook, encodeLook, PRISM_CYCLE, SWEETIE16, WEAPON_SKINS, type HeroCustom } from '../data/customise';
import { saveSettings, settings } from '../game/settings';
import type { Screens } from './screens';

/**
 * EXTRAS > CUSTOMISE (graphics lane): pick armour, body and accent colours
 * from the Sweetie 16 palette (or keep the skin's), an accessory and a
 * weapon skin. Changes apply live to the hero behind the menu (the camera
 * moves in on it while the screen is open, see systems/graphics.ts) and are
 * saved in settings (`settings.look`); co-op teammates get them in
 * hello/start. Also adds SETTINGS > ANIME LOOK. Plain DOM, pixel style,
 * CSS injected from here.
 */
const CSS = `
#scr-customise {
  align-items: flex-start;
  padding-left: calc(6 * var(--p));
}
#scr-customise .cu-panel {
  --bg: var(--ink);
  --hi: var(--night);
  --lo: var(--ink);
  background: var(--ink);
  box-shadow: 0 0 0 var(--p) var(--night), 0 0 0 calc(2 * var(--p)) var(--ink);
  padding: calc(3 * var(--p)) calc(4 * var(--p));
  display: grid;
  gap: calc(2 * var(--p));
  max-width: 470px;
}
#scr-customise .cu-sec {
  font: 12px var(--label);
  letter-spacing: 1px;
  color: var(--yellow);
}
#scr-customise .cu-row {
  display: flex;
  flex-wrap: wrap;
  gap: calc(1 * var(--p));
}
#scr-customise button.cu-sw {
  width: 20px;
  height: 20px;
  padding: 0;
  font: 12px var(--label);
  background: var(--c);
  box-shadow: 0 0 0 var(--p) var(--ink);
  text-shadow: none;
}
#scr-customise button.cu-sw.skin {
  background: var(--night);
  color: var(--mist);
  width: 38px;
}
#scr-customise button.cu-sw.on {
  box-shadow: 0 0 0 var(--p) var(--white), 0 0 0 calc(2 * var(--p)) var(--ink);
}
#scr-customise button.cu-sw.focused {
  box-shadow: 0 0 0 var(--p) var(--yellow), 0 0 0 calc(2 * var(--p)) var(--ink);
}
#scr-customise button.cu-opt {
  font: 20px var(--font);
  padding: 6px 12px 8px;
}
#scr-customise button.cu-opt.on {
  --bg: var(--green);
  --hi: var(--lime);
  --lo: var(--teal);
}
#scr-customise button.cu-opt.on.focused {
  --bg: var(--orange);
  --hi: var(--yellow);
  --lo: var(--red);
}
#scr-customise .cu-chips {
  display: inline-flex;
  gap: 2px;
  margin-left: 6px;
  vertical-align: middle;
}
#scr-customise .cu-chips i {
  width: 6px;
  height: 12px;
  background: var(--c);
  box-shadow: 0 0 0 1px var(--ink);
}
#scr-customise .note {
  max-width: 450px;
  font-size: 18px;
}
`;

type ColorKey = 'armor' | 'body' | 'accent';

export class CustomiseUi {
  readonly el: HTMLElement;
  private shownKey = '';

  constructor(private screens: Screens) {
    if (!document.getElementById('cu-css')) {
      const st = document.createElement('style');
      st.id = 'cu-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.el = document.createElement('div');
    this.el.id = 'scr-customise';
    this.el.className = 'screen';
    this.el.innerHTML = localizeHtml(`<h1>CUSTOMISE</h1><div class="cu-panel"></div>`);
    screens.addScreen('customise', this.el, { columns: 17, onBack: () => screens.show('extras') });
    // EXTRAS > CUSTOMISE, next to the wardrobe.
    document.querySelector('#scr-extras [data-act=wardrobe]')?.insertAdjacentHTML('afterend', localizeHtml('<button data-nav data-act="cu-open">CUSTOMISE</button>'));
    document.querySelector('#scr-extras [data-act=cu-open]')?.addEventListener('click', () => this.open());
    // SETTINGS > ANIME LOOK (after SHOCKWAVES); the settings screen labels every data-toggle on show.
    const after = document.querySelector('#scr-settings [data-toggle=distortion]');
    if (after && !document.querySelector('#scr-settings [data-toggle=animeLook]')) {
      after.insertAdjacentHTML('afterend', localizeHtml('<button data-nav data-toggle="animeLook">ANIME LOOK <b></b></button>'));
      const b = document.querySelector<HTMLElement>('#scr-settings [data-toggle=animeLook]')!;
      b.addEventListener('click', () => {
        settings.animeLook = !settings.animeLook;
        saveSettings();
        b.querySelector('b')!.textContent = localize(settings.animeLook ? 'ON' : 'OFF');
      });
    }
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cu]');
      if (!b) return;
      const c = decodeLook(settings.look);
      const v = Number(b.dataset.v);
      switch (b.dataset.cu) {
        case 'armor':
        case 'body':
        case 'accent':
          c[b.dataset.cu as ColorKey] = v;
          break;
        case 'acc':
          c.accessory = v;
          break;
        case 'weapon':
          c.weapon = v;
          break;
        case 'reset':
          Object.assign(c, decodeLook(''));
          break;
        case 'back':
          return screens.show('extras');
      }
      this.set(c, b);
    });
  }

  /** Is the screen open (the camera frames the hero while it is). */
  get isOpen(): boolean {
    return this.screens.current === 'customise';
  }

  open(): void {
    this.render();
    this.screens.show('customise', this.focusIndex(`[data-cu=armor].on`));
  }

  private set(c: HeroCustom, from: HTMLElement): void {
    settings.look = encodeLook(c);
    saveSettings();
    const sel = `[data-cu="${from.dataset.cu}"][data-v="${from.dataset.v ?? ''}"]`;
    this.render();
    this.screens.show('customise', Math.max(0, this.focusIndex(sel)));
  }

  private focusIndex(sel: string): number {
    const items = [...this.el.querySelectorAll('[data-nav]')];
    const t = this.el.querySelector(sel);
    return t ? items.indexOf(t) : 0;
  }

  private render(): void {
    const c = decodeLook(settings.look);
    this.shownKey = settings.look;
    const row = (key: ColorKey, label: string) => {
      const cur = c[key];
      const sw = SWEETIE16.map((hex, i) => `<button data-nav data-cu="${key}" data-v="${i}" class="cu-sw ${cur === i ? 'on' : ''}" style="--c:${hex}" aria-label="${label} colour ${i + 1}"></button>`).join('');
      return `<div class="cu-sec">${label}</div><div class="cu-row"><button data-nav data-cu="${key}" data-v="-1" class="cu-sw skin ${cur < 0 ? 'on' : ''}">SKIN</button>${sw}</div>`;
    };
    const chips = (cols: readonly string[]) => `<span class="cu-chips">${cols.map((x) => `<i style="--c:${x}"></i>`).join('')}</span>`;
    this.el.querySelector('.cu-panel')!.innerHTML = localizeHtml(`
      ${row('armor', 'ARMOUR')}
      ${row('body', 'BODY')}
      ${row('accent', 'ACCENT')}
      <div class="cu-sec">ACCESSORY</div>
      <div class="cu-row">${ACCESSORIES.map((a, i) => `<button data-nav data-cu="acc" data-v="${i}" class="cu-opt ${c.accessory === i ? 'on' : ''}">${a.name.toUpperCase()}</button>`).join('')}</div>
      <div class="cu-sec">WEAPON SKIN</div>
      <div class="cu-row">${WEAPON_SKINS.map((w, i) => `<button data-nav data-cu="weapon" data-v="${i}" class="cu-opt ${c.weapon === i ? 'on' : ''}">${w.name.toUpperCase()}${w.main ? chips(w.cycle ? PRISM_CYCLE.slice(0, 4) : [w.main, w.hot]) : ''}</button>`).join('')}</div>
      <p class="note">Colours paint your hero everywhere; in co-op your armour keeps your player colour. Weapon skins recolour your shots and their trails (enemy shots never change).</p>
      <div class="cu-row"><button data-nav data-cu="reset" class="cu-opt">RESET</button><button data-nav data-cu="back" class="cu-opt">BACK</button></div>`);
  }

  /** Per frame: re-render if the look changed elsewhere (test links, another tab). */
  update(): void {
    if (this.isOpen && settings.look !== this.shownKey) this.render();
  }
}
