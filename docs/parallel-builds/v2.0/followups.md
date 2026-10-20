LANE: followups — close the loose ends from tonight's lanes

Tonight's lanes each wrote notes/lanes/<lane>.md with an "unfinished or risky" section. Lanes merged so far include: perfload, readability2, mods2, settings, weapons3, arabic, halloween, lobby, firstten, bosses3, gauntlet, director2, mvp, menu, netcode, heroes3, meta2, pvp2, story, desktop, modsupport, mobile, secrets, models, audio3, gfx3 (check git log for "Merge lane/").
1. Read every one of those notes and list the loose ends (bugs, missing hooks, "not wired", "falls back to English", "only solo", "needs a dedicated message", missing sounds, missing icons, UI overlaps, test flakiness).
2. Fix every loose end that is small and safe to fix (missing sound/cue hooks to existing samples, missing achievements/codex entries for new content, missing gaits/materials/portraits for new enemies or bosses, missing settings rows, kit display issues like the Ronin/Tinker clicks in local co-op labels, flaky tests made deterministic, small co-op sync gaps). Leave big redesigns alone but list them.
3. Write notes/lanes/followups.md with: fixed (with file refs), deliberately left (why), and a prioritized list for the next session.
Owns: small surgical edits across the codebase (keep each minimal and additive), tests for each fix where possible.
