/**
 * Lobby lane, whole-game checks (jsdom, no WebGL): a host Game and a client
 * Game wired in-process (messages structured-cloned, delivered on flush()).
 * - Lobby: hello with a profile card, player cards on both sides, pings,
 *   READY-UP and the countdown start, chat (filter, broadcast, rate limit),
 *   quick chat.
 * - Party: online game over -> PARTY button, votes, RESTART with the same
 *   party, then BACK TO LOBBY with everyone still connected.
 * - KICK: the client is removed, can't rejoin for a while.
 * - Recent teammates saved with their friend codes; invite links on the join field.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { ok } from './check';

const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const noop: any = new Proxy(function () {}, {
  get: (_t, k) => (k === 'data' ? new Uint8ClampedArray(4 * 64 * 64) : k === Symbol.toPrimitive ? () => 0 : k === 'measureText' ? () => ({ width: 10 }) : noop),
  apply: () => noop,
  set: () => true,
});
(dom.window.HTMLCanvasElement.prototype as any).getContext = function () {
  return new Proxy(noop, { get: (_t, k) => (k === 'createImageData' || k === 'getImageData' ? (w2: number, h2: number) => ({ data: new Uint8ClampedArray(4 * (w2 || 64) * (h2 || 64)) }) : k === 'canvas' ? this : noop[k as never]) });
};
(dom.window.HTMLCanvasElement.prototype as any).toDataURL = () => 'data:image/png;base64,';
for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLCanvasElement', 'HTMLInputElement', 'Event', 'KeyboardEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'innerWidth', 'innerHeight', 'addEventListener', 'dispatchEvent', 'Node', 'MouseEvent', 'PointerEvent', 'location', 'history']) {
  try {
    (globalThis as any)[k] = (dom.window as any)[k];
  } catch {
    Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true });
  }
}
(globalThis as any).Path2D = class {
  constructor(_d?: string) {}
};
(globalThis as any).__APP_VERSION__ = 'smoke';
(dom.window as any).Path2D = (globalThis as any).Path2D;
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
(dom.window.navigator as any).getGamepads = () => [];
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});
const errors: string[] = [];
process.on('uncaughtException', (e) => errors.push('uncaught ' + e.stack));

const { Input } = await import('../src/core/input');
const { Game } = await import('../src/game/game');
const { unlockedWeapons, save } = await import('../src/game/save');
const { validLoadout, DEFAULT_LOADOUT } = await import('../src/data/loadout');
const { partyState, chatLog, lobbyX, partyView } = await import('../src/game/systems/party');
const { lobbyTuning } = await import('../src/game/lobby');

const canvas = document.getElementById('game') as HTMLCanvasElement;
const newRoot = () => {
  const r = document.createElement('div');
  document.body.appendChild(r);
  return r;
};
const tick = () => new Promise((r) => setTimeout(r, 0));

const A = new Game(new Input(canvas), 16 / 9, newRoot(), document.createElement('div'));
const B = new Game(new Input(canvas), 16 / 9, newRoot(), document.createElement('div'));
const rootA = (A.screens as any).root as HTMLElement;
const rootB = (B.screens as any).root as HTMLElement;
const q: [any, any][] = [];
let kicked: string[] = [];
let connected = true;
(A as any).role = 'host';
(A as any).host = { code: 'K7QXP', clientIds: ['peerB'], send: (_id: string, m: any) => connected && q.push([B, m]), broadcast: (m: any) => connected && q.push([B, m]), close() {}, kick: (id: string) => kicked.push(id) };
(B as any).role = 'client';
(B as any).client = { send: (m: any) => connected && q.push([A, m]), close() {} };
const flush = () => {
  while (q.length) {
    const [g, m] = q.shift()!;
    if (g === A) A.onHostMessage('peerB', structuredClone(m));
    else B.onClientMessage(structuredClone(m));
  }
};
const steps = (n: number) => {
  for (let i = 0; i < n; i++) {
    A.update(1 / 60);
    B.update(1 / 60);
    flush();
  }
};
A.netName = 'Host';
A.lobby = [{ peerId: '', name: 'Host', unlocked: unlockedWeapons(), loadout: validLoadout(DEFAULT_LOADOUT), skin: 'classic', pet: 'none', hero: 'rookie' }];
A.screens.showOnline('Host');
A.refreshLobby();
B.screens.showOnline('Guest');
B.screens.setLobby({ code: 'K7QXP', players: [], isHost: false, status: 'Connected!' });

// ---------------------------------------------------------------- lobby: hello, cards, pings
A.onHostMessage('peerB', { t: 'hello', pid: 'pid-guest', name: 'Guest', unlocked: unlockedWeapons(), loadout: DEFAULT_LOADOUT, skin: 'classic', pet: 'bit', hero: 'bulwark', prof: { lv: 7, best: 4, runs: 20, ach: 6, fc: 'GQEST' } });
await tick();
flush();
ok(A.lobby.length === 2, 'host lobby has the guest');
const sa = partyState(A)!;
ok(sa.profiles.get('peerB')?.lv === 7 && sa.profiles.get('peerB')?.fc === 'GQEST', 'host keeps the guest profile card');
const xb = lobbyX(B);
ok(!!xb && xb.p.length === 2 && xb.you === 1 && xb.p[1].hero === 'bulwark' && xb.p[1].pet === 'bit' && xb.p[1].prof?.best === 4, 'client gets the cards: ' + JSON.stringify(xb));
const cardsB = rootB.querySelector('#scr-online .players')?.textContent ?? '';
ok(cardsB.includes('BULWARK') && cardsB.includes('LV 7') && cardsB.includes('BEST STAGE 4') && cardsB.includes('YOU'), 'client draws the cards: ' + cardsB.replace(/\s+/g, ' ').trim().slice(0, 160));
const kickA = rootA.querySelector('#scr-online [data-act=lob-kick]');
ok(!!kickA && kickA.textContent!.includes('GUEST'), 'host has a KICK button for the guest');
ok(!rootB.querySelector('#scr-online [data-act=lob-kick]'), 'the client has no KICK');
ok(!!rootA.querySelector('#scr-online [data-act=lob-invite]') && !rootB.querySelector('#scr-online [data-act=lob-invite]'), 'COPY INVITE LINK for the host only');
steps(Math.ceil(60 * (lobbyTuning.pingEvery + 0.5)));
ok(sa.pings.has('peerB') && (lobbyX(B)?.p[1].ping ?? -1) >= 0, 'ping measured and shown: ' + sa.pings.get('peerB'));

// ---------------------------------------------------------------- chat
B.lobbyChat('hey this shit is fun');
flush();
const lastA = chatLog(A).at(-1);
const lastB = chatLog(B).at(-1);
ok(lastA?.n === 'Guest' && lastA.s === 'hey this **** is fun' && lastB?.s === lastA.s, 'chat: filtered on the host and broadcast: ' + JSON.stringify(lastB));
B.lobbyChat('again right away');
flush();
ok(chatLog(B).at(-1)?.sys === true && chatLog(A).at(-1)?.s !== 'again right away', 'chat: too fast is refused (client side first)');
// A client that skips its own check is held by the host.
for (let i = 0; i < 6; i++) B.client!.send({ t: 'lbchat', s: 'spam ' + i });
flush();
const spam = chatLog(A).filter((l) => l.s.startsWith('spam')).length;
ok(spam <= 1 && chatLog(B).at(-1)?.sys === true, `chat: the host rate-limits a spamming client (${spam} of 6 through)`);
A.lobbyChat(2);
flush();
ok(chatLog(B).at(-1)?.s === "LET'S GO!" && chatLog(B).at(-1)?.n === 'Host', 'quick chat from the host reaches the client');
B.client!.send({ t: 'lbchat', q: 99 });
flush();
ok(chatLog(A).at(-1)?.s === "LET'S GO!", 'quick chat: a bad index is ignored');
ok((rootB.querySelector('.lob-chat .lob-log')?.textContent ?? '').includes('Host:'), 'chat panel drawn on the client');
B.client!.send({ t: 'lbchat', s: '<img src=x onerror=alert(1)>' });
flush();
ok(!rootA.querySelector('.lob-log img') && !rootB.querySelector('.lob-log img'), 'chat: markup is shown as text, never as HTML');

// ---------------------------------------------------------------- ready-up
A.lobbyReady(true);
steps(2);
ok(A.mode === 'title' && sa.cd < 0, 'only the host ready: no countdown');
B.lobbyReady();
steps(2);
ok(sa.cd > 0 && (lobbyX(B)?.cd ?? -1) > 0, 'everyone ready: the countdown runs on both');
ok((rootB.querySelector('#scr-online .lob-status')?.textContent ?? '').includes('STARTING IN'), 'client sees STARTING IN');
B.lobbyReady(false);
steps(2);
ok(sa.cd < 0 && A.mode === 'title', 'an un-ready cancels the countdown');
B.lobbyReady(true);
steps(Math.ceil(60 * (lobbyTuning.countdown + 0.5)));
ok(A.mode !== 'title' && B.mode !== 'title' && B.heroes.length === 2, `the run started for both (host ${A.mode}, client ${B.mode})`);
ok(save.friends.recent.some((r) => r.name === 'Guest' && r.code === 'GQEST'), 'recent teammates saved with their friend code');

// ---------------------------------------------------------------- party after game over
// Skip the starting shop and fight a moment.
if (A.mode === 'shop') {
  for (const h of A.heroes) h.shopDone = true;
  A.closeShop();
}
steps(30);
const gameOver = () => {
  A.mode = 'dead';
  A.endRun();
  steps(3);
};
gameOver();
ok(A.screens.current === 'gameover' && B.screens.current === 'gameover', 'game over on both');
const partyBtn = rootB.querySelector<HTMLElement>('#scr-gameover [data-act=party-open]');
ok(!!partyBtn && !partyBtn.hidden && rootB.querySelector<HTMLElement>('#scr-gameover [data-act=retry]')!.hidden, 'online game over: PARTY instead of RETRY');
partyBtn!.click();
(rootA.querySelector('#scr-gameover [data-act=party-open]') as HTMLElement).click();
steps(2);
ok(B.screens.current === 'party' && A.screens.current === 'party', 'PARTY screen open on both');
const pv = partyView(B);
ok(!!pv && pv.rows.length === 2 && pv.you === 1 && pv.rows[0].n === 'Host' && pv.rows[1].n === 'Guest', 'client gets the party view: ' + JSON.stringify(pv && { rows: pv.rows.map((r) => r.n), you: pv.you }));
ok((rootB.querySelector('#scr-party .pty-sum')?.textContent ?? '').includes('STAGE'), 'party summary drawn');
ok(rootB.querySelectorAll('#scr-party .pty-host button:not([hidden])').length === 0 && rootA.querySelectorAll('#scr-party .pty-host button:not([hidden])').length === 2, 'RESTART NOW / LOBBY NOW for the host only');
B.partyVote('restart');
steps(2);
ok(partyView(B)?.rows[1].v === 'restart' && A.mode === 'dead', 'a vote shows; one vote is not enough');
ok((rootB.querySelector('#scr-party .pty-votes')?.textContent ?? '').includes('1/2'), 'vote count on the button');
A.partyVote('lobby');
steps(2);
ok(A.mode === 'dead', 'split votes: nothing happens');
A.partyVote('restart');
steps(3);
ok(A.mode !== 'dead' && A.mode !== 'title' && B.mode !== 'dead' && B.heroes.length === 2 && A.heroes.length === 2, `unanimous RESTART: same party, new run (host ${A.mode}, client ${B.mode})`);
ok(A.heroes[1].peerId === 'peerB' && A.heroes[1].heroDef.id === 'bulwark' && A.heroes[1].pet === 'bit', 'the guest keeps hero and pet');
ok(A.stage === 1 && A.kills === 0, 'a fresh run');

// ---------------------------------------------------------------- back to the lobby
if (A.mode === 'shop') {
  for (const h of A.heroes) h.shopDone = true;
  A.closeShop();
}
steps(10);
gameOver();
B.partyVote('lobby');
A.partyVote('lobby');
steps(3);
ok(A.mode === 'title' && B.mode === 'title' && A.screens.current === 'online' && B.screens.current === 'online', `unanimous LOBBY: both back in the lobby (host ${A.screens.current}, client ${B.screens.current})`);
ok(A.lobby.length === 2 && A.lobby[1].peerId === 'peerB' && A.lobby[1].hero === 'bulwark' && A.heroes.length === 1 && B.heroes.length === 1, 'still connected: the lobby keeps the guest and picks');
ok(B.role === 'client' && !!B.client, 'the client kept its connection');
ok(!(lobbyX(B)?.p.some((c) => c.ready) ?? true), 'ready flags cleared');
ok((rootB.querySelector('#scr-online .players')?.textContent ?? '').includes('Guest'), 'client lobby lists the party');
// Host forces: START GAME from the lobby still works without ready-up.
A.hostStart();
steps(2);
ok(B.mode !== 'title' && B.heroes.length === 2, 'host can force the start');
if (A.mode === 'shop') {
  for (const h of A.heroes) h.shopDone = true;
  A.closeShop();
}
steps(5);
gameOver();
A.partyForce('lobby');
steps(3);
ok(A.mode === 'title' && B.mode === 'title' && A.lobby.length === 2, 'LOBBY NOW skips the vote');

// ---------------------------------------------------------------- kick
A.lobbyKick(1);
await tick();
flush();
await new Promise((r) => setTimeout(r, 250));
ok(A.lobby.length === 1 && kicked.includes('peerB'), 'kick: the guest is out of the host lobby and its connection closed');
ok(B.role === 'solo' && B.mode === 'title' && !B.client, 'kick: the client is back at the title');
// Rejoin with the same player id: refused while the ban lasts.
connected = true;
(B as any).role = 'client';
(B as any).client = { send: (m: any) => q.push([A, m]), close() {} };
const before = q.length;
A.onHostMessage('peerB2', { t: 'hello', pid: 'pid-guest', name: 'Guest', prof: {} });
const reply = q.slice(before).find(([g, m]) => g === B && m.t === 'full');
ok(!!reply && String(reply[1].reason).includes('removed') && A.lobby.length === 1, 'kick: rejoining is refused for a while');
q.length = 0;

// ---------------------------------------------------------------- join field takes links
const code = rootB.querySelector<HTMLInputElement>('#mp-code')!;
code.value = 'https://mohamadhazeem.github.io/Infinishoot/?join=k7qxp';
code.dispatchEvent(new Event('input'));
ok(code.value === 'K7QXP', 'join field: a pasted invite link becomes the code');

ok(errors.length === 0, 'no uncaught errors' + (errors.length ? ': ' + errors.join('\n') : ''));
process.exit(process.exitCode ?? 0);
