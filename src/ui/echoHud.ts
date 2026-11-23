import { HERO_BY_ID } from '../data/heroes';
import { SPECIALS } from '../data/specials';
import { WEAPONS } from '../data/weapons';
import { getLanguage, localize, t } from '../i18n';
import { animateHero, createHero, newPose, setHeroModel, type HeroRig } from '../game/heroModel';
import type { Game } from '../game/game';
import { prompt } from './prompts';

export interface EncounterView {
  kind: 'echo' | 'clock';
  stage: number;
  attempt: number;
  intro: boolean;
  seconds: number;
  hp: number;
  hero: string;
  weapon: string;
  special: boolean;
  rank: number;
  ghost: boolean;
  x: number;
  z: number;
  facing: number;
  dash: boolean;
}
export function newEncounterView(kind: EncounterView['kind']): EncounterView {
  return {
    kind,
    stage: 0,
    attempt: 1,
    intro: true,
    seconds: 60,
    hp: 100,
    hero: 'rookie',
    weapon: 'buster',
    special: false,
    rank: 1,
    ghost: false,
    x: 0,
    z: 0,
    facing: 0,
    dash: false,
  };
}

const css = `
#hud.echo-clock-stage :is(#objective,#objptr){display:none!important}
.echo-panel{position:absolute;z-index:5;top:15%;left:50%;transform:translateX(-50%);max-width:min(88%,calc(145 * var(--p)));text-align:center;background:var(--ink);color:var(--white);border-inline-start:calc(2 * var(--p)) solid var(--cyan);padding:var(--p) calc(3 * var(--p));font:calc(6 * var(--p))/1.1 var(--font);pointer-events:none}
.echo-panel[hidden],.echo-panel [hidden]{display:none}
.echo-panel.echo-intro{top:auto;bottom:23%;padding:calc(3 * var(--p));box-shadow:0 var(--p) var(--navy)}
.echo-panel strong{color:var(--cyan);font-family:var(--display);font-size:1.25em}
.echo-panel.echo-intro strong{display:block;font-size:1.65em}
.echo-panel small{display:inline-block;margin-inline-start:calc(2 * var(--p));color:var(--yellow);font:inherit}
.echo-panel p{margin:var(--p) 0}.echo-panel button{pointer-events:auto;font:inherit;padding:0 calc(2 * var(--p));color:var(--white);background:var(--navy);border:var(--p) solid var(--sky)}
.echo-panel progress{display:block;width:100%;height:var(--p);margin-top:var(--p);border:0;appearance:none;background:var(--plum)}
.echo-panel progress::-webkit-progress-bar{background:var(--plum)}.echo-panel progress::-webkit-progress-value{background:var(--cyan)}
`;

export class EchoHud {
  visible = false;
  private panel: HTMLElement;
  private title: HTMLElement;
  private detail: HTMLElement;
  private text: HTMLElement;
  private skip: HTMLButtonElement;
  private bar: HTMLProgressElement;
  private shownKind = '';
  private shownAttempt = 0;
  private shownStage = 0;
  private dismissed = false;
  private shownIntro = false;
  private shownLanguage = '';
  private shownWeapon = '';
  private shownRank = 0;
  private shownSeconds = -1;
  private shownHero = '';
  private rig?: HeroRig;
  private model = '';
  private pose = newPose();
  constructor(
    private g: Game,
    private root: HTMLElement,
  ) {
    if (!document.getElementById('echo-style')) {
      const style = document.createElement('style');
      style.id = 'echo-style';
      style.textContent = css;
      document.head.append(style);
    }
    this.panel = document.createElement('section');
    this.panel.className = 'echo-panel';
    this.panel.hidden = true;
    this.title = document.createElement('strong');
    this.detail = document.createElement('small');
    this.text = document.createElement('p');
    this.bar = document.createElement('progress');
    this.bar.max = 100;
    this.skip = document.createElement('button');
    this.skip.type = 'button';
    this.skip.dataset.nav = '';
    this.skip.onclick = () => {
      this.dismissed = true;
    };
    this.panel.append(this.title, this.detail, this.text, this.bar, this.skip);
    root.append(this.panel);
  }
  reset() {
    this.shownKind = '';
    this.dismissed = false;
    this.hide();
  }
  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.panel.hidden = true;
    this.root.classList.remove('echo-clock-stage');
    if (this.rig) this.rig.root.visible = false;
  }
  input() {
    if (
      this.visible &&
      this.shownIntro &&
      !this.dismissed &&
      (this.g.input.keyPressed('Enter') || this.g.input.padButtonPressed(0))
    )
      this.dismissed = true;
  }
  draw(v: EncounterView | null, dt: number) {
    const g = this.g;
    if (
      !v ||
      g.stage !== v.stage ||
      g.mode !== 'fight' ||
      g.screens.current !== 'none' ||
      g.paused
    ) {
      this.hide();
      return;
    }
    const changed =
      this.shownKind !== v.kind || this.shownStage !== v.stage || this.shownAttempt !== v.attempt;
    if (changed) this.dismissed = false;
    const intro = v.intro && !this.dismissed,
      language = getLanguage();
    if (
      changed ||
      !this.visible ||
      this.shownIntro !== intro ||
      this.shownLanguage !== language ||
      this.shownHero !== v.hero ||
      this.shownWeapon !== v.weapon ||
      this.shownRank !== v.rank ||
      this.shownSeconds !== v.seconds
    ) {
      this.shownKind = v.kind;
      this.shownStage = v.stage;
      this.shownAttempt = v.attempt;
      this.shownIntro = intro;
      this.shownLanguage = language;
      this.shownHero = v.hero;
      this.shownWeapon = v.weapon;
      this.shownRank = v.rank;
      this.shownSeconds = v.seconds;
      this.panel.classList.toggle('echo-intro', intro);
      this.root.classList.toggle('echo-clock-stage', v.kind === 'clock');
      this.title.textContent = t(v.kind === 'echo' ? 'echo.name' : 'echo.time');
      const arm = (v.special ? SPECIALS : WEAPONS)[v.weapon];
      this.detail.textContent =
        v.kind === 'echo'
          ? t('echo.loadout', { weapon: localize(arm?.name ?? WEAPONS.buster.name), rank: v.rank })
          : t('echo.clock', { attempt: v.attempt, seconds: v.seconds });
      this.text.hidden = this.skip.hidden = !intro;
      if (intro) {
        this.text.textContent =
          v.kind === 'echo'
            ? t('echo.intro', {
                hero: localize(HERO_BY_ID[v.hero]?.name ?? HERO_BY_ID.rookie.name),
              })
            : t(v.attempt > 1 ? 'echo.rewind' : 'echo.brief');
        this.skip.innerHTML = prompt('confirm') + ' ' + t('echo.skip');
      }
    }
    if (!this.visible) {
      this.visible = true;
      this.panel.hidden = false;
    }
    if (this.bar.hidden !== (v.kind !== 'echo')) this.bar.hidden = v.kind !== 'echo';
    if (!this.bar.hidden && this.bar.value !== v.hp) this.bar.value = v.hp;
    if (!v.ghost) {
      if (this.rig) this.rig.root.visible = false;
      return;
    }
    if (!this.rig) {
      this.rig = createHero('#73eff7');
      this.rig.root.name = 'run-echo';
      g.scene.add(this.rig.root);
    }
    if (this.model !== v.hero) {
      setHeroModel(this.rig, v.hero);
      this.model = v.hero;
    }
    const root = this.rig.root;
    this.pose.dt = dt;
    this.pose.vx =
      root.visible && dt > 0 ? Math.max(-7, Math.min(7, (v.x - root.position.x) / dt)) : 0;
    this.pose.vz =
      root.visible && dt > 0 ? Math.max(-7, Math.min(7, (v.z - root.position.z) / dt)) : 0;
    this.pose.facing = v.facing;
    this.pose.dashing = v.dash;
    root.visible = true;
    root.position.set(v.x, 0.06, v.z);
    root.rotation.y = v.facing;
    root.scale.setScalar(v.kind === 'echo' ? 1.18 : 0.85);
    animateHero(this.rig, this.pose);
  }
}
