# Where the 10 gates stand (paused 2026-11-25)

Roadmap: docs/ROADMAP.md. Lane briefs (one per piece of work, plus the shared `_common*.md`): docs/parallel-builds/gates/.

## Branches (all on GitHub)
`main` <- `gates345` <- `gates67` <- `gates8910`; each later branch already contains the earlier ones.

| Gate | State |
|---|---|
| 1, 2 | Merged to `main` (PR #5, PR #6). Online server deployed from `main`. |
| 3-5 | Built on `gates345`, PR #7 open. Before merging: look at the refreshed screenshots (`npm run visual`, shots/visual), then take the Linux baselines from the CI artifact `visual-diffs` into tests/visual/linux. |
| 6 | Built on `gates67` (renderer with AUTO = WebGL2, GPU particles, lighting, cinematics, performance: all 62 bench workloads pass). Missing: `g6-models` (brief in docs/parallel-builds/gates, a design lane). |
| 7 | Built on `gates67` (biome rules, set pieces, campaign, verticality). |
| 8 | Built on `gates8910` (echo/time loop, rhythm, boss maker, roles, community goals and stream mode). |
| 9 | Built on `gates8910` (Ascension and Abyss, mastery/hardcore/speedrun, ranked seasons). |
| 10 | `g10-launch` merged into `gates8910`. `lane/g10-trailer` finished but not reviewed or merged (capture scripts committed; the 2.1 GB of frames were not, re-run the capture scripts). `g10-polish` not started. |

## Next steps
1. Merge PR #7 (Gates 3-5) after the screenshot review.
2. Review and merge `lane/g10-trailer` into `gates8910`.
3. Run `g6-models` (on `gates67`, then merge `gates67` into `gates8910`) and `g10-polish` (on `gates8910`).
4. Final balance pass on `gates8910`: the skilled bot clears Normal 75-85% there (target 40-60%); use 40-run samples (`npm run skillbot -- --difficulty normal --runs 40`).
5. PRs for `gates67` and `gates8910`, then one server redeploy from `main` (`CI=1 npm run server:deploy`: new routes for boss maker, community goals, hardcore, speedrun, replay scores, Abyss, ranked seasons).

## Known open items
- Gate targets that need real players (first-time clear rate, "deaths feel fair", build diversity, playtime, Ascension reach) come from playtest telemetry.
- Tests that fail only on an overloaded machine: host migration, the title-demo save test.
- Launch items only the owner can do: docs/LAUNCH.md (Steam app and store page, Next Fest, Discord, code-signing certificates).

## Running the lanes
`scripts/agents/lane.sh <lane> <kind> <base-branch>` makes a worktree in `.agent-logs/wt/<lane>` and runs the brief through `~/.claude/tools/delegate.sh` (the owner's agent router, outside this repo). Set `COMMON=<shared brief>` (for a paused lane use the `*r.md` variant, which tells it to continue from its WIP commit). `scripts/agents/wait-lanes.sh <lanes...>` returns when one finishes. `scripts/agents/gate.sh` runs every release check.
