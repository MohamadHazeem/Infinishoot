import type { Game } from '../game/game';
import { ENEMIES } from '../data/enemies';
import { savedArenas } from '../editor/store';
import { SAMPLE_IDS } from '../editor/samples';
import { arenaCode } from '../editor/codec';
import { MapView } from '../editor/mapView';
import { t, localize, onLanguageChange, escapeHtml } from '../i18n';
import { prompt } from './prompts';
import { onlineServer } from '../net/onlineServer';
import {
  ballotId,
  bossList,
  boardRequest,
  keepDesign,
  removeDesign,
  localDesigns,
  type BoardRow,
} from '../game/bossMaker';
import {
  bodies,
  moves,
  sampleBoss,
  decodeBoss,
  encodeBoss,
  layoutOnly,
  resolveLayout,
  tellTime,
  maxBossCode,
} from '../game/bossMakerCode';

const style = `
#scr-bossmaker { background:var(--ink); gap:calc(3 * var(--p)); overflow:auto; justify-content:safe center; padding:calc(5 * var(--p)); }
#scr-bossmaker h1,#scr-bossmaker h2,#scr-bossmaker p {margin:0}
#scr-bossmaker h1{color:var(--yellow);font-size:calc(18 * var(--p))}
#scr-bossmaker h2 {color:var(--cyan);font:calc(6 * var(--p)) var(--label)}
#scr-bossmaker button {font-size:calc(7 * var(--p));padding:calc(2 * var(--p)) calc(4 * var(--p));min-width:0}
#scr-bossmaker .bm-row {display:flex;align-items:center;justify-content:center;gap:calc(3 * var(--p));flex-wrap:wrap}
#scr-bossmaker [aria-pressed=true],#scr-bossmaker .bm-test {--bg:var(--navy);--hi:var(--cyan);color:var(--yellow)}
#scr-bossmaker .bm-sheet {display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:calc(7 * var(--p));width:min(96%,calc(275 * var(--p)));align-items:start}
#scr-bossmaker .bm-panel {--bg:var(--night);--hi:var(--slate);--lo:var(--ink);background:var(--bg);padding:calc(5 * var(--p));display:grid;gap:calc(3 * var(--p));min-width:0;text-align:start}
#scr-bossmaker .ae-map {width:100%;max-height:calc(52 * var(--p));object-fit:contain;image-rendering:pixelated}
#scr-bossmaker .bm-seq {display:grid;gap:calc(2 * var(--p))}
#scr-bossmaker .bm-cue {display:grid;grid-template-columns:1.5fr 1.1fr auto;gap:calc(2 * var(--p))}
#scr-bossmaker .bm-note {font:calc(6 * var(--p)) var(--font);color:var(--mist);line-height:1.2}
#scr-bossmaker .bm-list {max-height:45vh;overflow:auto;min-width:min(85vw,calc(145 * var(--p)));display:grid;gap:calc(3 * var(--p));padding:calc(3 * var(--p))}
#scr-bossmaker .bm-msg {min-height:1.25em;color:var(--yellow);font-size:calc(7 * var(--p))}
#scr-bossmaker .bm-msg:empty{display:none}
#scr-bossmaker input {min-width:0;width:min(80vw,calc(96 * var(--p)));font:calc(6 * var(--p)) var(--font);color:var(--white);background:var(--night)}
@media(max-width:660px){#scr-bossmaker .bm-sheet{grid-template-columns:1fr}#scr-bossmaker .ae-map{display:none}}
@media(max-height:560px){#scr-bossmaker h1{font-size:calc(12 * var(--p))}#scr-bossmaker .ae-map{max-height:calc(28 * var(--p))}}
`;
const label = (key: string) => t('maker.' + key);
const button = (act: string, text: string, extra = '') =>
  `<button data-nav data-bm="${act}" ${extra}>${text}</button>`;
const pressed = (on: boolean) => `aria-pressed="${on}"`;

export class BossMakerUi {
  private el = document.createElement('div');
  private design = sampleBoss();
  private phase = 0;
  private tab: 'edit' | 'library' | 'board' = 'edit';
  private map?: MapView;
  private arenas: { key: string; name: string }[] = [];
  private codes: string[] = [];
  private rows: BoardRow[] = [];
  private selectedId = '';
  private page = 0;
  private stars = 5;
  private saved = '';
  private message = '';
  private pending = false;
  private generation = 0;
  constructor(
    private g: Game,
    root: HTMLElement,
  ) {
    if (!document.getElementById('bossmaker-css')) {
      const css = document.createElement('style');
      css.id = 'bossmaker-css';
      css.textContent = style;
      document.head.append(css);
    }
    this.el.id = 'scr-bossmaker';
    this.el.className = 'screen dim';
    g.screens.addScreen('bossmaker', this.el, {
      columns: 3,
      onBack: () => g.screens.show('extras'),
    });
    const launch = document.createElement('button');
    launch.dataset.nav = '';
    launch.dataset.act = 'boss-maker';
    launch.textContent = label('title');
    root.querySelector('#scr-extras [data-act=ex-back]')?.before(launch);
    launch.onclick = () => this.open();
    this.el.onclick = (event) => {
      const b = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-bm]');
      if (b && !b.disabled) void this.act(b.dataset.bm!);
    };
    onLanguageChange(() => {
      launch.textContent = label('title');
      if (g.screens.current === 'bossmaker') this.draw();
    });
    g.bossMaker.onReturn = (won) => {
      this.message = won ? 'victory' : 'retry';
      this.open();
    };
  }
  open(): void {
    this.arenas = SAMPLE_IDS.map((_, i) => ({ key: String(i), name: label('arena' + i) }));
    for (const { arena } of savedArenas()) {
      const key = arenaCode(layoutOnly(arena));
      try {
        resolveLayout(key);
      } catch {
        continue;
      }
      if (!this.arenas.some((a) => a.key === key)) this.arenas.push({ key, name: arena.name });
    }
    this.draw();
    this.g.screens.show('bossmaker');
  }
  preview(view: string): void {
    this.g.leaveToTitle();
    this.open();
    if (view === 'fight') this.g.bossMaker.test(this.g, this.design);
    if (view === 'route') {
      this.g.startRun({ seed: 42, difficulty: 'normal' });
      this.g.closeShop();
      this.g.mode = 'shop';
      this.g.openRoute();
      this.g.bossMaker.offer = {
        code: encodeBoss(this.design),
        design: this.design,
        stage: 2,
        arena: resolveLayout(this.design.arena),
      };
      this.g.routeShow();
    }
  }
  private draw(): void {
    const tabs = ['edit', 'library', ...(onlineServer ? ['board'] : [])]
      .map((k) => button(k, label(k), pressed(this.tab === k)))
      .join('');
    const content = this.tab === 'edit' ? this.editor() : this.list();
    this.el.innerHTML = `<h1>${label('title')}</h1><div class="bm-row">${tabs}</div>${content}
      <p class="bm-msg" role="status">${this.message ? label(this.message) : ''}</p>
      <div class="bm-row">${button('back', prompt('back') + ' ' + localize('BACK'))}</div>`;
    const field = this.el.querySelector<HTMLInputElement>('input');
    if (field)
      field.onclick = () => {
        field.focus();
        field.select();
      };
    const holder = this.el.querySelector('.bm-map');
    if (holder) {
      const arena = resolveLayout(this.design.arena);
      this.map ??= new MapView();
      this.map.grid = false;
      holder.append(this.map.canvas);
      this.map.fit(arena, 230);
      this.map.draw(arena, null, null, 0);
    }
    if (this.g.screens.current === 'bossmaker') this.g.screens.refreshNav();
  }
  private editor(): string {
    const d = this.design,
      cues = d.phases[this.phase];
    const arena = this.arenas.find((a) => a.key === d.arena);
    const header = (key: string) => '<h2>' + label(key) + '</h2>';
    return `<div class="bm-sheet"><section class="bm-panel px">${header('body')}
      ${button('body', escapeHtml(localize(ENEMIES[d.body].name)) + ' ↻')}${header('arena')}<div class="bm-map"></div>
      ${button('arena', '<bdi>' + escapeHtml(/^[012]$/.test(d.arena) ? label('arena' + d.arena) : (arena?.name ?? label('custom'))) + '</bdi> ↻')}</section>
      <section class="bm-panel px">${header('script')}
      <div class="bm-row">${d.phases.map((_, i) => button('phase' + i, t('maker.phase', { n: i + 1 }), pressed(i === this.phase))).join('')}</div>
      <p class="bm-note">${label('help')}</p><div class="bm-seq">${cues
        .map(
          (c, i) =>
            `<div class="bm-cue">${button('move' + i, i + 1 + ' · ' + label(c.move))}${button('time' + i, t('maker.tell', { n: Number(tellTime(c).toFixed(2)) }))}
        ${button('del' + i, '×', `aria-label="${t('maker.del', { n: i + 1 })}" ${cues.length === 1 ? 'disabled' : ''}`)}</div>`,
        )
        .join('')}</div>
      ${button('add', label('add'), cues.length >= 4 ? 'disabled' : '')}
      <div class="bm-row">${button('test', label('test'), 'class="bm-test"')}${button('save', label('save'))}</div></section></div>
      <div class="bm-row"><label>${label('share')} <input type="text" data-nav dir="ltr" translate="no" maxlength="${maxBossCode}" value="${encodeBoss(d)}"></label>
      ${button('copy', label('copy'))}${button('import', label('import'))}${onlineServer ? button('publish', label('publish'), this.pending ? 'disabled' : '') : ''}</div>`;
  }
  private list(): string {
    this.codes = this.tab === 'library' ? localDesigns() : this.rows.map((r) => r.code);
    const items = this.codes
      .map((code, i) => {
        const d = decodeBoss(code)!,
          r = this.rows[i],
          own = this.tab === 'library';
        const name = escapeHtml(localize(ENEMIES[d.body].name));
        const rating = !own ? t('maker.rating', { stars: r.rating, n: r.votes }) : '';
        return `<div class="bm-panel px"><div class="bm-row"><b>${name} · <bdi>${code.split('~')[1]}</bdi></b>${rating}</div>
        <div class="bm-row">${button('load' + i, label('use'))}${
          own
            ? button('remove' + i, label('remove'))
            : button(
                'stars' + i,
                t('maker.vote', { n: this.selectedId === r.id ? this.stars : 5 }),
              ) + button('vote' + i, label('rate'), this.pending ? 'disabled' : '')
        }</div></div>`;
      })
      .join('');
    return `<div class="bm-list">${items || (this.pending ? label('wait') : label(this.tab === 'library' ? 'empty' : 'emptyBoard'))}</div>
      ${this.tab === 'library' ? button('new', label('new')) : `<div class="bm-row">${this.page ? button('prev', label('prev')) : ''}${this.rows.length === 30 ? button('next', label('next')) : ''}</div>`}`;
  }
  private async act(act: string): Promise<void> {
    const g = this.g,
      d = this.design,
      cues = d.phases[this.phase];
    const i = Number(act.match(/\d+$/)?.[0] ?? 0);
    const field = this.el.querySelector<HTMLInputElement>('input');
    this.message = '';
    if (act === 'back') {
      g.screens.show('extras');
      return;
    }
    if (act === 'test') {
      g.bossMaker.test(g, d);
      return;
    }
    if (act === 'copy') {
      const code = encodeBoss(d);
      if (field) field.value = code;
      try {
        await navigator.clipboard.writeText(code);
        this.message = 'copied';
      } catch {
        field?.focus();
        field?.select();
        this.el.querySelector('.bm-msg')!.textContent = label('manual');
        return;
      }
    } else if (act === 'import' || act.startsWith('load')) {
      const own = act !== 'import' && this.tab === 'library';
      const code = act === 'import' ? field?.value.trim() : this.codes[i];
      const next = decodeBoss(code);
      if (next && code) {
        this.design = next;
        this.phase = 0;
        this.tab = 'edit';
        this.saved = own ? code : '';
      } else this.message = 'invalid';
    } else if (act === 'save') {
      const code = encodeBoss(d);
      if (keepDesign(code, this.saved)) {
        this.saved = code;
        this.message = 'saved';
      } else this.message = 'full';
    } else if (act.startsWith('remove')) {
      removeDesign(this.codes[i]);
      if (this.saved === this.codes[i]) this.saved = '';
    } else if (act === 'new') {
      this.design = sampleBoss();
      this.phase = 0;
      this.tab = 'edit';
      this.saved = '';
    } else if (act === 'edit' || act === 'library') {
      this.tab = act;
      this.generation++;
      this.pending = false;
    } else if (
      act === 'board' ||
      act === 'prev' ||
      act === 'next' ||
      act === 'publish' ||
      act.startsWith('vote')
    ) {
      if (this.pending) return;
      const generation = ++this.generation;
      this.pending = true;
      if (act === 'board') this.tab = 'board';
      const page =
        act === 'prev'
          ? Math.max(0, this.page - 1)
          : act === 'next'
            ? this.page + 1
            : act === 'board'
              ? 0
              : this.page;
      this.draw();
      try {
        if (act === 'publish') {
          await boardRequest('/bosses', { code: encodeBoss(d) });
          if (generation === this.generation) this.message = 'sent';
        } else {
          if (act.startsWith('vote')) {
            const id = this.rows[i].id;
            await boardRequest('/bosses/rate', {
              id,
              ballot: ballotId(),
              stars: id === this.selectedId ? this.stars : 5,
            });
          }
          const rows = await bossList(false, page);
          if (generation === this.generation) {
            this.page = page;
            this.rows = rows;
            if (act.startsWith('vote')) this.message = 'rated';
          }
        }
      } catch (e) {
        if (generation === this.generation)
          this.message = e instanceof Error && e.message === '429' ? 'slow' : 'offline';
      }
      if (generation !== this.generation) return;
      this.pending = false;
    } else if (act.startsWith('stars')) {
      const id = this.rows[i].id;
      this.stars = ((id === this.selectedId ? this.stars : 5) % 5) + 1;
      this.selectedId = id;
    } else if (act === 'body') d.body = bodies[(bodies.indexOf(d.body) + 1) % bodies.length];
    else if (act === 'arena')
      d.arena =
        this.arenas[(this.arenas.findIndex((a) => a.key === d.arena) + 1) % this.arenas.length].key;
    else if (act.startsWith('phase')) this.phase = i;
    else if (act.startsWith('move'))
      cues[i].move = moves[(moves.indexOf(cues[i].move) + 1) % moves.length];
    else if (act.startsWith('time')) cues[i].tempo = (cues[i].tempo + 1) % 3;
    else if (act.startsWith('del') && cues.length > 1) cues.splice(i, 1);
    else if (act === 'add' && cues.length < 4) cues.push({ move: 'ring', tempo: 1 });
    this.draw();
  }
}
