import Peer, { type DataConnection } from 'peerjs';
import { hasRelay, iceConfig } from './ice';

/**
 * WebRTC transport via PeerJS. The host registers a peer id derived from a
 * short invite code; clients connect to it directly (browser to browser).
 * PeerJS's free public broker is only used to find each other.
 */
const PREFIX = 'infinishoot-v2-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export function makeCode(): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

type Handler = (from: string, msg: unknown) => void;

/** Host side: accepts up to `max` clients. */
export class NetHost {
  readonly code: string;
  private peer: Peer;
  private conns = new Map<string, DataConnection>();
  onJoin: (id: string) => void = () => {};
  onLeave: (id: string) => void = () => {};
  onMessage: Handler = () => {};
  onError: (msg: string) => void = () => {};
  ready: Promise<void>;

  constructor(private max = 3) {
    this.code = makeCode();
    this.peer = new Peer(PREFIX + this.code, { debug: 0, config: iceConfig() });
    this.ready = new Promise((resolve, reject) => {
      this.peer.on('open', () => resolve());
      this.peer.on('error', (e) => {
        this.onError(friendlyError(e));
        reject(e);
      });
    });
    this.peer.on('connection', (conn) => {
      if (this.conns.size >= this.max) {
        conn.on('open', () => {
          conn.send({ t: 'full' });
          setTimeout(() => conn.close(), 200);
        });
        return;
      }
      conn.on('open', () => {
        this.conns.set(conn.peer, conn);
        this.onJoin(conn.peer);
      });
      conn.on('data', (d) => this.onMessage(conn.peer, d));
      const gone = () => {
        if (this.conns.delete(conn.peer)) this.onLeave(conn.peer);
      };
      conn.on('close', gone);
      conn.on('error', gone);
    });
  }

  get clientIds(): string[] {
    return [...this.conns.keys()];
  }

  send(id: string, msg: unknown): void {
    const c = this.conns.get(id);
    if (c?.open) c.send(msg);
  }

  broadcast(msg: unknown): void {
    for (const c of this.conns.values()) if (c.open) c.send(msg);
  }

  kick(id: string): void {
    this.conns.get(id)?.close();
  }

  close(): void {
    this.broadcast({ t: 'end' });
    setTimeout(() => this.peer.destroy(), 150);
  }
}

/** Client side: one connection to the host. */
export class NetClient {
  private peer: Peer;
  private conn: DataConnection | null = null;
  onMessage: (msg: unknown) => void = () => {};
  onClose: () => void = () => {};
  ready: Promise<void>;

  constructor(code: string) {
    this.peer = new Peer({ debug: 0, config: iceConfig() });
    this.ready = new Promise((resolve, reject) => {
      // Signalling worked but no direct route was found: say so (and point at a relay) instead of a vague timeout.
      let signalled = false;
      const timer = setTimeout(() => reject(new Error(signalled ? noRouteError() : 'Could not reach that game. Check the code and try again.')), 12000);
      this.peer.on('error', (e) => {
        clearTimeout(timer);
        reject(new Error(friendlyError(e)));
      });
      this.peer.on('open', () => {
        const conn = this.peer.connect(PREFIX + normalizeCode(code), { reliable: true });
        this.conn = conn;
        signalled = true;
        (conn as unknown as { on(ev: 'iceStateChanged', fn: (s: string) => void): void }).on('iceStateChanged', (s) => {
          if (s !== 'failed') return;
          clearTimeout(timer);
          reject(new Error(noRouteError()));
        });
        conn.on('open', () => {
          clearTimeout(timer);
          resolve();
        });
        conn.on('data', (d) => this.onMessage(d));
        conn.on('close', () => this.onClose());
        conn.on('error', () => this.onClose());
      });
    });
  }

  send(msg: unknown): void {
    if (this.conn?.open) this.conn.send(msg);
  }

  close(): void {
    this.conn?.close();
    setTimeout(() => this.peer.destroy(), 150);
  }
}

/** The host was found but no network path worked (strict NAT or firewall on one side). */
export function noRouteError(relay = hasRelay()): string {
  return relay
    ? 'Found the game but could not connect, even through the relay. Check the relay settings or try another network.'
    : 'Found the game but could not connect: one of your networks blocks direct connections. Set a CUSTOM RELAY (TURN server) below, or try another network.';
}

function friendlyError(e: unknown): string {
  const type = (e as { type?: string }).type;
  if (type === 'peer-unavailable') return 'No game found with that code.';
  if (type === 'unavailable-id') return 'That code is taken, try hosting again.';
  if (type === 'network' || type === 'server-error' || type === 'socket-error') return 'Could not reach the matchmaking server. Check your internet connection.';
  if (type === 'browser-incompatible') return 'This browser does not support online play.';
  if (type === 'webrtc' || type === 'negotiation-failed') return noRouteError();
  return 'Connection problem. Please try again.';
}
