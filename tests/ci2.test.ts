import { ok } from './check';
import { Tape, CHUNK, parseReplay, REPLAY_VERSION, hashNumber, outsideTolerance } from '../src/dev/replay';
const tape = new Tape();
for (let i = 0; i < CHUNK + 27; i++) tape.push(i / 60);
const restored = Tape.from(JSON.parse(JSON.stringify(tape.json())));
ok(restored.length === tape.length && restored.at(CHUNK + 26) === tape.at(CHUNK + 26), 'chunk boundaries round-trip exact numeric inputs');
let threw = false; try { restored.at(restored.length); } catch { threw = true; }
ok(threw, 'truncated replay fails instead of reading undefined');
const sample = { version: REPLAY_VERSION, header: { seed: 42 }, strings: ['KeyQ'], data: tape.json(), steps: 60, complete: true };
ok(parseReplay(JSON.stringify(sample)).steps === 60, 'versioned replay parses');
for (const bad of [{ ...sample, version: 999 }, { ...sample, data: [[null]] }, { ...sample, steps: -1 }, { ...sample, strings: [42] }]) {
  threw = false; try { parseReplay(JSON.stringify(bad)); } catch { threw = true; }
  ok(threw, 'invalid replay is rejected');
}
ok(hashNumber(42, 100) !== hashNumber(42, 100.001), 'checksum detects simulation changes');
ok(hashNumber(42, 1 / 60) === hashNumber(42, JSON.parse(JSON.stringify(1 / 60))), 'checksum stable through JSON');
ok(!outsideTolerance(120, 100) && outsideTolerance(126, 100), 'balance tolerance accepts noise and rejects large swings');
ok(outsideTolerance(NaN, 100) && !outsideTolerance(3, 0), 'balance rejects invalid metrics and handles low baselines');
