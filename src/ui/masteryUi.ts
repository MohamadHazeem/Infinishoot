import type { Game } from '../game/game';
import { keepCabinet, normalCabinet, type EventMode, type Mastery } from '../game/mastery';
import { emptyMarks, rank, tracks } from '../data/mastery';
import { clockText, currentWeek, speedBest, speedSeed, type SpeedAttempt } from '../game/speedrun';
import { hardcoreProfile, keepLife, localHardcoreBoard, type BoardRow } from '../game/hardcore';
import { localize, onLanguageChange, t } from '../i18n';
import { onlineServer } from '../net/onlineServer';
import { HEROES } from '../data/heroes';
import { SKINS } from '../data/skins';
import { heroLook, portraitCanvas } from './portraitArt';
import { iconHtml } from './pixelIcons';
import { prompt } from './prompts';

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );
const btn = (action: string, label: string, on = false) =>
  '<button data-nav data-mx="' +
  esc(action) +
  '"' +
  (on ? ' aria-pressed="true"' : '') +
  '>' +
  label +
  '</button>';
const splitName = (i: number) => t(i % 2 ? 'mx.boss' : 'mx.stage', { n: 1 + Math.floor(i / 2) });
type Result = {
  mode: EventMode;
  wiped: boolean;
  won: boolean;
  row: BoardRow;
  valid: boolean;
  attempt: SpeedAttempt | null;
};
export class MasteryUi {
  private el = document.createElement('div');
  private hud = document.createElement('div');
  private tab: 'tracks' | EventMode = 'tracks';
  private category = 'h.';
  private selected = 'h.rookie';
  private hc = false;
  private pilot = 0;
  private confirm = false;
  private result: Result | null = null;
  private post = '';
  private request = 0;
  private clockTick = -1;
  private lastSplit = -1;
  constructor(
    private g: Game,
    private lane: Mastery,
    root: HTMLElement,
  ) {
    this.el.id = 'scr-mastery';
    this.el.className = 'screen dim';
    this.el.onclick = (e) => {
      const action = (e.target as Element).closest<HTMLElement>('[data-mx]')?.dataset.mx;
      if (action) this.act(action);
    };
    g.screens.addScreen('mastery', this.el, { onBack: () => this.back() });
    const entry = document.createElement('button');
    entry.dataset.nav = '';
    entry.onclick = () => {
      this.confirm = false;
      this.tab = 'tracks';
      this.result = null;
      g.screens.show('mastery');
    };
    root.querySelector('#scr-extras [data-act=ex-back]')?.before(entry);
    // Use the existing timer's reserved top-centre position and its menu visibility rules.
    this.hud.className = 'mx-clock';
    this.hud.hidden = true;
    root.querySelector('#timer')?.append(this.hud);
    const show = g.screens.onShow;
    g.screens.onShow = (name) => {
      show?.(name);
      if (name === 'mastery') this.draw();
    };
    const language = () => {
      entry.textContent = t('mx.menu');
      if (g.screens.current === 'mastery') {
        this.draw();
        g.screens.refreshNav();
      }
      this.clockTick = -1;
      if (!this.hud.hidden && this.lane.mode === 'hardcore') this.hud.textContent = t('mx.life');
    };
    onLanguageChange(language);
    language();
    if (!document.getElementById('mx-style')) {
      const style = document.createElement('style');
      style.id = 'mx-style';
      style.textContent = css;
      document.head.append(style);
    }
  }
  preview(tab: string | null) {
    this.tab =
      tab === 'speedrun' || tab === 'hardcore' || tab === 'warning'
        ? tab === 'speedrun'
          ? 'speedrun'
          : 'hardcore'
        : 'tracks';
    this.confirm = tab === 'warning';
  }
  private back() {
    if (this.result) {
      this.result = null;
      this.g.leaveToTitle();
      this.g.screens.show('mastery');
    } else if (this.confirm) {
      this.confirm = false;
      this.draw();
      this.g.screens.refreshNav();
    } else this.g.screens.show('extras');
  }
  private act(action: string) {
    const focus = this.g.screens.nav('mastery').focus;
    if (action === 'back' || action === 'cancel') return this.back();
    if (action === 'confirm' || action === 'race')
      return this.lane.start(action === 'race' ? 'speedrun' : 'hardcore', HEROES[this.pilot].id);
    if (action === 'board') {
      void this.board();
      return;
    }
    if (action === 'tracks' || action === 'speedrun' || action === 'hardcore') {
      this.tab = action;
      this.confirm = false;
      this.result = null;
    } else if (action === 'pilot') this.pilot = (this.pilot + 1) % HEROES.length;
    else if (action === 'warn') this.confirm = true;
    else if (action === 'cabinet') {
      this.hc = !this.hc;
    } else if (action === 'hardTracks') {
      this.hc = true;
      this.tab = 'tracks';
    } else if (action === 'heroes' || action === 'weapons') {
      this.category = action === 'heroes' ? 'h.' : 'w.';
      this.selected = tracks().find((x) => x.id.startsWith(this.category))!.id;
    } else if (action === 'prev' || action === 'next') {
      const items = tracks().filter((x) => x.id.startsWith(this.category));
      const i = items.findIndex((x) => x.id === this.selected);
      this.selected = items[(i + items.length + (action === 'next' ? 1 : -1)) % items.length].id;
    } else if (action === 'title' || action === 'skin') {
      const life = this.hc ? hardcoreProfile() : null;
      const c = life?.cabinet ?? normalCabinet();
      if (rank(c.tracks[this.selected]) >= (action === 'skin' ? 2 : 1)) {
        c[action] = c[action] === this.selected ? '' : this.selected;
        if (life) keepLife(life);
        else keepCabinet(c);
      }
    }
    this.draw();
    this.g.screens.refreshNav(this.confirm ? 0 : focus);
  }
  private draw() {
    this.request++;
    let body: string;
    let title = t('mx.menu');
    if (this.result) {
      const r = this.result;
      title = t(
        r.mode === 'hardcore'
          ? r.wiped
            ? 'mx.lost'
            : 'mx.retired'
          : r.won
            ? 'mx.finished'
            : 'mx.stopped',
      );
      body =
        '<p>' +
        t('mx.result', { stage: r.row.stage, score: r.row.score, time: clockText(r.row.ms) }) +
        '</p>' +
        (r.mode === 'hardcore' ? '<p>' + t(r.wiped ? 'mx.wiped' : 'mx.banked') + '</p>' : '') +
        (r.valid ? '' : '<p>' + t('mx.practice') + '</p>') +
        this.splits(r.attempt?.splits.map((s) => s.ms) ?? []) +
        '<p role="status">' +
        (this.post ? t(this.post) : '') +
        '</p>';
    } else if (this.confirm) {
      title = t('mx.warning');
      body =
        '<p>' +
        t('mx.hardRule') +
        '</p><div class="menu row">' +
        btn('cancel', t('mx.cancel')) +
        btn('confirm', t('mx.confirm')) +
        '</div>';
    } else if (this.tab === 'tracks') body = this.gallery();
    else {
      const speed = this.tab === 'speedrun',
        week = currentWeek(),
        best = speed && speedBest(week);
      body =
        '<p>' +
        t(speed ? 'mx.speedRule' : 'mx.hardRule') +
        '</p>' +
        (speed ? '<p>' + t('mx.week', { week, seed: speedSeed(week) }) + '</p>' : '') +
        '<div class="menu row">' +
        (!speed
          ? btn('pilot', t('mx.pilot', { name: esc(localize(HEROES[this.pilot].name)) }))
          : '') +
        btn(speed ? 'race' : 'warn', t(speed ? 'mx.startSpeed' : 'mx.startHard')) +
        (!speed ? btn('hardTracks', t('mx.hardCollection')) : '') +
        '</div><p class="mx-minor">' +
        t('mx.localHint') +
        '</p>' +
        '<h2>' +
        t('mx.local') +
        '</h2>' +
        (speed
          ? best
            ? '<p>' + t('mx.best', { time: clockText(best.ms) }) + '</p>' + this.splits(best.splits)
            : '<p>' + t('mx.empty') + '</p>'
          : this.rows(localHardcoreBoard())) +
        (onlineServer
          ? '<div class="menu row">' +
            btn('board', t(speed ? 'mx.verified' : 'mx.global')) +
            '</div><div data-board role="status"></div>'
          : '');
    }
    const tabs =
      this.result || this.confirm
        ? ''
        : '<div class="menu row mx-tabs">' +
          (['tracks', 'hardcore', 'speedrun'] as const)
            .map((a) => btn(a, t(a === 'tracks' ? 'mx.tracks' : 'mx.' + a), this.tab === a))
            .join('') +
          '</div>';
    this.el.setAttribute('aria-label', title);
    this.el.innerHTML =
      '<h1>' +
      title +
      '</h1>' +
      tabs +
      '<div class="mx-sheet px">' +
      body +
      '</div>' +
      (this.confirm
        ? ''
        : '<div class="menu row">' +
          btn('back', prompt('back') + ' ' + t(this.result ? 'mx.return' : 'mx.back')) +
          '</div>');
  }
  private gallery() {
    const all = tracks(),
      track = all.find((x) => x.id === this.selected) ?? all[0];
    const cabinet = this.hc ? hardcoreProfile().cabinet : normalCabinet();
    const m = cabinet.tracks[track.id] ?? emptyMarks(),
      tier = rank(m),
      name = esc(localize(track.name));
    const group = all.filter((x) => x.id.startsWith(this.category));
    const icon =
      this.category === 'h.'
        ? '<img alt="" src="' +
          portraitCanvas(heroLook(track.icon, SKINS[0]), 'determined').toDataURL() +
          '">'
        : iconHtml(track.icon, track.color, '★');
    const reward = (kind: 'title' | 'skin', open: boolean) =>
      open
        ? btn(
            kind,
            t(
              cabinet[kind] === track.id
                ? 'mx.takeOff'
                : kind === 'title'
                  ? 'mx.wearTitle'
                  : 'mx.wearSkin',
            ),
          )
        : '';
    return (
      '<div class="menu row mx-filters">' +
      btn('cabinet', t(this.hc ? 'mx.hardCollection' : 'mx.normal')) +
      btn('heroes', t('mx.heroes'), this.category === 'h.') +
      btn('weapons', t('mx.weapons'), this.category === 'w.') +
      '</div>' +
      '<div class="mx-identity menu row">' +
      btn('prev', t('mx.prev')) +
      '<div>' +
      icon +
      '<strong>' +
      name +
      '</strong><small>' +
      t('mx.rank', { n: tier }) +
      ' · ' +
      (group.findIndex((x) => x.id === track.id) + 1) +
      ' / ' +
      group.length +
      '</small></div>' +
      btn('next', t('mx.next')) +
      '</div><div class="mx-goals">' +
      '<section><h2>' +
      t('mx.title', { name }) +
      '</h2><p>' +
      t('mx.goal1') +
      '</p>' +
      '<meter min="0" max="500" value="' +
      m.kills +
      '"></meter><p>' +
      t('mx.kills', { n: m.kills }) +
      '</p><p>' +
      t('mx.clears', { n: m.clears }) +
      '</p>' +
      reward('title', tier >= 1) +
      '</section>' +
      '<section><h2>' +
      t('mx.skin', { name }) +
      '</h2><p>' +
      t('mx.goal2') +
      '</p><p>' +
      (m.flawless ? '★' : '☆') +
      ' ' +
      t('mx.flawless') +
      '</p><p>' +
      (m.early ? '★' : '☆') +
      ' ' +
      t('mx.early') +
      '</p>' +
      reward('skin', tier >= 2) +
      '</section></div>' +
      (cabinet.title
        ? '<p>' +
          t('mx.pinned', {
            name: t('mx.title', {
              name: esc(localize(all.find((x) => x.id === cabinet.title)!.name)),
            }),
          }) +
          '</p>'
        : '')
    );
  }
  private splits(ms: number[]) {
    return ms.length
      ? '<ol class="mx-splits">' +
          ms
            .map((n, i) => '<li>' + splitName(i) + ' <bdi>' + clockText(n) + '</bdi></li>')
            .join('') +
          '</ol>'
      : '';
  }
  private rows(rows: BoardRow[]) {
    return rows.length
      ? '<ol class="mx-board">' +
          rows
            .slice(0, 10)
            .map(
              (r) =>
                '<li><bdi>#' +
                esc(r.id.slice(0, 8)) +
                '</bdi> · ' +
                (this.tab === 'speedrun'
                  ? clockText(r.ms)
                  : t('mx.result', { stage: r.stage, score: r.score, time: clockText(r.ms) })) +
                '</li>',
            )
            .join('') +
          '</ol>'
      : '<p>' + t('mx.empty') + '</p>';
  }
  private async board() {
    const el = this.el.querySelector<HTMLElement>('[data-board]');
    if (!el || !onlineServer) return;
    const serial = ++this.request;
    el.textContent = t('mx.loading');
    try {
      const r = await fetch(onlineServer + '/' + this.tab, {
        credentials: 'omit',
        signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) throw Error();
      const { rows } = (await r.json()) as { rows: BoardRow[] };
      if (serial === this.request)
        el.innerHTML = this.rows(
          rows.filter(
            (r) => typeof r.id === 'string' && [r.score, r.ms, r.stage].every(Number.isSafeInteger),
          ),
        );
    } catch {
      if (serial === this.request) el.textContent = t('mx.unavailable');
    }
  }
  begin(mode: EventMode) {
    this.result = null;
    this.post = '';
    this.clockTick = this.lastSplit = -1;
    this.hud.hidden = false;
    this.hud.textContent = t(mode === 'hardcore' ? 'mx.life' : 'mx.speedrun');
  }
  tick(g: Game, speed: SpeedAttempt | null) {
    if (!speed) return;
    const ms = Math.floor(speed.clock * 1000),
      deci = Math.floor(ms / 100),
      count = speed.splits.length;
    if (deci === this.clockTick && this.lastSplit === count) return;
    this.clockTick = deci;
    this.lastSplit = count;
    let text = t('mx.timer', { time: clockText(ms) });
    if (count) {
      const split = speed.splits[count - 1];
      text += ' · ' + splitName(count - 1) + ' ' + clockText(split.ms);
      if (speed.best) {
        const delta = split.ms - speed.best.splits[count - 1];
        text += ' · ' + (delta < 0 ? '−' : '+') + clockText(Math.abs(delta));
      }
    }
    this.hud.textContent = text;
    this.hud.hidden = !g.isCombatMode;
  }
  showTitle(id: string) {
    const track = tracks().find((x) => x.id === id);
    if (track)
      this.g.hud.toast(t('mx.pinned', { name: t('mx.title', { name: localize(track.name) }) }), 3);
  }
  submission(promise: Promise<boolean>) {
    this.post = 'mx.sending';
    const mode = this.lane.mode,
      round = this.lane.life ?? this.lane.speed;
    void promise
      .catch(() => false)
      .then((ok) => {
        if (round !== (this.lane.life ?? this.lane.speed)) return;
        this.post = ok ? (mode === 'hardcore' ? 'mx.posted' : 'mx.submitted') : 'mx.notPosted';
        if (this.result && this.g.screens.current === 'mastery') {
          this.draw();
          this.g.screens.refreshNav();
        }
      });
  }
  finish(
    mode: EventMode,
    wiped: boolean,
    won: boolean,
    valid: boolean,
    row: BoardRow,
    attempt: SpeedAttempt | null,
  ) {
    this.hud.hidden = true;
    this.confirm = false;
    this.tab = mode;
    this.result = { mode, wiped, won, row, valid, attempt };
    this.g.screens.show('mastery');
  }
  hide() {
    this.hud.hidden = true;
    this.confirm = false;
  }
}
const css = `
#scr-mastery {gap:calc(3 * var(--p)); padding:calc(5 * var(--p)); overflow:auto; justify-content:safe center}
#scr-mastery h1 {margin:0;color:var(--yellow);font:calc(15 * var(--p))/1.1 var(--display)}
#scr-mastery .menu {margin:0;flex-wrap:wrap;justify-content:center}
#scr-mastery button {min-height:calc(12 * var(--p));font-size:calc(7 * var(--p))}
#scr-mastery [aria-pressed=true] {color:var(--yellow);--hi:var(--yellow)}
.mx-sheet {--bg:var(--night);--hi:var(--sky);--lo:var(--navy);width:min(92vw,calc(240 * var(--p)));box-sizing:border-box;padding:calc(5 * var(--p));overflow:auto;max-height:64vh;font:calc(7 * var(--p))/1.25 var(--font);text-align:center;color:var(--white)}
.mx-sheet p {margin:calc(2 * var(--p)) 0}
.mx-sheet h2 {color:var(--cyan);font:calc(8 * var(--p))/1.2 var(--display);margin:calc(3 * var(--p)) 0}
.mx-sheet .mx-minor,.mx-sheet small {color:var(--mist);font-size:calc(5 * var(--p))}
#scr-mastery .mx-identity {align-items:center;justify-content:center;gap:calc(5 * var(--p));margin:calc(4 * var(--p)) 0}
.mx-identity>div {display:grid;justify-items:center;min-width:calc(48 * var(--p))}
.mx-identity strong {color:var(--yellow);font:calc(12 * var(--p))/1.1 var(--display)}
.mx-identity img {width:calc(12 * var(--p));height:calc(12 * var(--p));image-rendering:pixelated}
.mx-goals {display:grid;grid-template-columns:1fr 1fr;gap:calc(3 * var(--p));text-align:start}
.mx-goals section {padding:calc(3 * var(--p));background:var(--ink);border-block-start:var(--p) solid var(--blue)}
.mx-goals meter {width:100%;height:calc(2 * var(--p));appearance:none;background:var(--slate)}
.mx-goals meter::-webkit-meter-bar {background:var(--slate);border:0;border-radius:0}
.mx-goals meter::-webkit-meter-optimum-value {background:var(--lime)}
.mx-board,.mx-splits {text-align:start;margin:calc(3 * var(--p));padding-inline-start:calc(10 * var(--p))}
.mx-splits {display:grid;grid-template-columns:1fr 1fr;gap:var(--p);list-style:none;padding:0}
.mx-splits li {display:flex;justify-content:space-between;background:var(--ink);padding:var(--p) calc(3 * var(--p))}
#timer:has(.mx-clock:not([hidden])) .stage,.mx-clock:not([hidden]) {display:inline-block}
.mx-clock {margin-inline-start:calc(3 * var(--p));font:calc(5 * var(--p))/1.15 var(--font);color:var(--yellow);white-space:nowrap}
@media(max-width:600px){.mx-goals{grid-template-columns:1fr}.mx-sheet{max-height:58vh}}
@media(max-height:450px){
  #scr-mastery:has(.mx-splits){padding-block:var(--p);gap:var(--p)}
  #scr-mastery:has(.mx-splits) h1{font-size:calc(11 * var(--p))}
  #scr-mastery:has(.mx-splits) .mx-sheet{padding:calc(2 * var(--p))}
  #scr-mastery:has(.mx-splits) button{padding-block:var(--p)}
}
`;
