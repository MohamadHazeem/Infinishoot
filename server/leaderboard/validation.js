// Bound the stream before JSON.parse: Content-Length may be missing or dishonest.
export async function readBody(req, limit = 4096) {
  if (Number(req.headers.get('Content-Length')) > limit) throw Object.assign(new Error('too big'), { status: 413 });
  const reader = req.body?.getReader();
  if (!reader) throw new Error('bad json');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw Object.assign(new Error('too big'), { status: 413 });
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('bad json');
  return body;
}

// Deliberately generous: reject non-finite / unsafe numbers and impossible kill rates,
// without claiming to verify gameplay that runs on an untrusted player's machine.
export function saneRun(score, stage, kills, time) {
  return Number.isSafeInteger(score) && score > 0 && Number.isInteger(stage) && stage >= 1 && stage < 200
    && Number.isSafeInteger(kills) && kills >= 0 && Number.isFinite(time) && time > 0 && time < 86400
    && kills <= 1000 + time * 20000;
}

// Cheap burst protection for reads and malformed requests; bounded per isolate, not global.
// Durable per-route posting cooldowns still live in KV (also best-effort: KV is eventual).
export function burstLimiter() {
  const buckets = new Map();
  return (ip, now = Date.now()) => {
    let bucket = buckets.get(ip);
    if (!bucket || now >= bucket.until) {
      if (buckets.size >= 4096) buckets.delete(buckets.keys().next().value);
      bucket = { until: now + 60000, count: 0 };
      buckets.set(ip, bucket);
    }
    return ++bucket.count <= 120;
  };
}
