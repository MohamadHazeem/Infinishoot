// These functions can also be passed to an already running headless Playwright browser.
export function installClock(seed) {
  // End the boot shell's native paint waits normally. Once the test link has the
  // engine, its ordinary GameLoop and delayed test cues advance on our clock.
  const nativeFrame = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  const frames = new Map();
  const timers = new Map();
  let serial = 0, tick = 0, now = 0;
  Math.random = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  performance.now = () => now;
  window.requestAnimationFrame = cb => {
    if (!window.__game) return nativeFrame(cb);
    frames.set(--serial, cb);
    return serial;
  };
  window.cancelAnimationFrame = id => id < 0 ? frames.delete(id) : nativeCancel(id);
  function schedule(cb, delay, repeat, args) {
    const interval = Math.max(1, Number(delay) || 0);
    timers.set(--serial, { cb, args, at: now + interval, interval, repeat });
    return serial;
  }
  window.setTimeout = (cb, delay, ...args) => schedule(cb, delay, false, args);
  window.setInterval = (cb, delay, ...args) => schedule(cb, delay, true, args);
  window.clearInterval = window.clearTimeout = id => timers.delete(id);
  // Pause DOM animations at their authored start, then seek them in edit time.
  const starts = new WeakMap();
  window.captureTick = () => {
    now = ++tick * (1000 / 60);
    for (const [id, timer] of timers) {
      if (timer.at > now + 1e-7) continue;
      if (timer.repeat) timer.at += timer.interval;
      else timers.delete(id);
      timer.cb(...timer.args);
    }
    const pending = Array.from(frames);
    for (const [id, cb] of pending) {
      if (frames.delete(id)) cb(now);
    }
    for (const animation of document.getAnimations()) {
      if (!starts.has(animation)) {
        starts.set(animation, now);
        animation.pause();
      }
      animation.currentTime = now - starts.get(animation);
    }
  };
  localStorage.setItem('infinishoot.settings.v1', JSON.stringify({
    tips: false, showFps: false, highlightClips: false, cinematics: 'full', dynamicCamera: true,
  }));
}

function setCamera(shot) {
  const game = window.__game;
  // Starting a couch session loads a new stage after the benchmark link's XP hold.
  game.xpNext = 1e12;
  const follow = shot.camera === 'follow';
  // Suppress the press of a virtual stick while composing the portrait or a
  // boss entrance. The stock circle link also distinguishes profiling from crafting.
  if (['scene', 'glide', 'duel', 'photo'].includes(shot.camera)) {
    const poll = game.input.poll.bind(game.input);
    game.input.poll = () => {
      game.input.virtual.move.x = 0;
      game.input.virtual.move.y = 0;
      poll();
    };
  }
  const style = document.createElement('style');
  style.textContent = follow
    ? '#stats,#reticle,#ft-goals,#banner,#toast,#navhint{visibility:hidden!important}'
    : '#hud,#hud *,#reticle,.px-bit,#vc-self{visibility:hidden!important} #hud .cine-shot,#hud .cine-shot *,#hud #cine,#hud #cine *{visibility:visible!important} #hud .cine-strip button,#hud #cine .cn-skip{visibility:hidden!important}';
  document.head.append(style);
  // Keep the shipping entrance, evolution and knockout camera cuts intact.
  const tracks = {
    chase: [[7, 7, 11], [-4, 8, 14], 46, 48],
    wide: [[11, 17, 19], [-5, 19, 20], 53, 55],
    glide: [[12, 10, 14], [-8, 9, 12], 50, 44],
    duel: [[12, 10, 16], [-5, 8, 16], 49, 44],
  };
  const track = tracks[shot.camera];
  let frame = -shot.preroll;
  if (track) {
    const [a, b, fovA, fovB] = track;
    const camera = game.cam.camera;
    const editorial = camera.clone();
    const rig = new window.CaptureCamera.CinematicCamera(editorial);
    const target = [0, shot.camera === 'duel' ? 2 : 1, 0];
    rig.play([{ time: 0, position: a, target, fov: fovA },
      { time: (shot.frames - 1) / 60, position: b, target, fov: fovB }]);
    const renderer = window.__renderer;
    const draw = renderer.render.bind(renderer);
    renderer.render = scene => {
      // Keep combat projection independent of the editorial camera.
      const { x, z } = (shot.camera === 'duel' && game.boss) || game.player;
      rig.seek(Math.max(frame, 0) / 60);
      editorial.position.x += x; editorial.position.z += z;
      editorial.updateMatrixWorld();
      return draw(scene, editorial);
    };
  }
  window.captureFrame = () => {
    if (shot.camera === 'photo' && game.photo?.active) {
      game.photo.configure({ yaw: .3 + .95 * Math.max(0, frame) / shot.frames });
    }
    window.captureTick();
    frame++;
  };
}

export async function captureShot(browser, base, shot, cameraSource, save, selectsOnly = false) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block' });
  try {
    const origin = new URL(base).origin;
    await context.route(/^https?:/, route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.clock.setFixedTime(new Date('2026-11-24T12:00:00Z'));
    const url = new URL(shot.link, base);
    await page.addInitScript(installClock, Number(url.searchParams.get('seed')));
    await page.goto(url.href, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.__game && !!window.__renderer, null, { polling: 25 });
    await page.addScriptTag({ content: cameraSource });
    await page.evaluate(setCamera, shot);
    for (let n = -shot.preroll; n < shot.frames; n++) {
      await page.evaluate(() => window.captureFrame());
      if (n === -shot.preroll + 40 && shot.camera === 'photo') {
        await page.waitForFunction(() => window.__game.photo?.active, null, { polling: 25 });
      }
      if (n === -1) await page.evaluate(() => document.fonts.ready.then(() => undefined));
      if (errors.length) throw Error(shot.id + ': ' + errors.join('\n'));
      if (n >= 0 && (!selectsOnly || shot.selects.includes(n))) await save(page, shot, n);
    }
  } finally {
    await context.close();
  }
}
