// Exercise the public Worker routes with easy, assist and normal data in the same KV.
import assert from 'node:assert/strict';
import worker from '../server/leaderboard/worker.js';
import { FakeKV, workerFetch } from './fakeKv';

const base = 'https://worker.example';
let ip = 0;
const call = workerFetch(worker, { SCORES: new FakeKV() }, () => 'test-' + ++ip);
const cases = [
  { difficulty: 'easy', code: 'ABCDE', score: 100 },
  { difficulty: 'assist', code: 'FGHJK', score: 200 },
  { difficulty: 'normal', code: 'LMNPQ', score: 300 },
];
async function post(path: string, body: object) {
  const result = await call(base + path, { method: 'POST', body: JSON.stringify(body) });
  assert.equal(result.status, 200, path);
}
async function get(path: string) {
  const result = await call(base + path);
  assert.equal(result.status, 200, path);
  return result.json();
}

for (const { difficulty, code, score } of cases) {
  await post('/lobbies', { code, token: 'testhost123', name: 'Host', players: 1, max: 2, mode: 'coop', difficulty, region: 'EU', version: '2.0.1' });
  await post('/scores', { board: 'standard-' + difficulty, name: 'Player', score, stage: 1, kills: 20, time: 60 });
}
for (const { difficulty, code, score } of cases) {
  const { lobbies } = await get('/lobbies?difficulty=' + difficulty);
  assert.equal(lobbies.length, 1);
  assert.equal(lobbies[0].code, code);
  assert.equal(lobbies[0].difficulty, difficulty);
  const { scores } = await get('/scores?board=standard-' + difficulty);
  assert.equal(scores.length, 1);
  assert.equal(scores[0].score, score);
}
