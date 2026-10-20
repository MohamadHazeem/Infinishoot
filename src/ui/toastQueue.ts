/**
 * Toast queue (uipolish lane). `Hud.toast` used to replace the toast on the
 * spot, so a burst (FIRST STEPS tick + achievement + elite) flashed past
 * unread, and a toast could land on top of a big title card (STAGE 2, a boss
 * intro, NIGHT RAID). Now toasts wait in a short queue: one shows at a time
 * for at least `minShow` seconds when others are waiting, and nothing new
 * shows while a title card is up (`blocked`). Repeats of the showing or a
 * waiting message are dropped; the oldest waiting toast drops when full.
 */
export const toastTuning = {
  /** A toast with others waiting still shows at least this long (s). */
  minShow: 1.2,
  /** Waiting toasts kept at most (the oldest is dropped). */
  maxQueue: 4,
  /** A waiting toast is dropped after this long (s): stale news. */
  maxWait: 12,
};

export interface QueuedToast { msg: string; seconds: number; waited: number }

export class ToastQueue {
  readonly waiting: QueuedToast[] = [];
  /** The message on screen ('' when none) and how long it has shown. */
  current = '';
  shownFor = 0;
  left = 0;

  /** Add a toast; returns it when it may show right now (nothing showing, not blocked), else queues it. */
  push(msg: string, seconds: number, blocked: boolean): QueuedToast | null {
    if (msg === this.current && this.left > 0) {
      this.left = Math.max(this.left, seconds); // the same news again: keep it up, don't flash it
      return null;
    }
    if (this.waiting.some((w) => w.msg === msg)) return null;
    const t: QueuedToast = { msg, seconds, waited: 0 };
    if (!blocked && this.left <= 0 && !this.waiting.length) return this.show(t);
    this.waiting.push(t);
    if (this.waiting.length > toastTuning.maxQueue) this.waiting.shift();
    return null;
  }

  /** Advance by dt; returns the next toast to show now, or null. `left` <= 0 means the shown toast should hide. */
  update(dt: number, blocked: boolean): QueuedToast | null {
    if (this.left > 0) {
      this.left -= dt;
      this.shownFor += dt;
      if (this.left <= 0) this.current = '';
    }
    for (let i = this.waiting.length - 1; i >= 0; i--) {
      this.waiting[i].waited += dt;
      if (this.waiting[i].waited > toastTuning.maxWait) this.waiting.splice(i, 1);
    }
    if (blocked || !this.waiting.length) return null;
    if (this.left > 0 && this.shownFor < toastTuning.minShow) return null;
    return this.show(this.waiting.shift()!);
  }

  private show(t: QueuedToast): QueuedToast {
    this.current = t.msg;
    this.left = t.seconds;
    this.shownFor = 0;
    return t;
  }
}

/** Title cards that toasts must not cover: the big banner, the boss intro letterbox, cinematic reveals. */
const TITLE_CARDS = '#banner.show, #bossintro:not([hidden]), .cn-reveal:not([hidden]), .cinematic';

/** True while a big title card is on screen (DOM check; call only when a toast is waiting). */
export function titleCardUp(): boolean {
  if (typeof document === 'undefined') return false;
  for (const el of document.querySelectorAll<HTMLElement>(TITLE_CARDS)) {
    if (typeof el.checkVisibility !== 'function' || el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return true;
  }
  return false;
}
