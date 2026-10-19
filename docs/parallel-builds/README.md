# Parallel builds

How the big updates (v1.5.0, v1.6.0) were built: 10-11 AI builders at once, each in its own git worktree with its own files, then merged into `main` by one lead. This folder keeps the briefs so the next batch can reuse them.

## Files
- `v1.5/`, `v1.6/`: the briefs each builder got. `_common.md` holds the shared rules (file ownership, co-op sync, performance, required checks, notes to write); every other file is one lane's task. A builder's full brief is `_common.md` (with `<LANE>` replaced by the lane name) followed by its lane file.
- `../../scripts/merge-union.py`: merge helper. `python3 scripts/merge-union.py <files...>` resolves git conflict blocks by keeping both sides (ours first) and merges string-union types such as `type ToggleKey = 'a' | 'b';`. Use it only where both sides simply added lines (imports, system fields, settings, test links), and read every result: a block that ends mid-function needs a closing brace added by hand.
- What each lane actually built, with numbers and open risks: `notes/lanes/<lane>.md`.

## Running a batch
1. Write the lane files: one goal per lane, a numbered build list and an **Owns:** line naming its files. Keep shared files (game.ts, hero.ts, hud.ts, screens.ts, style.css, settings.ts) to small additive edits.
2. One worktree per lane, branched from `main`:
   ```
   git worktree add ../wt/<lane> -b lane/<lane> main
   cp -Rc node_modules ../wt/<lane>/node_modules   # APFS clone, instant
   { sed "s/<LANE>/<lane>/g" docs/parallel-builds/vX/_common.md; echo; cat docs/parallel-builds/vX/<lane>.md; } > ../wt/<lane>/.lane-brief.md
   ```
3. Start the builders, each in its worktree, with the brief as its prompt:
   - Claude Code (second account): `CLAUDE_CONFIG_DIR=~/.claude-account2 claude -p "$(cat .lane-brief.md)" --permission-mode bypassPermissions`
   - Codex: `codex exec --dangerously-bypass-approvals-and-sandbox -C ../wt/<lane> "$(cat ../wt/<lane>/.lane-brief.md)"`
   - Claude sub-agents from the lead session, pointed at the worktree and its brief.
4. Merge each lane as it finishes: `git merge --no-ff lane/<lane>`, resolve clashes, then all of `npm run typecheck`, `npx vite build` (catches broken CSS joins), `npm test`, `npm run smoke`, plus `npm run coop` for anything networked and `npm run bench` for per-frame work, and a screenshot with `npm run shot`. Push, then `git worktree remove ../wt/<lane>` and delete the branch.

## Lessons
- Clashes concentrate in test links, settings toggles, `game.ts` system fields and `screens.ts` toggle types: union them.
- New content must be registered in other lanes' tables after merging (enemy materials, animation gaits, music stems for new weapons).
- Shared numbering (bullet kinds) and bit fields (the enemy record in `src/net/codec.ts`) need checking at merge; `tests/netCodec.test.ts` guards the bit fields.
- The coop test's turret scenario is occasionally flaky (passes on rerun).
