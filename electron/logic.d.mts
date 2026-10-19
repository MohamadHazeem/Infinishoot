export const RELEASES: string;
export const LOG_LIMIT: number;
export interface Release { version: string; url: string; }
export interface LogEntry { time: string; kind: string; message: string; }
export function availableRelease(current: string, release: unknown): Release | null;
export function cleanText(value: unknown): string;
export class LogRing {
  entries: LogEntry[];
  constructor(entries?: unknown);
  add(kind: string, message: unknown, time?: string): void;
  text(context: unknown): string;
}
export interface DisplayOptions { windowMode: 'windowed' | 'fullscreen' | 'borderless'; resolutionScale: number; frameCap: '30' | '60' | '120' | 'unlimited'; vsync: boolean; autoUpdate: boolean; }
export function displayOptions(raw?: Partial<DisplayOptions>): DisplayOptions;
