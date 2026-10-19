/**
 * An in-memory stand-in for a Cloudflare KV namespace (get / put with
 * expirationTtl and metadata / delete / list with prefix), so the worker's
 * routes run in Node. `clock` drives expiry (tests move it forward).
 */
export class FakeKV {
  clock = () => Date.now();
  writes = 0;
  private map = new Map<string, { value: string; exp: number; metadata?: unknown }>();

  private live(k: string) {
    const e = this.map.get(k);
    if (!e) return null;
    if (e.exp && e.exp <= this.clock()) {
      this.map.delete(k);
      return null;
    }
    return e;
  }

  async get(k: string, type?: string): Promise<unknown> {
    const e = this.live(k);
    if (!e) return null;
    return type === 'json' ? JSON.parse(e.value) : e.value;
  }

  async put(k: string, v: string, o: { expirationTtl?: number; metadata?: unknown } = {}): Promise<void> {
    this.writes++;
    this.map.set(k, { value: String(v), exp: o.expirationTtl ? this.clock() + o.expirationTtl * 1000 : 0, metadata: o.metadata });
  }

  async delete(k: string): Promise<void> {
    this.map.delete(k);
  }

  async list(o: { prefix?: string; cursor?: string; limit?: number } = {}): Promise<{ keys: { name: string; metadata?: unknown }[]; list_complete: boolean; cursor?: string }> {
    const names = [...this.map.keys()].filter((k) => k.startsWith(o.prefix ?? '') && this.live(k)).sort();
    const start = o.cursor ? Number(o.cursor) : 0;
    const limit = o.limit ?? 1000;
    const page = names.slice(start, start + limit);
    const done = start + limit >= names.length;
    return { keys: page.map((name) => ({ name, metadata: this.map.get(name)!.metadata })), list_complete: done, cursor: done ? undefined : String(start + limit) };
  }
}

/** A fetch() that calls the worker in-process. */
export function workerFetch(worker: { fetch(req: Request, env: unknown): Promise<Response> }, env: unknown, ip = () => '1.2.3.4') {
  return (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set('CF-Connecting-IP', ip());
    return worker.fetch(new Request(url, { ...init, headers }), env);
  };
}
