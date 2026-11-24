// One indexed D1 row per run makes concurrent finishes and retries independent.
// Store only an opaque run receipt and game results. No player or device identifier.
const ready = new WeakMap();
async function table(db) {
  if (!ready.has(db))
    ready.set(
      db,
      db.batch([
        db.prepare(
          'CREATE TABLE IF NOT EXISTS mastery_runs (board TEXT, id TEXT, stage INTEGER, score INTEGER, ms INTEGER, PRIMARY KEY(board,id)) WITHOUT ROWID',
        ),
        db.prepare('CREATE INDEX IF NOT EXISTS mastery_fast ON mastery_runs(board,ms,id)'),
        db.prepare(
          'CREATE INDEX IF NOT EXISTS mastery_high ON mastery_runs(board,score DESC,stage DESC,ms,id)',
        ),
      ]),
    );
  try {
    await ready.get(db);
  } catch (e) {
    ready.delete(db);
    throw e;
  }
}
export async function hexDigest(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}
export async function limited(req, kv, mode) {
  const minute = Math.floor(Date.now() / 60000);
  const hash = await hexDigest(
    new TextEncoder().encode(
      [minute, mode, req.headers.get('CF-Connecting-IP') ?? 'local'].join('|'),
    ),
  );
  const key = 'mastery:limit:' + hash;
  if (await kv.get(key)) return true;
  await kv.put(key, '1', { expirationTtl: 60 });
  return false;
}
export async function list(db, board) {
  await table(db);
  const order = board === 'hardcore' ? 'score DESC, stage DESC, ms, id' : 'ms, id';
  return (
    await db
      .prepare(
        'SELECT id,stage,score,ms FROM mastery_runs WHERE board=? ORDER BY ' + order + ' LIMIT 10',
      )
      .bind(board)
      .all()
  ).results;
}
export async function insert(db, board, r) {
  await table(db);
  await db
    .prepare('INSERT OR IGNORE INTO mastery_runs(board,id,stage,score,ms) VALUES(?,?,?,?,?)')
    .bind(board, r.id, r.stage, r.score, r.ms)
    .run();
}
