import type { Game } from '../game/game';
import { channelName, choices } from '../game/streamMode';
import { WorldGoals, type WorldGoal } from '../game/worldGoals';
import { getLanguage, localize, onLanguageChange, t } from '../i18n';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, parent: HTMLElement, cls = '') {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  parent.append(el);
  return el;
}

export class StreamUi {
  private panel: HTMLElement;
  private heading: HTMLElement;
  private list: HTMLElement;
  private hint: HTMLElement;
  private rows: HTMLElement[] = [];
  private votes: HTMLElement[] = [];
  private meter: HTMLElement;
  private progress: HTMLProgressElement;
  private caption: HTMLElement;
  private count: HTMLElement;
  private reward: HTMLElement;
  private flag: HTMLElement;
  private goal: WorldGoal | null = null;
  private goals = new WorldGoals((goal) => {
    this.goal = goal;
    this.drawGoal();
  });
  private display = '';
  private revision = -1;
  private second = -1;
  private help = false;
  private untilDraw = 0;

  constructor(
    private game: Game,
    root: HTMLElement,
  ) {
    const s = game.stream;
    injectCss();
    const settings = game.screens.settingsScreen.el;
    const panel = settings
      .querySelector<HTMLElement>('[data-setting=autoFire]')!
      .closest<HTMLElement>('[role=tabpanel]')!;
    const controls = document.createElement('section');
    controls.className = 'stream-settings';
    panel.querySelector('[data-advanced]')!.before(controls);
    const toggle = element('button', controls);
    toggle.dataset.nav = '';
    toggle.dataset.toggle = '';
    const label = element('label', controls);
    const channel = element('span', label);
    const input = element('input', label);
    input.type = 'text';
    input.dir = 'ltr';
    input.maxLength = 26;
    input.dataset.nav = '';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('translate', 'no');
    input.onkeydown = event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        toggle.focus();
      }
    };
    const desc = element('small', controls);
    const settingsText = () => {
      toggle.textContent = t('world.toggle') + ' · ' + localize(s.settings.enabled ? 'ON' : 'OFF');
      toggle.setAttribute('aria-pressed', String(s.settings.enabled));
      channel.textContent = t('world.channel');
      input.setAttribute('aria-label', t('world.channel'));
      input.value = s.settings.channel;
      desc.textContent = t('world.setup');
    };
    toggle.onclick = () => {
      s.configure({ enabled: !s.settings.enabled, channel: channelName(input.value) });
      settingsText();
      if (s.settings.enabled && !s.settings.channel) input.focus();
    };
    input.onchange = () => {
      const invalid = !!input.value.trim() && !channelName(input.value);
      s.configure({ ...s.settings, channel: channelName(input.value) });
      settingsText();
      if (invalid) desc.textContent = t('world.invalid');
    };
    settings.querySelector('[data-reset]')!.addEventListener('click', () => {
      if (!panel.hidden) {
        s.configure({ enabled: false, channel: '' });
        settingsText();
      }
    });
    settingsText();

    this.panel = element('aside', root.querySelector('#goals')!, 'stream-poll px');
    this.panel.hidden = true;
    this.heading = element('strong', this.panel);
    this.list = element('div', this.panel, 'stream-options');
    for (const _ of choices) {
      const row = element('div', this.list);
      this.rows.push(element('span', row));
      this.votes.push(element('bdi', row));
    }
    this.hint = element('small', this.panel);
    this.meter = element(
      'section',
      root.querySelector('#scr-title .menu-masthead')!,
      'community-goal px',
    );
    this.meter.hidden = true;
    this.caption = element('strong', this.meter);
    this.count = element('span', this.meter);
    this.progress = element('progress', this.meter);
    this.reward = element('small', this.meter);
    this.flag = element('i', root.querySelector('#timer')!, 'comet-pennant');
    this.flag.hidden = true;
    onLanguageChange(() => {
      settingsText();
      this.drawGoal();
      this.display = '';
    });
  }
  private drawGoal(): void {
    const g = this.goal;
    this.meter.hidden = !g;
    this.flag.hidden = !g?.unlocked;
    if (!g) return;
    this.caption.textContent = t('world.goal');
    const nf = new Intl.NumberFormat(getLanguage());
    this.count.textContent = t('world.count', {
      count: nf.format(g.total),
      target: nf.format(g.target),
    });
    this.progress.max = g.target;
    this.progress.value = g.total;
    this.progress.setAttribute('aria-label', this.count.textContent);
    this.reward.textContent = t(g.unlocked ? 'world.won' : 'world.reward');
    this.flag.setAttribute('role', 'img');
    this.flag.setAttribute('aria-label', t('world.flag'));
    this.flag.title = t('world.flag');
    this.meter.classList.toggle('won', g.unlocked);
  }
  tick(dt: number): void {
    const g = this.game,
      s = g.stream;
    this.goals.tick(g.screens.current === 'title', dt);
    if (s.status === 'off' && this.display === 'hidden') return;
    // Large channels can change the totals every frame. Coalesce DOM updates.
    if ((this.untilDraw -= dt) > 0) return;
    this.untilDraw = 0.25;
    const second = Math.ceil(s.ballot.seconds);
    const help = s.help > 0;
    const display =
      s.status === 'off' || g.screens.current !== 'none'
        ? 'hidden'
        : s.status !== 'live'
          ? s.status
          : second > 0
            ? 'poll'
            : s.resultTime > 0 && s.result
              ? s.result
              : help
                ? 'help'
                : 'hidden';
    if (
      display === this.display &&
      (display === 'hidden' ||
        (this.revision === s.ballot.revision && second === this.second && this.help === help))
    )
      return;
    this.display = display;
    this.second = second;
    this.revision = s.ballot.revision;
    this.help = help;
    this.panel.hidden = display === 'hidden';
    if (this.panel.hidden) return;
    this.list.hidden = display !== 'poll';
    this.hint.hidden = !help;
    this.hint.textContent = t('world.help');
    if (display === 'poll') {
      this.heading.textContent = t('world.ballot', { seconds: second });
      for (let i = 0; i < choices.length; i++) {
        this.rows[i].textContent = t('world.option', {
          number: i + 1,
          name: t('world.' + choices[i]),
        });
        this.votes[i].textContent = String(s.ballot.counts[i]);
      }
    } else if (display === 'help') {
      this.heading.textContent = t('world.toggle');
    } else
      this.heading.textContent = choices.some((c) => c === display)
        ? t('world.picked', { name: t('world.' + display) })
        : t('world.' + display);
  }
}

function injectCss(): void {
  if (document.getElementById('stream-css')) return;
  const css = element('style', document.head);
  css.id = 'stream-css';
  css.textContent = `
.stream-settings { display:grid; gap:calc(2 * var(--p)); text-align:start }
#hud #scr-settings .stream-settings label { display:flex; align-items:center; justify-content:space-between; gap:calc(3 * var(--p)) }
.stream-settings input { max-width:50%; font:inherit; color:var(--white); background:var(--ink); border:var(--p) solid var(--slate) }
.stream-settings small,.community-goal small,.stream-poll small { font:calc(5 * var(--p))/1.2 var(--font); color:var(--mist) }
.community-goal,.stream-poll { --bg:var(--ink); --hi:var(--teal); --lo:var(--navy); --ring:var(--ink); padding:calc(3 * var(--p)); text-align:start; color:var(--white) }
.community-goal[hidden],.stream-poll[hidden],.stream-poll [hidden],.comet-pennant[hidden] { display:none !important }
.community-goal { display:grid; gap:var(--p); margin-top:calc(3 * var(--p)); max-width:calc(118 * var(--p)); font:calc(6 * var(--p))/1.12 var(--font) }
.community-goal strong,.stream-poll strong { color:var(--cyan); font:calc(5 * var(--p))/1.25 var(--label) }
.community-goal progress { appearance:none; width:100%; height:calc(2 * var(--p)); border:0; background:var(--navy); color:var(--lime) }
.community-goal progress::-webkit-progress-bar { background:var(--navy) }
.community-goal progress::-webkit-progress-value { background:var(--lime) }
.community-goal progress::-moz-progress-bar { background:var(--lime) }
.community-goal.won { --hi:var(--yellow) }
.comet-pennant,.community-goal.won strong::before { content:''; display:inline-block; vertical-align:middle; width:calc(9 * var(--p)); height:calc(7 * var(--p)); background:var(--yellow); clip-path:polygon(0 0,100% 0,100% 22%,77% 22%,77% 44%,53% 44%,53% 65%,15% 65%,15% 100%,0 100%) }
.community-goal.won strong::before { margin-inline-end:calc(2 * var(--p)) }
#timer .comet-pennant { position:absolute; inset-inline-end:calc(-11 * var(--p)); top:0 }
.stream-poll { max-width:100%; min-width:min(calc(55 * var(--p)),100%); font:calc(6 * var(--p))/1.2 var(--font) }
.stream-options { margin-top:var(--p) }
.stream-options > div { display:flex; justify-content:space-between; gap:calc(3 * var(--p)) }
.stream-options bdi { color:var(--yellow) }
.stream-poll small { display:block; max-width:calc(72 * var(--p)) }`;
}
