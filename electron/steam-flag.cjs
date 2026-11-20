// Desktop startup and SteamPipe share the same unsigned 32-bit App ID check.
function appId(value) {
  const s = String(value ?? '').trim();
  return /^[1-9]\d{0,9}$/.test(s) && Number(s) <= 0xffffffff ? Number(s) : null;
}
function configuredId(env, readFile) {
  if (env.STEAM_APP_ID !== undefined) return appId(env.STEAM_APP_ID);
  try { return appId(readFile()); } catch { return null; }
}
module.exports = { appId, configuredId };
