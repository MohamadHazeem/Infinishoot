/**
 * Lobby lane, pure rules (src/game/lobby.ts): chat filter and rate limits,
 * ready-up and party votes, invite links, profile cards, the friends list and
 * its save migration.
 */
import { ok } from './check';
import {
  addSaved,
  allReady,
  ChatLimiter,
  chatTuning,
  cleanFriends,
  cleanProfile,
  filterChat,
  inviteBase,
  inviteLink,
  lastPlayed,
  makeFriendCode,
  noteRecent,
  parseInviteCode,
  pingBand,
  profileLevel,
  QUICK_CHAT,
  removeSaved,
  tallyVotes,
  voteCounts,
  WEB_URL,
  friendsTuning,
} from '../src/game/lobby';
import { normalize } from '../src/game/save';

// ---------------------------------------------------------------- chat filter
ok(filterChat('  hello   there  ') === 'hello there', 'chat: spaces collapsed and trimmed');
ok(filterChat('a'.repeat(200)).length === chatTuning.maxLen, `chat: capped at ${chatTuning.maxLen} characters`);
ok(filterChat('what the fuck') === 'what the ****', 'chat: a bad word is starred: ' + filterChat('what the fuck'));
ok(filterChat('SHIT happens') === '**** happens', 'chat: case-insensitive');
ok(filterChat('sh1t and $hit and fuuuuck') === '**** and **** and *******', 'chat: leetspeak and stretched words: ' + filterChat('sh1t and $hit and fuuuuck'));
ok(filterChat('fucking') === '*******', 'chat: listed forms');
ok(filterChat('Scunthorpe classic assassin cockpit') === 'Scunthorpe classic assassin cockpit', 'chat: whole words only (no Scunthorpe problem)');
ok(filterChat('line\nbreak\u0007bell') === 'line break bell', 'chat: control characters removed');
ok(filterChat('\u202eevil') === 'evil', 'chat: bidi overrides removed');
ok(filterChat('   ') === '' && filterChat(42) === '' && filterChat(null) === '', 'chat: empty or not text gives nothing');
ok(filterChat('<b>hi</b>') === '<b>hi</b>', 'chat: markup kept as text (the UI escapes it)');
ok(QUICK_CHAT.length >= 4 && QUICK_CHAT.every((q) => filterChat(q) === q), 'quick chat phrases pass the filter');

// ---------------------------------------------------------------- rate limit
{
  const lim = new ChatLimiter();
  ok(lim.allow('a', 0), 'limiter: first message');
  ok(!lim.allow('a', 0.3), `limiter: too soon (min gap ${chatTuning.minGap} s)`);
  ok(lim.allow('b', 0.3), 'limiter: per sender');
  ok(lim.allow('a', 1) && lim.allow('a', 2) && lim.allow('a', 3), 'limiter: spaced messages pass');
  ok(!lim.allow('a', 4), `limiter: burst cap (${chatTuning.burst} per ${chatTuning.window} s)`);
  ok(lim.allow('a', 8.5), 'limiter: the window slides');
  lim.forget('a');
  ok(lim.allow('a', 8.6), 'limiter: forget clears a sender');
  // A refused message doesn't extend the wait.
  const l2 = new ChatLimiter();
  l2.allow('x', 0);
  l2.allow('x', 0.5);
  ok(l2.allow('x', 0.81), 'limiter: refused attempts are not counted');
}

// ---------------------------------------------------------------- ready and votes
ok(!allReady([]) && !allReady([true]), 'ready: needs two or more players');
ok(allReady([true, true]) && !allReady([true, false, true]), 'ready: everyone');
ok(tallyVotes(['restart', 'restart']) === 'restart', 'votes: unanimous restart');
ok(tallyVotes(['lobby', 'lobby', 'lobby']) === 'lobby', 'votes: unanimous lobby');
ok(tallyVotes(['restart', 'lobby']) === null && tallyVotes(['restart', '']) === null && tallyVotes([]) === null, 'votes: split, missing or empty decide nothing');
{
  const c = voteCounts(['restart', '', 'lobby', 'restart']);
  ok(c.restart === 2 && c.lobby === 1 && c.total === 4, 'votes: counts');
}

// ---------------------------------------------------------------- invite links
ok(parseInviteCode('abcde') === 'ABCDE', 'invite: lower case code');
ok(parseInviteCode(' ab-cde ') === 'ABCDE', 'invite: spaces and dashes ignored');
ok(parseInviteCode('https://x.github.io/Infinishoot/?join=K7QXP') === 'K7QXP', 'invite: a whole link');
ok(parseInviteCode('http://localhost:5173/?test&join=k7qxp&god') === 'K7QXP', 'invite: join among other params');
ok(parseInviteCode('https://x/#join=K7QXP') === 'K7QXP', 'invite: hash form');
ok(parseInviteCode('ABC') === null && parseInviteCode('ABCDEF') === null && parseInviteCode('ABCD0') === null && parseInviteCode('?join=') === null && parseInviteCode(5) === null, 'invite: wrong length, 0/O/1/I letters, empty or not text: null');
ok(inviteBase({ protocol: 'https:', origin: 'https://a.io', pathname: '/Infinishoot/' }) === 'https://a.io/Infinishoot/', 'invite: web build links to itself');
ok(inviteBase({ protocol: 'file:', origin: 'null', pathname: '/C:/app/dist/index.html' }) === WEB_URL && WEB_URL.startsWith('https://'), 'invite: the desktop app (file://) links to the web build');
ok(inviteBase(undefined) === WEB_URL, 'invite: no location: the web build');
ok(inviteLink('https://a.io/', 'K7QXP') === 'https://a.io/?join=K7QXP' && inviteLink('https://a.io/?x=1', 'K7QXP') === 'https://a.io/?x=1&join=K7QXP', 'invite: link shape');
ok(parseInviteCode(inviteLink(WEB_URL, 'Q2W3E')) === 'Q2W3E', 'invite: round trip');

// ---------------------------------------------------------------- profile
ok(profileLevel({ kills: 0, bosses: 0, runs: 0 }, 0) === 1, 'profile: fresh save is LV 1');
{
  const mid = profileLevel({ kills: 5000, bosses: 10, runs: 25 }, 8);
  const vet = profileLevel({ kills: 200000, bosses: 300, runs: 600 }, 40);
  ok(mid > 5 && mid < 15 && vet > mid && vet <= 99, `profile: grows gently (mid ${mid}, veteran ${vet})`);
  ok(profileLevel({ kills: 1e12, bosses: 1e9, runs: 1e9 }, 1e6) === 99, 'profile: capped at 99');
}
{
  const p = cleanProfile({ lv: 1e9, best: -5, runs: 'x', ach: 3.7, fc: 'K7QXP', extra: '<script>' });
  ok(!!p && p.lv === 99 && p.best === 0 && p.runs === 0 && p.ach === 3 && p.fc === 'K7QXP' && !('extra' in p), 'profile: network card cleaned: ' + JSON.stringify(p));
  ok(cleanProfile({ fc: 'bad code!' })?.fc === '' && cleanProfile(null) === null && cleanProfile('x') === null, 'profile: bad friend code dropped, junk refused');
}
ok(pingBand(40) === 'good' && pingBand(120) === 'ok' && pingBand(400) === 'bad', 'ping bands');

// ---------------------------------------------------------------- friends
{
  let n = 0;
  const seq = [0.1, 0.5, 0.9, 0.3, 0.7];
  const code = makeFriendCode(() => seq[n++ % seq.length]);
  ok(parseInviteCode(code) === code, 'friend code: valid join code: ' + code);
  const many = new Set(Array.from({ length: 200 }, () => makeFriendCode()));
  ok(many.size > 190, 'friend codes: random');
}
{
  let r = noteRecent([], [{ name: 'Lina', code: 'LNA42' }, { name: 'Omar', code: '' }], '2026-10-18');
  ok(r.length === 2 && r[0].name === 'Omar' && r[1].name === 'Lina' && r[1].runs === 1, 'recent: newest first');
  r = noteRecent(r, [{ name: 'Lina2', code: 'LNA42' }], '2026-10-19');
  ok(r.length === 2 && r[0].name === 'Lina2' && r[0].runs === 2 && r[0].last === '2026-10-19', 'recent: same code is one entry (renamed, runs counted)');
  r = noteRecent(r, [{ name: 'Omar', code: 'QMR7X' }], '2026-10-19');
  ok(r.length === 2 && r[0].name === 'Omar' && r[0].code === 'QMR7X', 'recent: a code learned later fills in');
  r = noteRecent(r, [{ name: 'Me', code: 'MEMEM' }], '2026-10-19', 'MEMEM');
  ok(!r.some((x) => x.name === 'Me'), 'recent: never yourself');
  const big = noteRecent([], Array.from({ length: 40 }, (_, i) => ({ name: 'P' + i, code: '' })), '2026-10-19');
  ok(big.length === friendsTuning.maxRecent && big[0].name === 'P39', `recent: capped at ${friendsTuning.maxRecent}`);
  ok(noteRecent([], [{ name: '<b>\u0001', code: '' }], 'x')[0]?.name === 'b', 'recent: names cleaned');
}
{
  let s = addSaved([], 'Lina', 'https://a.io/?join=LNA42')!;
  ok(s.length === 1 && s[0].code === 'LNA42' && s[0].name === 'Lina', 'saved: from a pasted link');
  s = addSaved(s, '', 'QMR7X')!;
  ok(s[0].name === 'QMR7X', 'saved: no name uses the code');
  s = addSaved(s, 'Lina R', 'lna42')!;
  ok(s.length === 2 && s[0].name === 'Lina R', 'saved: same code renamed, not duplicated');
  ok(addSaved(s, 'x', 'nope') === null, 'saved: invalid code refused');
  ok(removeSaved(s, 'LNA42').length === 1, 'saved: remove');
}
ok(lastPlayed('2026-10-19', '2026-10-19') === 'TODAY' && lastPlayed('2026-10-18', '2026-10-19') === 'YESTERDAY' && lastPlayed('2026-10-12', '2026-10-19') === '7 DAYS AGO' && lastPlayed('2026-01-01', '2026-10-19') === '2026-01-01', 'last played labels');

// ---------------------------------------------------------------- save migration
{
  const old = normalize({ version: 4, achievements: [], lifetime: { runs: 3 } });
  ok(!!old.friends && old.friends.code === '' && old.friends.useCode && old.friends.recent.length === 0 && old.friends.saved.length === 0, 'save: a v4 save gets an empty friends list');
  ok(old.lifetime.runs === 3, 'save: the rest of a v4 save is kept');
  const v5 = normalize({ version: 5, friends: { code: 'K7QXP', useCode: false, recent: [{ name: 'Lina', code: 'LNA42', last: '2026-10-19', runs: 2 }, { name: '', code: 'X' }, 7], saved: [{ name: 'Omar', code: 'QMR7X' }, { name: 'Bad', code: 'nope' }] } });
  ok(v5.friends.code === 'K7QXP' && !v5.friends.useCode && v5.friends.recent.length === 1 && v5.friends.saved.length === 1 && v5.friends.recent[0].runs === 2, 'save: v5 friends kept, broken entries dropped');
  ok(cleanFriends({ code: 'lowercase' }).code === '', 'save: a bad friend code is dropped');
}
