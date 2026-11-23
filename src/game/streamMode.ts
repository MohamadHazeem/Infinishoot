import { loadJson, saveJson } from '../core/storage';
import type { Game } from './game';
import { worldEventOf } from './systems/worldEvents';

export interface StreamSettings {
  enabled: boolean;
  channel: string;
}
const store = 'streamMode.v1';
export function channelName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase().replace(/^#/, '') : '';
  return /^[a-z0-9_]{1,25}$/.test(s) ? s : '';
}
export function streamSettings(raw: unknown = loadJson(store, {})): StreamSettings {
  const s = raw as Partial<StreamSettings> | null;
  return { enabled: s?.enabled === true, channel: channelName(s?.channel) };
}

export const choices = ['goldrush', 'meteors', 'magnet'] as const;
type Choice = (typeof choices)[number];
export const streamTuning = { period: 75, ballot: 20, maxVoters: 2000 };
export class ChatBallot {
  seconds = 0;
  counts = [0, 0, 0];
  revision = 0;
  private voters = new Set<string>();
  open(): void {
    this.clear();
    this.seconds = streamTuning.ballot;
  }
  clear(): void {
    this.seconds = 0;
    this.counts.fill(0);
    this.voters.clear();
    this.revision++;
  }
  vote(login: string, choice: number): void {
    if (
      this.seconds <= 0 ||
      choice < 0 ||
      choice >= choices.length ||
      !Number.isInteger(choice) ||
      this.voters.size >= streamTuning.maxVoters ||
      this.voters.has(login)
    )
      return;
    this.voters.add(login);
    this.counts[choice]++;
    this.revision++;
  }
  winner(): Choice | null {
    const max = Math.max(...this.counts);
    const i = this.counts.indexOf(max);
    return max > 0 && i === this.counts.lastIndexOf(max) ? choices[i] : null;
  }
}

export function chatCommand(line: string, channel: string) {
  if (line.length > 2048) return null;
  const m =
    /^(?:@[^ ]+ )?:([a-z0-9_]{1,25})![^ ]+ PRIVMSG #([a-z0-9_]{1,25}) :(!help|(?:!vote )?[123])\s*$/i.exec(
      line,
    );
  if (!m || m[2].toLowerCase() !== channel) return null;
  return { login: m[1].toLowerCase(), command: m[3].toLowerCase() };
}

export class StreamMode {
  settings = streamSettings();
  ballot = new ChatBallot();
  status: 'off' | 'joining' | 'live' | 'retry' = 'off';
  help = 0;
  result: Choice | 'tie' | null = null;
  resultTime = 0;
  private pending: Choice | null = null;
  private untilPoll = streamTuning.period;
  private retry = 0;
  private backoff = 5;
  private handshake = 0;
  private socket: WebSocket | null = null;
  private accept = false;
  private preview = false;
  private budget = 0;
  private windowEnd = 0;
  private nextHelp = 0;
  constructor(private connect = () => new WebSocket('wss://irc-ws.chat.twitch.tv:443')) {}
  configure(raw: StreamSettings): void {
    this.reset();
    this.settings = streamSettings(raw);
    saveJson(store, this.settings);
  }
  reset(): void {
    this.close();
    this.untilPoll = streamTuning.period;
    this.help = this.resultTime = this.retry = this.nextHelp = 0;
    this.result = this.pending = null;
    this.backoff = 5;
    this.preview = this.accept = false;
    this.ballot.clear();
  }
  /** Recorded ballot for the screenshot link. Never connects or saves a channel. */
  previewPoll(): void {
    this.reset();
    this.preview = true;
    this.status = 'live';
    this.ballot.open();
    this.ballot.vote('pilot1', 0);
    this.ballot.vote('pilot2', 1);
    this.ballot.vote('pilot3', 1);
  }
  private close(): void {
    const ws = this.socket;
    this.socket = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      ws.close();
    }
    this.status = 'off';
  }
  private lost(): void {
    this.close();
    this.ballot.clear();
    this.pending = null;
    this.retry = this.backoff;
    this.backoff = Math.min(120, this.backoff * 2);
    this.status = 'retry';
  }
  private join(): void {
    try {
      const ws = (this.socket = this.connect());
      this.status = 'joining';
      this.handshake = 15;
      ws.onopen = () => {
        // Twitch's read-only guest convention. No account or token is requested.
        const random = crypto.getRandomValues(new Uint32Array(1))[0];
        ws.send('NICK justinfan' + (100000 + (random % 90000000)) + '\r\n');
      };
      ws.onmessage = ({ data }) => {
        if (typeof data !== 'string' || data.length > 65536) return;
        const now = performance.now();
        if (now >= this.windowEnd) {
          this.budget = 160;
          this.windowEnd = now + 1000;
        }
        for (const line of data.split('\r\n', 256)) {
          if (this.socket !== ws) return;
          if (line.startsWith('PING ')) ws.send('PONG ' + line.slice(5, 200) + '\r\n');
          else if (/^:\S+ 001 /.test(line)) ws.send('JOIN #' + this.settings.channel + '\r\n');
          else if (/^:\S+ 366 /.test(line) && line.split(' ')[3] === '#' + this.settings.channel) {
            this.status = 'live';
            this.backoff = 5;
          } else if (/^:\S+ (?:RECONNECT|NOTICE \* :Login authentication failed)/.test(line))
            this.lost();
          else if (this.status === 'live' && this.accept && this.budget > 0) {
            this.budget--;
            const message = chatCommand(line, this.settings.channel);
            if (!message) continue;
            if (message.command === '!help') {
              if (now >= this.nextHelp) {
                this.help = 8;
                this.nextHelp = now + 15000;
              }
            } else this.ballot.vote(message.login, Number(message.command.slice(-1)) - 1);
          }
        }
      };
      ws.onerror = ws.onclose = () => this.lost();
    } catch {
      this.lost();
    }
  }
  /** Connection lifecycle continues through menus. Only fight updates advance elections. */
  session(g: Game, dt: number): void {
    if (!this.preview && (!this.settings.enabled || !this.settings.channel)) return;
    const eligible =
      g.role !== 'client' &&
      !g.pvp &&
      !g.race &&
      !g.meta.week &&
      !g.onboarding.training &&
      (g.runMode === 'standard' || g.runMode === 'endless') &&
      g.mode !== 'title' &&
      g.mode !== 'dead';
    if (!eligible) {
      if (this.status !== 'off') this.reset();
      return;
    }
    this.accept =
      g.mode === 'fight' && !g.paused && g.screens.current === 'none' && !g.photo?.active;
    if (this.preview) return;
    if (this.status === 'joining' && (this.handshake -= dt) <= 0) this.lost();
    if (!this.socket && (this.retry -= dt) <= 0) this.join();
  }
  fight(g: Game, dt: number): void {
    if (this.status !== 'live' || !this.accept || g.role === 'client') return;
    this.help = Math.max(0, this.help - dt);
    this.resultTime = Math.max(0, this.resultTime - dt);
    if ((this.untilPoll -= dt) <= 0) {
      this.untilPoll = streamTuning.period;
      this.ballot.open();
    }
    if (this.ballot.seconds > 0 && (this.ballot.seconds -= dt) <= 0) {
      const winner = this.ballot.winner();
      this.result = winner ?? (this.ballot.counts.some(Boolean) ? 'tie' : null);
      if (!this.preview && winner) this.pending = winner;
      this.resultTime = 5;
      this.ballot.clear();
    }
    if (!this.pending || g.director.bossSpawned || g.runEvents.event) return;
    const live = worldEventOf(g);
    if (live && !live.done) return;
    if (this.pending === 'magnet') {
      g.pickups.vacuum = true;
      g.vfx.banner('MAGNET BURST!', 'ALL GEMS INCOMING', 1.4);
    } else g.runEvents.forceEvent(this.pending);
    this.pending = null;
  }
}
