// Main process only. The optional native library is required inside the flag gate.
const fs = require('node:fs');
const path = require('node:path');
const names = require('./steam-achievements.json');

function connectCode(arg) {
  return typeof arg === 'string' ? /^\?join=([A-HJ-NP-Z2-9]{5})$/.exec(arg)?.[1] ?? null : null;
}
function startSteam(id, load, onJoin, onOverlay, report) {
  if (!id) return null;
  let binding, initialized = false;
  try {
    binding = load();
    const client = binding.init(id);
    initialized = true;
    // The game repaints continuously. Keep Shift+Tab and focus under Steam's control.
    binding.electronEnableSteamOverlay(true);
    const pending = new Set();
    function flush() {
      for (const name of pending) {
        if (client.achievement.isActivated(name) || client.achievement.activate(name)) pending.delete(name);
      }
    }
    const callbacks = binding.SteamCallback;
    const join = (arg) => { const code = connectCode(arg); if (code) onJoin(code); };
    // The official steamworks.js (0.4.0) lacks some callbacks (e.g. the warm rich-presence join): register only
    // the ones this build exposes. Without the warm join, a friend's "Join game" still works when Steam launches
    // the game (launch command line), and the invite code always works.
    const on = (cb, fn) => (cb === undefined ? null : client.callback.register(cb, fn));
    const launchLine = () => (typeof client.apps?.launchCommandLine === 'function' ? client.apps.launchCommandLine() : '');
    const handles = [
      on(callbacks?.GameRichPresenceJoinRequested, ({ connect }) => join(connect)),
      on(callbacks?.NewUrlLaunchParameters, () => join(launchLine())),
      on(callbacks?.GameOverlayActivated, ({ active }) => onOverlay(active)),
      on(callbacks?.UserStatsReceived, flush),
      on(callbacks?.SteamServersConnected, flush),
    ].filter(Boolean);
    join(launchLine() || process.argv.join(' '));
    return {
      account: String(client.localplayer.getSteamId().accountId),
      deck: client.utils.isSteamRunningOnSteamDeck(),
      unlock(ids) {
        if (!Array.isArray(ids)) return;
        for (const id of ids) if (typeof id === 'string' && Object.hasOwn(names, id)) pending.add(names[id]);
        flush();
      },
      presence(status, code) {
        if (typeof status !== 'string' || Buffer.byteLength(status) > 255 || /[\x00-\x1f]/.test(status)) return;
        client.localplayer.setRichPresence('status', status);
        client.localplayer.setRichPresence('steam_display', '#Playing');
        client.localplayer.setRichPresence('connect', connectCode('?join=' + code) ? '?join=' + code : null);
      },
      close() {
        for (const handle of handles) handle.disconnect();
        binding.shutdown?.();
      },
    };
  } catch (error) {
    if (initialized) binding.shutdown?.();
    report(error);
    return null;
  }
}
const cloudKeys = ['save', 'highscores.v1', 'daily.v1', 'trials.v1', 'raid.records.v1', 'gauntlet.profile.v1', 'gauntlet.scores.v1', 'gauntlet.splits.v1', 'cine.revealed.v1'];
function validProfile(data) {
  if (!data || data.version !== 1 || !data.records || typeof data.records !== 'object' || Array.isArray(data.records)) return false;
  return Object.entries(data.records).every(([k, v]) => {
    if (!cloudKeys.includes(k) || typeof v !== 'string') return false;
    try {
      const parsed = JSON.parse(v);
      return k !== 'save' || (!!parsed && Number.isInteger(parsed.version) && Array.isArray(parsed.achievements));
    } catch { return false; }
  });
}
function cloudStore(userData, account) {
  if (typeof account !== 'string' || !/^\d{1,10}$/.test(account)) return null;
  const folder = path.join(userData, 'SteamCloud', account);
  const file = path.join(folder, 'profile.json');
  return {
    read() {
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!validProfile(data)) throw new Error('Invalid Steam Cloud profile');
        return data.records;
      } catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
    },
    write(data) {
      if (!validProfile(data)) return false;
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(data));
      fs.renameSync(file + '.tmp', file);
      return true;
    },
  };
}
module.exports = { connectCode, startSteam, cloudStore, cloudKeys };
