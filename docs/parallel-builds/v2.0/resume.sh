#!/bin/bash
# resume.sh <lane> <codex|claude2> — relaunch a builder in its existing worktree, continuing from uncommitted work
L=$1; R=$2; ROOT="/Users/Digital Next/Projects/Infini Shoot Game"
cd "$ROOT/wt/$L"
{ cat .lane-brief.md; echo; echo "IMPORTANT — RESUMING: you were interrupted (your process was killed). Your previous work is already in this worktree as commits and/or uncommitted changes: run git status and git diff first, keep what is good, and continue the task from there to the end. Never kill processes you did not start (no pkill/killall on node, vite, chromium, codex or claude): other builders run on this machine. Do not download models or large tools; do translations and content yourself."; [ -n "$3" ] && echo "$3"; } > .resume-brief.md
if [ "$R" = codex ]; then
  nohup codex exec --dangerously-bypass-approvals-and-sandbox -C . "$(cat .resume-brief.md)" >> "$ROOT/logs/$L.log" 2>&1 &
else
  CLAUDE_CONFIG_DIR="$HOME/.claude-account2" nohup "$HOME/Library/Application Support/Claude/claude-code/2.1.299/4fa9694b7975/claude.app/Contents/MacOS/claude" -p "$(cat .resume-brief.md)" --permission-mode bypassPermissions >> "$ROOT/logs/$L.log" 2>&1 &
fi
echo "$!:$L" >> "$ROOT/lanes/v2/pids.txt"
grep -vx "$L" "$ROOT/lanes/v2/done.txt" > "$ROOT/lanes/v2/done.tmp"; mv "$ROOT/lanes/v2/done.tmp" "$ROOT/lanes/v2/done.txt"
echo "resumed $L ($R) pid $!"
