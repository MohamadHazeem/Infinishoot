#!/bin/bash
# launch.sh <lane> <codex|claude2>  — worktree + brief + background builder; pid recorded in pids.txt
set -e
L=$1; R=$2; ROOT="/Users/Digital Next/Projects/Infini Shoot Game"
cd "$ROOT/repo"
git worktree add -q "../wt/$L" -b "lane/$L" main
cp -Rc node_modules "../wt/$L/node_modules"; mkdir -p "../wt/$L/notes/lanes"
{ sed "s/<LANE>/$L/g" "$ROOT/lanes/v2/_common.md"; echo; cat "$ROOT/lanes/v2/$L.md"; } > "../wt/$L/.lane-brief.md"
cd "../wt/$L"
if [ "$R" = codex ]; then
  nohup codex exec --dangerously-bypass-approvals-and-sandbox -C . "$(cat .lane-brief.md)" > "$ROOT/logs/$L.log" 2>&1 &
else
  CLAUDE_CONFIG_DIR="$HOME/.claude-account2" nohup "$HOME/Library/Application Support/Claude/claude-code/2.1.299/4fa9694b7975/claude.app/Contents/MacOS/claude" -p "$(cat .lane-brief.md)" --permission-mode bypassPermissions > "$ROOT/logs/$L.log" 2>&1 &
fi
echo "$!:$L" >> "$ROOT/lanes/v2/pids.txt"
echo "launched $L ($R) pid $!"
