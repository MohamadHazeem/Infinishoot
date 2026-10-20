/**
 * Undo/redo for the arena editor (editor lane): whole-arena snapshots (an
 * arena is at most a few hundred small pieces, so copies are cheap and simple).
 * `push` records the state *before* a change; a drag that paints many pieces
 * is one step because the editor pushes once when the drag starts.
 */
import type { CustomArena } from './arenaData';

export const HISTORY_MAX = 100;

export function cloneArena(a: CustomArena): CustomArena {
  return { v: 1, name: a.name, size: a.size, pieces: a.pieces.map((p) => ({ ...p })), rules: { ...a.rules, foes: [...a.rules.foes], heat: [...a.rules.heat] } };
}

export class EditHistory {
  private undoStack: CustomArena[] = [];
  private redoStack: CustomArena[] = [];

  /** Remember `before` as an undo point; any redo future is dropped. */
  push(before: CustomArena): void {
    this.undoStack.push(cloneArena(before));
    if (this.undoStack.length > HISTORY_MAX) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /** The state to go back to (given the current one, kept for redo), or null. */
  undo(current: CustomArena): CustomArena | null {
    const prev = this.undoStack.pop();
    if (!prev) return null;
    this.redoStack.push(cloneArena(current));
    return prev;
  }

  redo(current: CustomArena): CustomArena | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(cloneArena(current));
    return next;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
