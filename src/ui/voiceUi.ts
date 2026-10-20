import type { Game } from '../game/game';
import { settings, saveSettings } from '../game/settings';
import { voice, vadThreshold, type VoiceRosterEntry } from '../net/voice';
import { MenuNav } from './menu';
import { promptHtml } from './prompts';
import { t, localize, localizeHtml } from '../i18n';

/**
 * Voice chat UI (voicechat lane): speaking icons on lobby cards, the co-op
 * teammate list and floating name tags; a mic chip for this player; and the
 * VOICE CHAT screen (SETTINGS > CO-OP > VOICE PLAYERS & MIC TEST) with the mic
 * level meter, the open-mic threshold, a loopback mic test, and per-player
 * volume and mute. Indicators are refreshed 10 times a second by toggling
 * classes on a small icon element, so other lanes' markup stays untouched.
 */

type IconState = 'off' | 'on' | 'talk' | 'mute';

/** 9x8 pixel speaker; waves only when talking, a red cross when muted. */
function iconSvg(state: Exclude<IconState, 'off'>): string {
  const body = state === 'talk' ? '#a7f070' : state === 'mute' ? '#94b0c2' : '#566c86';
  const rows = ['...#.....', '..##.....', '####.....', '####.....', '####.....', '####.....', '..##.....', '...#.....'];
  let r = '';
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '#') r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${body}"/>`;
  }));
  if (state === 'talk') for (const [x, y0, y1] of [[5, 2, 5], [7, 1, 6]] as const) r += `<rect x="${x}" y="${y0}" width="1" height="${y1 - y0 + 1}" fill="#a7f070"/>`;
  if (state === 'mute') for (let i = 0; i < 4; i++) r += `<rect x="${5 + i}" y="${2 + i}" width="1" height="1" fill="#b13e53"/><rect x="${8 - i}" y="${2 + i}" width="1" height="1" fill="#b13e53"/>`;
  return `<svg viewBox="0 0 9 8" width="18" height="16" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
}

const ICONS: Record<Exclude<IconState, 'off'>, string> = { on: iconSvg('on'), talk: iconSvg('talk'), mute: iconSvg('mute') };

/** Put (or update) the voice icon on an element. Cheap when nothing changed. */
function setIcon(host: Element, state: IconState): void {
  let i = host.querySelector<HTMLElement>(':scope > .vc-ico');
  if (state === 'off') {
    i?.remove();
    return;
  }
  if (!i) {
    i = document.createElement('i');
    i.className = 'vc-ico';
    host.appendChild(i);
  }
  if (i.dataset.s !== state) {
    i.dataset.s = state;
    i.innerHTML = localizeHtml(ICONS[state]);
    i.title = localize(state === 'talk' ? 'Talking' : state === 'mute' ? 'Muted by you' : 'Voice chat on');
  }
}

function stateFor(r: VoiceRosterEntry | undefined, idx: number, isMe: boolean): IconState {
  if (!r || !r.on || !voice.enabled) return 'off';
  if (!isMe && voice.prefs.mute[r.name]) return 'mute';
  return voice.speaking[idx] ? 'talk' : 'on';
}

// ------------------------------------------------------------------ the screen

let screen: VoiceScreen | null = null;
let selfChip: HTMLElement | null = null;
let uiT = 0;

class VoiceScreen {
  readonly el = document.createElement('div');
  readonly nav: MenuNav;
  private key = '';
  private meter: HTMLElement;
  private status: HTMLElement;
  private list: HTMLElement;

  constructor(private g: Game) {
    this.el.id = 'scr-voicechat';
    this.el.className = 'screen dim';
    this.el.setAttribute('aria-label', localize('Voice chat'));
    this.el.innerHTML = localizeHtml(`<h1>${t('voice.title')}</h1>
      <div class="vc-panel">
        <p class="vc-status" aria-live="polite"></p>
        <div class="vc-meter-row"><span class="lbl">MIC</span><div class="vc-meter" role="meter" aria-label="Microphone level">${'<i></i>'.repeat(20)}<b class="thr"></b></div></div>
        <div class="menu vc-opts">
          <button data-nav data-vc="toggle"></button>
          <button data-nav data-vc="test"></button>
          <button data-nav data-vc="mode"></button>
          <button data-nav data-vc="radio"></button>
        </div>
        <div class="vc-head">${t('voice.players')}</div>
        <div class="vc-list"></div>
        <button data-nav data-vc="back" class="vc-back">BACK</button>
      </div>`);
    this.meter = this.el.querySelector('.vc-meter')!;
    this.status = this.el.querySelector('.vc-status')!;
    this.list = this.el.querySelector('.vc-list')!;
    const back = () => {
      voice.loopback = false;
      this.g.screens.show('settings');
    };
    this.nav = new MenuNav(this.el, { onBack: back });
    g.screens.addScreen('voicechat', this.el, this.nav);
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-vc]');
      if (!b) return;
      const name = b.dataset.name ?? '';
      switch (b.dataset.vc) {
        case 'back':
          return back();
        case 'toggle':
          settings.voiceChat = !settings.voiceChat;
          saveSettings();
          if (settings.voiceChat) void voice.start(); // ask for the mic inside the click (user gesture)
          break;
        case 'test':
          if (!settings.voiceChat) {
            settings.voiceChat = true;
            saveSettings();
            void voice.start();
          }
          voice.loopback = !voice.loopback;
          break;
        case 'mode':
          settings.voiceMode = settings.voiceMode === 'ptt' ? 'open' : 'ptt';
          saveSettings();
          break;
        case 'radio':
          settings.teamRadio = !settings.teamRadio;
          saveSettings();
          break;
        case 'vol-':
        case 'vol+': {
          const v = voice.prefs.vol[name] ?? 1;
          voice.setPlayerVolume(name, Math.round((v + (b.dataset.vc === 'vol+' ? 0.25 : -0.25)) * 4) / 4);
          break;
        }
        case 'mute':
          voice.toggleMute(name);
          break;
      }
      this.refresh(true);
    });
  }

  /** The player rows (other players in the current game). */
  private rows(): VoiceRosterEntry[] {
    const myId = (this.g.host?.voicePeer ?? this.g.client?.voicePeer)?.id ?? '';
    return voice.roster.filter((r, i) => r.id !== myId && !!r.name && i !== voice.demo?.me);
  }

  /** Rebuild the buttons when something they show changed; update the live parts always. */
  refresh(force = false): void {
    const rows = this.rows();
    const key = JSON.stringify([settings.voiceChat, settings.voiceMode, settings.teamRadio, voice.loopback, voice.status, rows.map((r) => [r.name, r.on]), voice.prefs]);
    if (force || key !== this.key) {
      this.key = key;
      const opt = (k: string, label: string, value: string) => {
        const b = this.el.querySelector<HTMLElement>(`[data-vc="${k}"]`)!;
        b.innerHTML = localizeHtml(`${label} <b>${value}</b>`);
      };
      opt('toggle', 'VOICE CHAT', settings.voiceChat ? 'ON' : 'OFF');
      opt('test', 'TEST MIC (HEAR YOURSELF)', voice.loopback ? 'ON' : 'OFF');
      opt('mode', 'VOICE MODE', settings.voiceMode === 'ptt' ? 'PUSH TO TALK' : 'OPEN MIC');
      opt('radio', 'TEAM RADIO', settings.teamRadio ? 'ON' : 'OFF');
      this.list.innerHTML = localizeHtml(rows.length
        ? rows
            .map((r) => {
              const n = esc(r.name);
              const vol = Math.round((voice.prefs.vol[r.name] ?? 1) * 100);
              const muted = !!voice.prefs.mute[r.name];
              return `<div class="vc-row ${r.on ? '' : 'novc'}" data-row="${n}"><span class="nm"><bdi>${n}</bdi></span><span class="st">${r.on ? '' : localize('NO VOICE')}</span>
                <button data-nav data-vc="vol-" data-name="${n}" aria-label="${esc(t('arabic2.quieter'))}">-</button><span class="vol">${vol}%</span><button data-nav data-vc="vol+" data-name="${n}" aria-label="${esc(t('arabic2.louder'))}">+</button>
                <button data-nav data-vc="mute" data-name="${n}" class="${muted ? 'on' : ''}">${localize(muted ? 'MUTED' : 'MUTE')}</button></div>`;
            })
            .join('')
        : `<p class="vc-empty">${t('voice.empty')}</p>`);
      const focus = this.nav.focus;
      this.nav.refresh(focus);
    }
    // Live: status line, meter, threshold, speaking lights on the rows.
    const st = this.statusText();
    if (this.status.textContent !== st) this.status.textContent = localize(st);
    const segs = this.meter.children;
    const lit = Math.round(meterPos(voice.micLevel) * 20);
    const talking = voice.transmitting || voice.loopback;
    for (let i = 0; i < 20; i++) {
      const c = segs[i] as HTMLElement;
      const on = i < lit;
      if (c.classList.contains('on') !== on) c.classList.toggle('on', on);
    }
    this.meter.classList.toggle('talk', talking);
    const thr = this.meter.querySelector<HTMLElement>('.thr')!;
    thr.hidden = settings.voiceMode !== 'open';
    thr.style.left = `${(meterPos(vadThreshold(settings.voiceSensitivity)) * 100).toFixed(1)}%`;
    for (const row of this.list.querySelectorAll<HTMLElement>('.vc-row')) {
      const idx = voice.roster.findIndex((r) => r.name === row.dataset.row);
      row.classList.toggle('talk', !!voice.speaking[idx]);
    }
  }

  private statusText(): string {
    const online = !!(this.g.host || this.g.client);
    const ptt = `${localize('HOLD')} ${promptText()} ${localize('TO TALK')}`;
    switch (voice.status) {
      case 'off':
        return localize('VOICE CHAT IS OFF. TURN IT ON TO TALK WITH YOUR TEAM.');
      case 'asking':
        return localize('WAITING FOR MICROPHONE PERMISSION...');
      case 'unsupported':
        return localize('VOICE CHAT IS NOT SUPPORTED HERE');
      case 'denied':
        return localize('MICROPHONE BLOCKED: YOU CAN STILL LISTEN. ALLOW THE MIC IN YOUR BROWSER OR SYSTEM SETTINGS.');
      case 'nomic':
        return localize('NO MICROPHONE FOUND: YOU CAN STILL LISTEN');
      default:
        return `${localize('MIC READY')} · ${settings.voiceMode === 'ptt' ? ptt : localize('OPEN MIC: TALK ABOVE THE LINE')}${online ? '' : ` · ${localize('JOIN AN ONLINE GAME TO HEAR TEAMMATES')}`}`;
    }
  }
}

/** Talk key and pad button as plain text ("N / LS"). */
function promptText(): string {
  const tmp = document.createElement('span');
  tmp.innerHTML = localizeHtml(promptHtml('talk'));
  return tmp.textContent?.trim() || 'N';
}

/** Mic level (RMS) to 0..1 on a -60..0 dB scale. */
export function meterPos(level: number): number {
  if (!(level > 0)) return 0;
  return Math.max(0, Math.min(1, (20 * Math.log10(level) + 60) / 60));
}

const esc = (s: string) => s.replace(/[<>&"]/g, '');

// ------------------------------------------------------------------ per tick

/** Build the UI now (test links open the VOICE CHAT screen before the first tick). */
export function ensureVoiceUi(g: Game): void {
  ensureUi(g);
}

function ensureUi(g: Game): void {
  if (screen || typeof document === 'undefined') return;
  injectCss();
  screen = new VoiceScreen(g);
  selfChip = document.createElement('div');
  selfChip.id = 'vc-self';
  selfChip.hidden = true;
  document.body.appendChild(selfChip);
  // SETTINGS > CO-OP: a button to the VOICE CHAT screen, under the voice rows.
  const anchor = document.querySelector('#scr-settings [data-setting="teamRadio"]');
  if (anchor && !document.querySelector('[data-voice-open]')) {
    const b = document.createElement('button');
    b.dataset.voiceOpen = '';
    b.textContent = localize('VOICE PLAYERS & MIC TEST…');
    b.addEventListener('click', () => g.screens.show('voicechat'));
    anchor.after(b);
  }
}

/** 10 Hz: icons on lobby cards, teammate rows and name tags; the mic chip; the open VOICE screen. */
export function voiceUiTick(g: Game, dt: number): void {
  if (typeof document === 'undefined') return;
  ensureUi(g);
  if (voice.notice) {
    g.hud.toast(localize(voice.notice), 3);
    voice.notice = '';
  }
  uiT -= dt;
  if (uiT > 0) return;
  uiT = 0.1;
  if (g.screens.current === 'voicechat') screen?.refresh();
  const online = !!(g.host || g.client) || !!voice.demo;
  const myId = (g.host?.voicePeer ?? g.client?.voicePeer)?.id ?? '';
  const roster = voice.roster;
  const inRun = g.mode !== 'title' && g.heroes.length >= 2;

  // Lobby cards (lobby index order).
  const cards = document.querySelectorAll('#scr-online .lobby .players > .lobby-player');
  cards.forEach((c, i) => {
    const r = inRun ? undefined : roster[i];
    setIcon(c, online ? stateFor(r, i, !!r && r.id === myId) : 'off');
  });

  // Teammate rows (every other hero) and name tags (every other hero still in the run).
  const others = inRun ? g.heroes.filter((h) => h !== g.hero) : [];
  const rows = document.querySelectorAll('#team > .mate');
  rows.forEach((el, i) => {
    const h = others[i];
    setIcon(el, h ? stateFor(roster[h.index], h.index, false) : 'off');
  });
  const tagged = others.filter((h) => !h.left);
  const tags = document.querySelectorAll('#tags > .tag');
  tags.forEach((el, i) => {
    const h = tagged[i];
    setIcon(el, h ? stateFor(roster[h.index], h.index, false) : 'off');
  });

  // This player's mic chip: shown while voice is on in an online game.
  if (selfChip) {
    const show = online && voice.enabled && (g.screens.current === 'none' || g.screens.current === 'online');
    if (selfChip.hidden === show) selfChip.hidden = !show;
    if (show) {
      const s = voice.transmitting ? 'talk' : voice.status === 'on' ? 'on' : 'mute';
      const label = voice.transmitting ? 'TALKING' : voice.status !== 'on' ? 'NO MIC' : settings.voiceMode === 'ptt' ? `${promptText()} TALK` : 'MIC';
      const k = s + label;
      if (selfChip.dataset.k !== k) {
        selfChip.dataset.k = k;
        selfChip.className = s;
        selfChip.innerHTML = localizeHtml(`${ICONS[s]}<span>${localize(label)}</span>`);
      }
    }
  }
}

function injectCss(): void {
  if (document.getElementById('voicechat-css')) return;
  const css = document.createElement('style');
  css.id = 'voicechat-css';
  css.textContent = `
.vc-ico { display:inline-flex; pointer-events:none; line-height:0; }
.vc-ico svg { width:18px; height:16px; }
#team > .mate { position:relative; }
#team > .mate > .vc-ico { position:absolute; right:calc(-7 * var(--p)); top:0; }
#tags > .tag > .vc-ico { position:absolute; left:50%; top:calc(-6 * var(--p)); transform:translateX(-50%); }
.lobby-player { position:relative; }
.lobby-player > .vc-ico { position:absolute; left:calc(-3 * var(--p)); top:calc(-3 * var(--p)); background:var(--ink); padding:2px; }
.vc-ico[data-s="talk"] { animation:vc-blink .5s steps(2) infinite; }
@keyframes vc-blink { 50% { filter:brightness(1.35); } }
.reduce-flash .vc-ico[data-s="talk"] { animation:none; }
#vc-self { position:fixed; left:calc(4 * var(--p)); bottom:calc(46 * var(--p)); display:flex; align-items:center; gap:6px; padding:3px 8px; background:var(--ink); color:var(--mist); font:10px var(--label); z-index:6; pointer-events:none;
  box-shadow: var(--p) 0 0 var(--slate), calc(-1 * var(--p)) 0 0 var(--slate), 0 var(--p) 0 var(--slate), 0 calc(-1 * var(--p)) 0 var(--slate); }
#vc-self.talk { color:var(--lime); box-shadow: var(--p) 0 0 var(--lime), calc(-1 * var(--p)) 0 0 var(--lime), 0 var(--p) 0 var(--lime), 0 calc(-1 * var(--p)) 0 var(--lime); }
#vc-self.mute { color:var(--red); }
#vc-self[hidden] { display:none; }
#scr-voicechat { padding:calc(6 * var(--p)); gap:calc(3 * var(--p)); justify-content:center; }
#scr-voicechat h1 { margin:0; font-size:42px; }
#scr-voicechat .vc-panel { width:min(720px, 100%); display:flex; flex-direction:column; gap:calc(3 * var(--p)); max-height:80vh; overflow-y:auto; }
#scr-voicechat .vc-status { color:var(--cyan); font:20px/1.15 var(--font); margin:0; min-height:2.3em; text-align:center; }
#scr-voicechat .vc-meter-row { display:flex; align-items:center; gap:10px; }
#scr-voicechat .vc-meter-row .lbl { font:10px var(--label); color:var(--mist); }
#scr-voicechat .vc-meter { position:relative; flex:1; display:flex; gap:var(--p); padding:var(--p); background:var(--ink); height:calc(6 * var(--p)); }
#scr-voicechat .vc-meter i { flex:1; background:var(--night); }
#scr-voicechat .vc-meter i.on { background:var(--slate); }
#scr-voicechat .vc-meter.talk i.on { background:var(--lime); }
#scr-voicechat .vc-meter i.on:nth-child(n+15) { background:var(--yellow); }
#scr-voicechat .vc-meter i.on:nth-child(n+19) { background:var(--red); }
#scr-voicechat .vc-meter .thr { position:absolute; top:calc(-2 * var(--p)); bottom:calc(-2 * var(--p)); width:var(--p); background:var(--white); }
#scr-voicechat .vc-meter .thr[hidden] { display:none; }
#scr-voicechat .vc-opts { display:grid; grid-template-columns:1fr 1fr; gap:calc(3 * var(--p)); }
#scr-voicechat .vc-opts button { font-size:20px; min-height:44px; display:flex; justify-content:space-between; gap:8px; }
#scr-voicechat .vc-opts b, #scr-voicechat .vc-row .vol { color:var(--yellow); font-weight:normal; }
#scr-voicechat .vc-head { font:10px var(--label); color:var(--mist); margin-top:calc(2 * var(--p)); }
#scr-voicechat .vc-list { display:flex; flex-direction:column; gap:calc(2 * var(--p)); }
#scr-voicechat .vc-row { display:flex; align-items:center; gap:8px; padding:4px 8px; background:var(--night); font-size:20px; }
#scr-voicechat .vc-row .nm { flex:1; color:var(--white); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#scr-voicechat .vc-row .nm::before { content:''; display:inline-block; width:calc(3 * var(--p)); height:calc(3 * var(--p)); margin-right:8px; background:var(--slate); vertical-align:middle; }
#scr-voicechat .vc-row.talk .nm::before { background:var(--lime); }
#scr-voicechat .vc-row.novc { opacity:.6; }
#scr-voicechat .vc-row .st { font:9px var(--label); color:var(--slate); }
#scr-voicechat .vc-row button { min-width:44px; min-height:40px; font-size:20px; padding:0 8px; }
#scr-voicechat .vc-row button.on { --bg:var(--red); color:var(--white); }
#scr-voicechat .vc-row .vol { min-width:4ch; text-align:center; }
#scr-voicechat .vc-empty { color:var(--slate); margin:0; font-size:18px; }
#scr-voicechat .vc-back { align-self:center; font-size:20px; min-height:44px; }
@media(max-width:600px) { #scr-voicechat .vc-opts { grid-template-columns:1fr; } #scr-voicechat h1 { font-size:30px; } }
`;
  document.head.append(css);
}
