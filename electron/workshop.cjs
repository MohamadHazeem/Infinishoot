// Only Steam supplies install paths. The renderer supplies a kind and content, never a path or URL.
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const kinds = { pack: { file: 'pack.json', max: 524288 }, arena: { file: 'arena.txt', max: 8192 } };

function workshopFor(client, appId) {
  const ugc = client.workshop;
  if (typeof client.overlay?.activateToWebPage !== 'function' || !ugc || !['getSubscribedItems', 'installInfo', 'createItem', 'updateItem'].every(k => typeof ugc[k] === 'function')) return null;
  let publishing = false;
  // Reuse an unfinished native item when the same draft is retried during this session.
  const pending = new Map();
  return {
    browse() { client.overlay?.activateToWebPage?.('https://steamcommunity.com/app/' + appId + '/workshop/'); },
    async list() {
      const items = [];
      let bytes = 0;
      for (const id of ugc.getSubscribedItems().slice(0, 32)) {
        const folder = ugc.installInfo(id)?.folder;
        if (!folder) continue;
        for (const [kind, { file, max }] of Object.entries(kinds)) {
          let handle;
          try {
            const full = path.join(folder, file);
            if (!(await fs.lstat(full)).isFile()) continue;
            handle = await fs.open(full, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
            const stat = await handle.stat();
            if (!stat.isFile() || stat.size > max || stat.size + bytes > 4 * 1024 * 1024) continue;
            const buffer = Buffer.alloc(stat.size + 1);
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
            if (bytesRead !== stat.size) continue;
            const raw = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead));
            items.push({ id: String(id), kind, raw });
            bytes += bytesRead;
          } catch { /* Steam may still be downloading or removing this subscription. */ }
          finally { await handle?.close(); }
        }
      }
      return items;
    },
    async publish(kind, title, raw) {
      if (publishing || !Object.hasOwn(kinds, kind) || typeof title !== 'string' || !title.trim() || title.length > 128 ||
          typeof raw !== 'string' || Buffer.byteLength(raw) > kinds[kind].max) throw Error('Invalid Workshop item');
      if (kind === 'pack') JSON.parse(raw);
      else if (!/^ISA1z?\.[A-Za-z0-9_-]+$/.test(raw)) throw Error('Invalid arena');
      publishing = true;
      let folder;
      try {
        folder = await fs.mkdtemp(path.join(os.tmpdir(), 'infinishoot-ugc-'));
        await fs.writeFile(path.join(folder, kinds[kind].file), raw);
        const key = kind + '/' + title;
        const draft = pending.get(key) ?? await ugc.createItem(appId);
        pending.set(key, draft);
        const result = await ugc.updateItem(draft.itemId, { title, contentPath: folder, tags: [kind === 'pack' ? 'Mod pack' : 'Arena'], visibility: 2 }, appId);
        pending.delete(key);
        client.overlay?.activateToWebPage?.('https://steamcommunity.com/sharedfiles/filedetails/?id=' + draft.itemId);
        return draft.needsToAcceptAgreement || result.needsToAcceptAgreement ? 'agreement' : 'published';
      } finally {
        publishing = false;
        if (folder) await fs.rm(folder, { recursive: true, force: true });
      }
    },
  };
}
module.exports = { workshopFor };
