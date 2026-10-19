/**
 * Trading lane, pure logic: give rules, the rate limit, shop pools, LEGEND
 * scaling, co-op titles and the achievement/difficulty data.
 */
import { ok } from './check';
import { checkGive, goldMoved, legendAllowed, legendDifficulty, legendTuning, poolLeft, poolTotal, TradeLimiter, TradePools, tradeTuning } from '../src/game/trading';
import { bestTitle, COOP_ACHIEVEMENTS, titleOf } from '../src/data/coopAchievements';
import { ACHIEVEMENTS } from '../src/data/meta';
import { DIFFICULTIES, DIFF_BY_ID } from '../src/data/modes';
import { ACTIONS, binds } from '../src/core/keybinds';

const w = (index: number, gold = 0, gears = 0, relics: string[] = [], left = false) => ({ index, gold, gears, relics, left });

// ---- Gives
ok(checkGive(w(0, 10), w(1), 'gold', 5, '', 5) === '', 'gold to a teammate is fine');
ok(checkGive(w(0, 0), w(1), 'gold', 5, '', 5) === 'NOT ENOUGH GOLD', 'no gold, no give');
ok(checkGive(w(0, 10), w(0), 'gold', 5, '', 5) !== '', "can't give to yourself");
ok(checkGive(w(0, 10), w(1, 0, 0, [], true), 'gold', 5, '', 5) === 'THAT PLAYER IS GONE', "can't give to someone who left");
ok(checkGive(w(0, 10), undefined, 'gold', 5, '', 5) === 'THAT PLAYER IS GONE', 'unknown receiver');
ok(checkGive(w(0, 10), w(1), 'gold', 0, '', 5) === 'NOTHING TO GIVE' && checkGive(w(0, 10), w(1), 'gold', NaN, '', 5) === 'NOTHING TO GIVE', 'zero / junk amounts refused');
ok(checkGive(w(0, 0, 1), w(1, 0, 4), 'gear', 0, '', 5) === '', 'a gear to a teammate with room');
ok(checkGive(w(0, 0, 1), w(1, 0, 5), 'gear', 0, '', 5) === 'THEIR GEAR BAG IS FULL', 'gear cap respected');
ok(checkGive(w(0, 0, 0), w(1), 'gear', 0, '', 5) === 'NO GEARS TO GIVE', 'no gear, no give');
ok(checkGive(w(0, 0, 0, ['r_a']), w(1), 'relic', 0, 'r_a', 5) === '', 'a relic you own');
ok(checkGive(w(0, 0, 0, ['r_a']), w(1, 0, 0, ['r_a']), 'relic', 0, 'r_a', 5) === 'THEY ALREADY HAVE IT', 'no duplicate relics');
ok(checkGive(w(0), w(1), 'relic', 0, 'r_a', 5) !== '', "can't give a relic you don't have");
ok(checkGive(w(0, 9), w(1), 'bogus' as never, 1, '', 5) !== '', 'unknown kinds refused');
ok(goldMoved(10, 25) === 10 && goldMoved(10, 4.7) === 4 && goldMoved(3.9, 5) === 3 && goldMoved(10, -5) === 0, 'gold moved: whole coins, never more than held');

// ---- Rate limit
{
  const l = new TradeLimiter();
  ok(l.allow(0), 'first trade allowed');
  ok(!l.allow(0.1), 'too soon after the last one');
  let n = 1;
  for (let t = 0.3; t < 4.9; t += 0.3) if (l.allow(t)) n++;
  ok(n === tradeTuning.burst, `burst cap: ${n} in 5 s`);
  ok(l.allow(5.5), 'allowed again once the window rolls on');
}

// ---- Pools
{
  const P = new TradePools();
  const p = P.open(2, 1, 'overclock', 30);
  ok(typeof p !== 'string', 'a pool opens');
  if (typeof p === 'string') throw new Error(p);
  ok(P.open(2, 0, 'echo', 20) === 'YOU ALREADY HAVE A POOL OPEN', 'one pool per player');
  ok(typeof P.open(3, 0, 'echo', 0) === 'string', 'no pool for a free offer');
  ok(P.chip(p, 0, 25, 10) === 10, 'a chip is capped by what you hold');
  ok(P.chip(p, 1, 25, 99) === 20, 'and by what is left');
  ok(P.chip(p, 1, 5, 99) === 0 && poolLeft(p) === 0 && poolTotal(p) === 30, 'a full pool takes nothing more');
  ok(P.chip(p, 3, -4, 9) === 0, 'negative chips do nothing');
  const back = P.close(p);
  ok(JSON.stringify(back) === JSON.stringify([[0, 10], [1, 20]]) && P.list.length === 0, `refunds by payer (${JSON.stringify(back)})`);
  const a = P.open(0, 0, 'a', 10) as ReturnType<TradePools['get']> & object;
  const b = P.open(1, 0, 'b', 10) as ReturnType<TradePools['get']> & object;
  P.chip(a, 1, 3, 9);
  P.chip(b, 0, 4, 9);
  P.chip(b, 2, 1, 9);
  const all = P.clear();
  ok(all.reduce((s, [, n]) => s + n, 0) === 8 && P.list.length === 0, 'closing the shop refunds every pool');
  for (let i = 0; i < tradeTuning.maxPools; i++) P.open(i, 0, 'm', 5);
  ok(P.open(99, 0, 'm', 5) === 'TOO MANY POOLS OPEN', 'pool count capped');
}

// ---- LEGEND
{
  const nm = DIFF_BY_ID.nightmare;
  const L = DIFF_BY_ID.legend;
  ok(!!L && L.coopOnly === true && DIFFICULTIES.indexOf(L) === DIFFICULTIES.indexOf(nm) + 1, 'LEGEND sits right after Nightmare, co-op only');
  for (const n of [2, 3, 4]) {
    const d = legendDifficulty(n);
    ok(d.id === 'legend' && d.enemyHp > nm.enemyHp && d.enemyDmg > nm.enemyDmg && d.enemyCount > nm.enemyCount && d.score > nm.score, `${n} players: above Nightmare (hp ${d.enemyHp}, dmg ${d.enemyDmg}, count ${d.enemyCount})`);
    ok(d.enemyHp === legendTuning.hp[n] && d.enemyDmg === legendTuning.dmg[n], `${n} players use their tuning row`);
  }
  ok(legendDifficulty(8).enemyHp === legendTuning.hp[4] && legendDifficulty(1).enemyHp === legendTuning.hp[2], 'more than 4 use the 4-player row; fewer than 2 use the 2-player row');
  ok(legendDifficulty(3) !== legendDifficulty(3) && DIFF_BY_ID.legend.enemyHp === legendTuning.hp[2], 'fresh defs; the base def is the 2-player row');
  ok(legendAllowed(2, 'coop', false) && !legendAllowed(1, 'coop', false) && !legendAllowed(3, 'pvp', false) && !legendAllowed(3, 'versus', false) && !legendAllowed(3, 'coop', true), 'LEGEND only in co-op with 2+ players');
}

// ---- Titles and achievements
{
  ok(COOP_ACHIEVEMENTS.every((a) => ACHIEVEMENTS.includes(a)), 'co-op achievements are in the achievements list');
  ok(new Set(ACHIEVEMENTS.map((a) => a.id)).size === ACHIEVEMENTS.length, 'achievement ids stay unique');
  ok(bestTitle([]) === null && bestTitle(['stage_2']) === null, 'no co-op achievements, no title');
  ok(bestTitle(['co_gift', 'co_patron', 'co_buddy'])?.id === 'co_patron', 'the highest-ranked title wins');
  ok(bestTitle(['co_mythic', 'co_legend'])?.title === 'MYTHIC', 'MYTHIC beats LEGEND');
  ok(titleOf('co_pool')?.title === 'FUNDRAISER' && titleOf('<b>x</b>') === null && titleOf(5) === null, 'titles from the network: known ids only');
}

// ---- Controls
ok(ACTIONS.some((a) => a.id === 'trade') && binds.trade[0] === 'KeyY', 'TRADE is a rebindable action on Y');

console.log('trading: pure checks done');
